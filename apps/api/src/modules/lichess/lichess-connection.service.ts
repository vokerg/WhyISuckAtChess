import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type {
  LichessConnectionStatus,
  LichessCredentialState,
} from '@why-i-suck-at-chess/contracts';
import prisma from '../../prisma';
import {
  decryptToken,
  encryptToken,
  type EncryptedTokenRecord,
} from './oauth-token-crypto';

const provider = 'LICHESS';
const oauthBaseUrl = 'https://lichess.org/oauth';
const tokenUrl = 'https://lichess.org/api/token';
const accountUrl = 'https://lichess.org/api/account';
const stateTtlMs = 10 * 60 * 1000;

export type LichessOAuthRedirectStatus = 'cancelled' | 'error' | 'conflict';

export class LichessOAuthError extends Error {
  constructor(message: string, readonly redirectStatus: LichessOAuthRedirectStatus = 'error') {
    super(message);
  }
}

export class LichessIdentityConflictError extends LichessOAuthError {
  constructor() {
    super('That Lichess identity is already connected to another application user.', 'conflict');
  }
}

export type LichessCredentialUnavailableReason = 'missing' | 'expired' | 'revoked' | 'undecryptable';

export class LichessCredentialUnavailableError extends Error {
  constructor(readonly reason: LichessCredentialUnavailableReason) {
    super(`Lichess credential is unavailable: ${reason}`);
  }
}

export interface ConnectedLichessCredential {
  lichessUserId: string;
  username: string;
  accessToken: string;
  expiresAt: Date | null;
}

interface StoredConnection {
  id: number;
  appUserId: number;
  lichessUserId: string;
  username: string;
  scopes: string[];
  accessTokenCiphertext: string;
  accessTokenIv: string;
  accessTokenAuthTag: string;
  expiresAt: Date | null;
  connectedAt: Date;
  revokedAt: Date | null;
}

interface LoginStateInput {
  appUserId: number;
  provider: string;
  state: string;
  codeVerifier: string;
  expiresAt: Date;
}

interface ConsumedLoginState {
  appUserId: number;
  codeVerifier: string;
}

interface ConnectionUpsertInput {
  appUserId: number;
  lichessUserId: string;
  username: string;
  scopes: string[];
  encryptedToken: EncryptedTokenRecord;
  expiresAt: Date | null;
  connectedAt: Date;
}

