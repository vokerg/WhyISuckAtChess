import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../dist/app.js';
import { createCurrentAppUserService } from '../dist/auth/current-app-user.service.js';
import {
  createLichessConnectionService,
  LichessCredentialUnavailableError,
  LichessIdentityConflictError,
  LichessOAuthError,
} from '../dist/modules/lichess/lichess-connection.service.js';

class FakeLichessStore {
  constructor() {
    this.states = new Map();
    this.connections = new Map();
    this.nextConnectionId = 1;
    this.nextCredentialGeneration = 1;
    this.onReplace = null;
  }

  async deleteExpiredStates(now) {
    for (const [state, value] of this.states) {
      if (value.expiresAt <= now) this.states.delete(state);
    }
  }

  async createLoginState(input) {
    this.states.set(input.state, { ...input, consumed: false });
  }

  async consumeLoginState(state, expectedProvider, now) {
    const value = this.states.get(state);
    if (!value || value.provider !== expectedProvider || value.expiresAt <= now || value.consumed) {
      return null;
    }
    value.consumed = true;
    return { appUserId: value.appUserId, codeVerifier: value.codeVerifier };
  }

  async findConnectionForUser(appUserId) {
    return this.connections.get(appUserId) ?? null;
  }

  async replaceConnection(input) {
    for (const connection of this.connections.values()) {
      if (connection.lichessUserId === input.lichessUserId && connection.appUserId !== input.appUserId) {
        throw new LichessIdentityConflictError();
      }
    }

    const previousConnection = this.connections.get(input.appUserId) ?? null;
    const connection = {
      id: previousConnection?.id ?? this.nextConnectionId++,
      appUserId: input.appUserId,
      lichessUserId: input.lichessUserId,
      username: input.username,
      scopes: input.scopes,
      accessTokenCiphertext: input.encryptedToken.ciphertext,
      accessTokenIv: input.encryptedToken.iv,
      accessTokenAuthTag: input.encryptedToken.authTag,
      expiresAt: input.expiresAt,
      connectedAt: input.connectedAt,
      revokedAt: null,
      credentialGeneration: `generation-${this.nextCredentialGeneration++}`,
    };
    this.connections.set(input.appUserId, connection);
    this.onReplace?.(connection, previousConnection);
    return { connection, previousConnection };
  }

  async deleteConnection(appUserId, credentialGeneration) {
    const connection = this.connections.get(appUserId);
    if (!connection || connection.credentialGeneration !== credentialGeneration) return false;
    this.connections.delete(appUserId);
    return true;
  }

  async markRevoked(appUserId, credentialGeneration, revokedAt) {
    const connection = this.connections.get(appUserId);
    if (!connection || connection.credentialGeneration !== credentialGeneration) return false;
    connection.revokedAt = revokedAt;
    return true;
  }
}

const fakeEncrypt = (token) => ({ ciphertext: `enc:${token}`, iv: 'iv', authTag: 'tag' });
const fakeDecrypt = (record) => {
  if (!record.ciphertext.startsWith('enc:')) throw new Error('undecryptable');
  return record.ciphertext.slice(4);
};

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function seedConnection(store, overrides = {}) {
  const connection = {
    id: store.nextConnectionId++,
    appUserId: 1,
    lichessUserId: 'lichess-1',
    username: 'TokenIdentity',
    scopes: [],
    accessTokenCiphertext: 'enc:old-token',
    accessTokenIv: 'iv',
    accessTokenAuthTag: 'tag',
    expiresAt: null,
    connectedAt: new Date('2026-09-07T05:00:00Z'),
    revokedAt: null,
    credentialGeneration: 'generation-seed',
    ...overrides,
  };
  store.connections.set(connection.appUserId, connection);
  return connection;
}