export interface LichessConnectionStore {
  deleteExpiredStates(now: Date): Promise<void>;
  createLoginState(input: LoginStateInput): Promise<void>;
  consumeLoginState(state: string, expectedProvider: string, now: Date): Promise<ConsumedLoginState | null>;
  findConnectionForUser(appUserId: number): Promise<StoredConnection | null>;
  upsertConnection(input: ConnectionUpsertInput): Promise<StoredConnection>;
  deleteConnection(id: number): Promise<void>;
  markRevoked(appUserId: number, revokedAt: Date): Promise<void>;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

export function createPrismaLichessConnectionStore(database: PrismaClient = prisma): LichessConnectionStore {
  return {
    deleteExpiredStates: async (now) => {
      await database.oAuthLoginState.deleteMany({ where: { expiresAt: { lte: now } } });
    },

    createLoginState: async (input) => {
      await database.oAuthLoginState.create({ data: input });
    },

    consumeLoginState: (state, expectedProvider, now) => database.$transaction(async (transaction) => {
      const loginState = await transaction.oAuthLoginState.findUnique({ where: { state } });
      if (
        !loginState
        || loginState.provider !== expectedProvider
        || loginState.expiresAt <= now
        || loginState.consumedAt !== null
        || !loginState.codeVerifier
      ) {
        return null;
      }

      const consumed = await transaction.oAuthLoginState.updateMany({
        where: {
          id: loginState.id,
          provider: expectedProvider,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          consumedAt: now,
          codeVerifier: null,
        },
      });

      if (consumed.count !== 1) return null;
      return { appUserId: loginState.appUserId, codeVerifier: loginState.codeVerifier };
    }),

    findConnectionForUser: (appUserId) => database.lichessConnection.findUnique({
      where: { appUserId },
    }),

    upsertConnection: (input) => database.$transaction(async (transaction) => {
      const existingOwner = await transaction.lichessConnection.findUnique({
        where: { lichessUserId: input.lichessUserId },
        select: { appUserId: true },
      });
      if (existingOwner && existingOwner.appUserId !== input.appUserId) {
        throw new LichessIdentityConflictError();
      }

      try {
        return await transaction.lichessConnection.upsert({
          where: { appUserId: input.appUserId },
          update: {
            lichessUserId: input.lichessUserId,
            username: input.username,
            scopes: input.scopes,
            accessTokenCiphertext: input.encryptedToken.ciphertext,
            accessTokenIv: input.encryptedToken.iv,
            accessTokenAuthTag: input.encryptedToken.authTag,
            expiresAt: input.expiresAt,
            connectedAt: input.connectedAt,
            revokedAt: null,
          },
          create: {
            appUserId: input.appUserId,
            lichessUserId: input.lichessUserId,
            username: input.username,
            scopes: input.scopes,
            accessTokenCiphertext: input.encryptedToken.ciphertext,
            accessTokenIv: input.encryptedToken.iv,
            accessTokenAuthTag: input.encryptedToken.authTag,
            expiresAt: input.expiresAt,
            connectedAt: input.connectedAt,
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) throw new LichessIdentityConflictError();
        throw error;
      }
    }),

    deleteConnection: async (id) => {
      await database.lichessConnection.delete({ where: { id } });
    },

    markRevoked: async (appUserId, revokedAt) => {
      await database.lichessConnection.updateMany({
        where: { appUserId },
        data: { revokedAt },
      });
    },
  };
}

interface LichessOAuthConfig {
  clientId: string;
  redirectUri: string;
}

export interface LichessConnectionServiceOptions {
  store?: LichessConnectionStore;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  randomBytes?: (size: number) => Buffer;
  encrypt?: typeof encryptToken;
  decrypt?: typeof decryptToken;
  oauthConfig?: LichessOAuthConfig;
}

interface LichessTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
}

interface LichessAccountResponse {
  id?: string;
  username?: string;
}

export function createLichessConnectionService(options: LichessConnectionServiceOptions = {}) {
  const store = options.store ?? createPrismaLichessConnectionStore();
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const randomBytes = options.randomBytes ?? ((size: number) => crypto.randomBytes(size));
  const encrypt = options.encrypt ?? encryptToken;
  const decrypt = options.decrypt ?? decryptToken;
  const readConfig = () => options.oauthConfig ?? loadLichessOAuthConfig();

  const revokeLichessToken = async (accessToken: string): Promise<void> => {
    const response = await fetchImpl(tokenUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok && response.status !== 401 && response.status !== 403) {
      throw new Error('Could not revoke Lichess OAuth token.');
    }
  };

  const getCredentialState = (connection: StoredConnection, at: Date): LichessCredentialState => {
    if (connection.revokedAt) return 'revoked';
    if (connection.expiresAt && connection.expiresAt <= at) return 'expired';
    try {
      decrypt({
        ciphertext: connection.accessTokenCiphertext,
        iv: connection.accessTokenIv,
        authTag: connection.accessTokenAuthTag,
      });
      return 'usable';
    } catch {
      return 'undecryptable';
    }
  };

  return {
    async getStatusForUser(appUserId: number): Promise<LichessConnectionStatus> {
      const connection = await store.findConnectionForUser(appUserId);
      if (!connection) {
        return {
          connected: false,
          account: null,
          credentialState: 'missing',
          reconnectRequired: true,
        };
      }

      const credentialState = getCredentialState(connection, now());
      return {
        connected: true,
        account: {
          lichessUserId: connection.lichessUserId,
          username: connection.username,
          scopes: connection.scopes,
          connectedAt: connection.connectedAt.toISOString(),
          expiresAt: connection.expiresAt?.toISOString() ?? null,
        },
        credentialState,
        reconnectRequired: credentialState !== 'usable',
      };
    },

    async getCredentialForUser(appUserId: number): Promise<ConnectedLichessCredential> {
      const connection = await store.findConnectionForUser(appUserId);
      if (!connection) throw new LichessCredentialUnavailableError('missing');

      const credentialState = getCredentialState(connection, now());
      if (credentialState !== 'usable') {
        throw new LichessCredentialUnavailableError(credentialState);
      }

      let accessToken: string;
      try {
        accessToken = decrypt({
          ciphertext: connection.accessTokenCiphertext,
          iv: connection.accessTokenIv,
          authTag: connection.accessTokenAuthTag,
        });
      } catch {
        throw new LichessCredentialUnavailableError('undecryptable');
      }

      return {
        lichessUserId: connection.lichessUserId,
        username: connection.username,
        accessToken,
        expiresAt: connection.expiresAt,
      };
    },

    async markCredentialRevokedForUser(appUserId: number): Promise<void> {
      await store.markRevoked(appUserId, now());
    },

    async createAuthorizationUrl(appUserId: number): Promise<string> {
      const createdAt = now();
      await store.deleteExpiredStates(createdAt);

      const state = randomBytes(32).toString('base64url');
      const codeVerifier = randomBytes(64).toString('base64url');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
      const expiresAt = new Date(createdAt.getTime() + stateTtlMs);

      await store.createLoginState({
        appUserId,
        provider,
        state,
        codeVerifier,
        expiresAt,
      });

      const config = readConfig();
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        code_challenge_method: 'S256',
        code_challenge: codeChallenge,
        state,
      });

      return `${oauthBaseUrl}?${params.toString()}`;
    },

    async handleCallback(query: {
      code?: string;
      state?: string;
      error?: string;
      error_description?: string;
    }): Promise<void> {
      const callbackAt = now();
      await store.deleteExpiredStates(callbackAt);

      if (!query.state) {
        throw new LichessOAuthError('Lichess OAuth callback is missing state.');
      }

      const loginState = await store.consumeLoginState(query.state, provider, callbackAt);
      if (!loginState) {
        throw new LichessOAuthError('Invalid, expired, or already-consumed Lichess OAuth state.');
      }

      if (query.error === 'access_denied') {
        throw new LichessOAuthError('Lichess connection cancelled.', 'cancelled');
      }
      if (query.error) {
        throw new LichessOAuthError(query.error_description || 'Lichess OAuth returned an error.');
      }
      if (!query.code) {
        throw new LichessOAuthError('Lichess OAuth callback is missing code.');
      }

      const config = readConfig();
      const token = await exchangeCodeForToken(fetchImpl, query.code, loginState.codeVerifier, config);
      const account = await fetchLichessAccount(fetchImpl, token.accessToken);
      const encryptedToken = encrypt(token.accessToken);
      const expiresAt = token.expiresIn === undefined
        ? null
        : new Date(callbackAt.getTime() + token.expiresIn * 1000);
      const previousConnection = await store.findConnectionForUser(loginState.appUserId);

      try {
        await store.upsertConnection({
          appUserId: loginState.appUserId,
          lichessUserId: account.id,
          username: account.username,
          scopes: token.scopes,
          encryptedToken,
          expiresAt,
          connectedAt: callbackAt,
        });
      } catch (error) {
        try {
          await revokeLichessToken(token.accessToken);
        } catch {
          // The ownership result remains authoritative even if cleanup of the newly issued token fails.
        }
        throw error;
      }

      if (previousConnection) {
        try {
          const previousToken = decrypt({
            ciphertext: previousConnection.accessTokenCiphertext,
            iv: previousConnection.accessTokenIv,
            authTag: previousConnection.accessTokenAuthTag,
          });
          if (previousToken !== token.accessToken) await revokeLichessToken(previousToken);
        } catch {
          // Replacement is authoritative locally even when the prior token is already unreadable/unrevokable.
        }
      }
    },

    async disconnectForUser(appUserId: number): Promise<{ disconnected: true }> {
      const connection = await store.findConnectionForUser(appUserId);
      if (!connection) return { disconnected: true };

      try {
        const accessToken = decrypt({
          ciphertext: connection.accessTokenCiphertext,
          iv: connection.accessTokenIv,
          authTag: connection.accessTokenAuthTag,
        });
        try {
          await revokeLichessToken(accessToken);
        } catch {
          // Upstream revoke is best-effort. Local state below is authoritative.
        }
      } catch {
        // Undecryptable local token must not prevent authoritative local disconnect.
      }

      await store.deleteConnection(connection.id);
      return { disconnected: true };
    },
  };
}

export type LichessConnectionService = ReturnType<typeof createLichessConnectionService>;
export const lichessConnectionService = createLichessConnectionService();

async function exchangeCodeForToken(
  fetchImpl: typeof fetch,
  code: string,
  codeVerifier: string,
  config: LichessOAuthConfig,
): Promise<{ accessToken: string; expiresIn?: number; scopes: string[] }> {
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      code_verifier: codeVerifier,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
    }),
  });

  if (!response.ok) {
    throw new LichessOAuthError('Could not exchange Lichess OAuth code for a token.');
  }

  const payload = await response.json() as LichessTokenResponse;
  if (!payload.access_token) {
    throw new LichessOAuthError('Lichess token response did not include an access token.');
  }

  const expiresIn = typeof payload.expires_in === 'number' && payload.expires_in >= 0
    ? payload.expires_in
    : undefined;
  const scopes = typeof payload.scope === 'string'
    ? [...new Set(payload.scope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean))]
    : [];

  return {
    accessToken: payload.access_token,
    ...(expiresIn === undefined ? {} : { expiresIn }),
    scopes,
  };
}

async function fetchLichessAccount(
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<{ id: string; username: string }> {
  const response = await fetchImpl(accountUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new LichessOAuthError('Could not load the connected Lichess account.');
  }

  const payload = await response.json() as LichessAccountResponse;
  if (!payload.id || !payload.username) {
    throw new LichessOAuthError('Lichess account response was missing identity fields.');
  }
  return { id: payload.id, username: payload.username };
}

function loadLichessOAuthConfig(): LichessOAuthConfig {
  const clientId = process.env['LICHESS_OAUTH_CLIENT_ID']?.trim();
  const redirectUri = process.env['LICHESS_OAUTH_REDIRECT_URI']?.trim();
  if (!clientId) throw new Error('LICHESS_OAUTH_CLIENT_ID is required for Lichess OAuth.');
  if (!redirectUri) throw new Error('LICHESS_OAUTH_REDIRECT_URI is required for Lichess OAuth.');
  return { clientId, redirectUri };
}