function deferred() {
  let resolve;
  const promise = new Promise((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

test('first-seen external auth identity resolves transactionally to one stable AppUser', async () => {
  const users = new Map();
  let nextId = 1;
  const appUser = {
    async upsert(args) {
      const key = `${args.where.authProvider_authSubject.authProvider}:${args.where.authProvider_authSubject.authSubject}`;
      const existing = users.get(key);
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const created = { id: nextId++, ...args.create };
      users.set(key, created);
      return created;
    },
    async findUniqueOrThrow({ where }) {
      const found = [...users.values()].find((user) => user.id === where.id);
      if (!found) throw new Error('not found');
      return found;
    },
  };
  const database = {
    $transaction: async (callback) => callback({ appUser }),
    appUser,
  };
  const service = createCurrentAppUserService(database);

  const first = await service.resolveExternalUser({ provider: 'clerk', externalSubject: 'user_123', email: 'one@example.test' });
  const second = await service.resolveExternalUser({ provider: 'clerk', externalSubject: 'user_123', email: 'two@example.test' });

  assert.equal(first.user.id, second.user.id);
  assert.equal(second.auth.userId, first.auth.userId);
  assert.equal(users.size, 1);
  assert.equal(second.user.email, 'two@example.test');
});

test('OAuth start creates short-lived PKCE state and requests no unrelated scope', async () => {
  const store = new FakeLichessStore();
  const fixedNow = new Date('2026-09-07T05:00:00Z');
  const service = createLichessConnectionService({
    store,
    now: () => fixedNow,
    randomBytes: (size) => Buffer.alloc(size, 0x11),
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    oauthConfig: { clientId: 'why-client', redirectUri: 'http://localhost:3000/api/auth/lichess/callback' },
  });

  const url = new URL(await service.createAuthorizationUrl(7));
  const state = url.searchParams.get('state');
  assert.ok(state);
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('scope'), false);
  assert.equal(store.states.get(state).appUserId, 7);
  assert.equal(store.states.get(state).expiresAt.toISOString(), '2026-09-07T05:10:00.000Z');
});

test('OAuth callback consumes state once and persists identity from the authenticated token', async () => {
  const store = new FakeLichessStore();
  const calls = [];
  const service = createLichessConnectionService({
    store,
    now: () => new Date('2026-09-07T05:00:00Z'),
    randomBytes: (size) => Buffer.alloc(size, 0x22),
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    oauthConfig: { clientId: 'why-client', redirectUri: 'http://localhost:3000/api/auth/lichess/callback' },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET' });
      if (String(url).endsWith('/api/token')) return jsonResponse({ access_token: 'new-token', expires_in: 3600 });
      if (String(url).endsWith('/api/account')) return jsonResponse({ id: 'lichess-token-id', username: 'TokenIdentity' });
      throw new Error(`unexpected URL ${url}`);
    },
  });

  const startUrl = new URL(await service.createAuthorizationUrl(3));
  const state = startUrl.searchParams.get('state');
  await service.handleCallback({ state, code: 'oauth-code' });

  const connection = await store.findConnectionForUser(3);
  assert.equal(connection.lichessUserId, 'lichess-token-id');
  assert.equal(connection.username, 'TokenIdentity');
  assert.equal(connection.accessTokenCiphertext, 'enc:new-token');
  assert.equal(connection.expiresAt.toISOString(), '2026-09-07T06:00:00.000Z');
  assert.equal(calls.length, 2);

  await assert.rejects(
    service.handleCallback({ state, code: 'replayed-code' }),
    (error) => error instanceof LichessOAuthError && /already-consumed/.test(error.message),
  );
  assert.equal(calls.length, 2);
});

test('expired OAuth state is rejected before token exchange', async () => {
  const store = new FakeLichessStore();
  store.states.set('expired-state', {
    appUserId: 1,
    provider: 'LICHESS',
    state: 'expired-state',
    codeVerifier: 'verifier',
    expiresAt: new Date('2026-09-07T04:59:59Z'),
    consumed: false,
  });
  let fetched = false;
  const service = createLichessConnectionService({
    store,
    now: () => new Date('2026-09-07T05:00:00Z'),
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    oauthConfig: { clientId: 'why-client', redirectUri: 'http://localhost/callback' },
    fetchImpl: async () => {
      fetched = true;
      throw new Error('must not fetch');
    },
  });

  await assert.rejects(service.handleCallback({ state: 'expired-state', code: 'code' }), LichessOAuthError);
  assert.equal(fetched, false);
});

test('competing Lichess identity ownership is rejected and the newly issued token is revoked best-effort', async () => {
  const store = new FakeLichessStore();
  seedConnection(store, { appUserId: 2, lichessUserId: 'shared-id' });
  store.states.set('state-1', {
    appUserId: 1,
    provider: 'LICHESS',
    state: 'state-1',
    codeVerifier: 'verifier',
    expiresAt: new Date('2026-09-07T05:10:00Z'),
    consumed: false,
  });
  const calls = [];
  const service = createLichessConnectionService({
    store,
    now: () => new Date('2026-09-07T05:00:00Z'),
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    oauthConfig: { clientId: 'why-client', redirectUri: 'http://localhost/callback' },
    fetchImpl: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method ?? 'GET' });
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (String(url).endsWith('/api/token')) return jsonResponse({ access_token: 'issued-token' });
      if (String(url).endsWith('/api/account')) return jsonResponse({ id: 'shared-id', username: 'SharedUser' });
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await assert.rejects(
    service.handleCallback({ state: 'state-1', code: 'code' }),
    LichessIdentityConflictError,
  );
  assert.equal(calls.at(-1).method, 'DELETE');
  assert.equal(await store.findConnectionForUser(1), null);
});

test('credential seam reports reconnect-required expired state and never returns an expired token', async () => {
  const store = new FakeLichessStore();
  seedConnection(store, { expiresAt: new Date('2026-09-07T04:59:00Z') });
  const service = createLichessConnectionService({
    store,
    now: () => new Date('2026-09-07T05:00:00Z'),
    decrypt: fakeDecrypt,
  });

  const status = await service.getStatusForUser(1);
  assert.equal(status.credentialState, 'expired');
  assert.equal(status.reconnectRequired, true);
  await assert.rejects(
    service.getCredentialForUser(1),
    (error) => error instanceof LichessCredentialUnavailableError && error.reason === 'expired',
  );
});

test('disconnect remains authoritative when a stored token is undecryptable', async () => {
  const store = new FakeLichessStore();
  seedConnection(store, { accessTokenCiphertext: 'broken' });
  let fetched = false;
  const service = createLichessConnectionService({
    store,
    decrypt: () => { throw new Error('broken ciphertext'); },
    fetchImpl: async () => {
      fetched = true;
      throw new Error('must not fetch');
    },
  });

  assert.deepEqual(await service.disconnectForUser(1), { disconnected: true });
  assert.equal(await store.findConnectionForUser(1), null);
  assert.equal(fetched, false);
});

test('reconnect racing a slow disconnect cannot delete the freshly replaced credential', async () => {
  const store = new FakeLichessStore();
  seedConnection(store);
  store.states.set('reconnect-state', {
    appUserId: 1,
    provider: 'LICHESS',
    state: 'reconnect-state',
    codeVerifier: 'verifier',
    expiresAt: new Date('2026-09-07T05:10:00Z'),
    consumed: false,
  });

  const revokeStarted = deferred();
  const allowRevoke = deferred();
  const replacementDone = deferred();
  store.onReplace = () => replacementDone.resolve();

  const service = createLichessConnectionService({
    store,
    now: () => new Date('2026-09-07T05:00:00Z'),
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    oauthConfig: { clientId: 'why-client', redirectUri: 'http://localhost/callback' },
    fetchImpl: async (url, init = {}) => {
      if (init.method === 'DELETE') {
        revokeStarted.resolve();
        await allowRevoke.promise;
        return new Response(null, { status: 204 });
      }
      if (String(url).endsWith('/api/token')) return jsonResponse({ access_token: 'reconnected-token' });
      if (String(url).endsWith('/api/account')) return jsonResponse({ id: 'lichess-1', username: 'TokenIdentity' });
      throw new Error(`unexpected URL ${url}`);
    },
  });

  const disconnectPromise = service.disconnectForUser(1);
  await revokeStarted.promise;

  const reconnectPromise = service.handleCallback({ state: 'reconnect-state', code: 'reconnect-code' });
  await replacementDone.promise;
  allowRevoke.resolve();

  await Promise.all([disconnectPromise, reconnectPromise]);
  const connection = await store.findConnectionForUser(1);
  assert.ok(connection);
  assert.equal(fakeDecrypt({
    ciphertext: connection.accessTokenCiphertext,
    iv: connection.accessTokenIv,
    authTag: connection.accessTokenAuthTag,
  }), 'reconnected-token');
  assert.notEqual(connection.credentialGeneration, 'generation-seed');
});

test('concurrent reconnect callbacks revoke every superseded token without revoking the final credential', async () => {
  const store = new FakeLichessStore();
  seedConnection(store);
  for (const state of ['state-a', 'state-b']) {
    store.states.set(state, {
      appUserId: 1,
      provider: 'LICHESS',
      state,
      codeVerifier: `verifier-${state}`,
      expiresAt: new Date('2026-09-07T05:10:00Z'),
      consumed: false,
    });
  }

  const revokedTokens = [];
  const service = createLichessConnectionService({
    store,
    now: () => new Date('2026-09-07T05:00:00Z'),
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
    oauthConfig: { clientId: 'why-client', redirectUri: 'http://localhost/callback' },
    fetchImpl: async (url, init = {}) => {
      if (init.method === 'DELETE') {
        const authorization = new Headers(init.headers).get('authorization');
        revokedTokens.push(authorization?.replace('Bearer ', ''));
        return new Response(null, { status: 204 });
      }
      if (String(url).endsWith('/api/token')) {
        const code = init.body.get('code');
        return jsonResponse({ access_token: code === 'code-a' ? 'token-a' : 'token-b' });
      }
      if (String(url).endsWith('/api/account')) {
        return jsonResponse({ id: 'lichess-1', username: 'TokenIdentity' });
      }
      throw new Error(`unexpected URL ${url}`);
    },
  });

  await Promise.all([
    service.handleCallback({ state: 'state-a', code: 'code-a' }),
    service.handleCallback({ state: 'state-b', code: 'code-b' }),
  ]);

  const connection = await store.findConnectionForUser(1);
  const finalToken = fakeDecrypt({
    ciphertext: connection.accessTokenCiphertext,
    iv: connection.accessTokenIv,
    authTag: connection.accessTokenAuthTag,
  });
  const supersededIssuedToken = finalToken === 'token-a' ? 'token-b' : 'token-a';

  assert.ok(['token-a', 'token-b'].includes(finalToken));
  assert.ok(revokedTokens.includes('old-token'));
  assert.ok(revokedTokens.includes(supersededIssuedToken));
  assert.equal(revokedTokens.includes(finalToken), false);
});

test('stale provider revocation cannot mark a newer credential generation revoked', async () => {
  const store = new FakeLichessStore();
  seedConnection(store);
  const service = createLichessConnectionService({
    store,
    now: () => new Date('2026-09-07T05:00:00Z'),
    encrypt: fakeEncrypt,
    decrypt: fakeDecrypt,
  });

  const staleCredential = await service.getCredentialForUser(1);
  await store.replaceConnection({
    appUserId: 1,
    lichessUserId: 'lichess-1',
    username: 'TokenIdentity',
    scopes: [],
    encryptedToken: fakeEncrypt('new-token'),
    expiresAt: null,
    connectedAt: new Date('2026-09-07T05:01:00Z'),
  });

  assert.equal(
    await service.markCredentialRevokedForUser(1, staleCredential.credentialGeneration),
    false,
  );
  assert.equal((await service.getStatusForUser(1)).credentialState, 'usable');

  const currentCredential = await service.getCredentialForUser(1);
  assert.notEqual(currentCredential.credentialGeneration, staleCredential.credentialGeneration);
  assert.equal(
    await service.markCredentialRevokedForUser(1, currentCredential.credentialGeneration),
    true,
  );
  assert.equal((await service.getStatusForUser(1)).credentialState, 'revoked');
});

test('protected connection route resolves ownership from authenticated app user', async () => {
  const noDatabase = { $disconnect: async () => undefined };
  let requestedUserId = null;
  const app = await buildApp({
    prisma: noDatabase,
    authConfig: { mode: 'dev-single-user' },
    currentUserService: {
      resolveDevUser: async () => ({ auth: { userId: 99, provider: 'dev', externalSubject: 'dev-single-user' } }),
      resolveExternalUser: async () => { throw new Error('not expected'); },
    },
    lichessService: {
      getStatusForUser: async (userId) => {
        requestedUserId = userId;
        return { connected: false, account: null, credentialState: 'missing', reconnectRequired: true };
      },
      createAuthorizationUrl: async () => 'https://lichess.org/oauth',
      handleCallback: async () => undefined,
      disconnectForUser: async () => ({ disconnected: true }),
      getCredentialForUser: async () => { throw new Error('not expected'); },
      markCredentialRevokedForUser: async () => false,
    },
  });

  const response = await app.inject({ method: 'GET', url: '/api/me/lichess-connection' });
  assert.equal(response.statusCode, 200);
  assert.equal(requestedUserId, 99);
  await app.close();
});

test('protected connection route rejects unauthenticated Clerk request with 401', async () => {
  const noDatabase = { $disconnect: async () => undefined };
  const app = await buildApp({
    prisma: noDatabase,
    authConfig: {
      mode: 'clerk',
      issuer: 'https://issuer.example',
      jwksUrl: new URL('https://issuer.example/.well-known/jwks.json'),
      authorizedParties: ['http://localhost:4200'],
    },
  });

  const response = await app.inject({ method: 'GET', url: '/api/me/lichess-connection' });
  assert.equal(response.statusCode, 401);
  assert.deepEqual(response.json(), { message: 'Unauthorized' });
  await app.close();
});
