import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../dist/app.js';
import {
  createPrismaAccountImportRepository,
  ActiveImportRunError,
} from '../dist/modules/account-imports/account-import.repository.prisma.js';
import { LichessCredentialUnavailableError } from '../dist/modules/lichess/lichess-connection.service.js';
import { toImportRunResponse } from '../dist/modules/account-imports/account-import.service.js';

const start = new Date('2026-09-01T00:00:00Z');
const end = new Date('2026-09-30T00:00:00Z');
function storedRun(overrides = {}) {
  return {
    id: 5, appUserId: 99, provider: 'LICHESS', status: 'RUNNING',
    scopeJson: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'] },
    lichessUserIdSnapshot: 'lichess-id', lichessUsernameSnapshot: 'Owner',
    requestedFrom: start, requestedTo: end, windowsTotal: 1, windowsCompleted: 0,
    gamesSeen: 1, gamesMatchedScope: 1, gamesImported: 0,
    gamesDuplicate: 0, gamesUpdated: 0, gamesSkipped: 0, gamesFailed: 0, gamesSkippedOutOfScope: 0,
    errorCode: null, error: null, lastProgressAt: null, rateLimitUntil: null,
    startedAt: start, completedAt: null,
    ...overrides,
  };
}

test('repository recovers owned active run ahead of newer terminal; latest is deterministic and bounded', async () => {
  const queries = [];
  const active = storedRun({ id: 2 });
  const latest = storedRun({ id: 8, status: 'COMPLETED' });
  let hasActive = true;
  const repository = createPrismaAccountImportRepository({
    importRun: {
      findFirst: async ({ where, orderBy }) => {
        queries.push({ where, orderBy });
        assert.equal(where.appUserId, 99);
        assert.equal(where.provider, 'LICHESS');
        assert.deepEqual(orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
        return where.status ? (hasActive ? active : null) : latest;
      },
    },
  });

  assert.equal((await repository.getLatestRun(99)).id, 2);
  assert.equal(queries.length, 1, 'do not query terminal runs while active');
  assert.deepEqual(queries[0].where.status.in, ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED']);
  hasActive = false;
  assert.equal((await repository.getLatestRun(99)).id, 8);
  assert.equal(queries.length, 3);
});

function fakeService() {
  return {
    getLatestRun: async (userId) => userId === 99 ? storedRun() : null,
    requestImport: async () => storedRun({ status: 'QUEUED' }),
    getRun: async (userId, id) => userId === 99 && id === 5 ? storedRun() : null,
    cancelRun: async (userId, id) => userId === 99 && id === 5 ? storedRun({ status: 'CANCEL_REQUESTED' }) : null,
  };
}

async function appWithService(service = fakeService()) {
  return buildApp({
    prisma: { $disconnect: async () => undefined },
    authConfig: { mode: 'dev-single-user' },
    currentUserService: {
      resolveDevUser: async () => ({ auth: { userId: 99, provider: 'dev', externalSubject: 'dev-single-user' } }),
      resolveExternalUser: async () => { throw new Error('not expected'); },
    },
    accountImportService: service,
  });
}

test('API latest and run/cancel use authenticated app user; unsafe and foreign run ids fail closed', async () => {
  const app = await appWithService();
  try {
    const latest = await app.inject({ method: 'GET', url: '/api/me/imports/lichess/latest' });
    assert.equal(latest.statusCode, 200);
    assert.deepEqual(latest.json(), { importRun: toImportRunResponse(storedRun()) });
    for (const id of ['999', 'not-a-number', '9007199254740992', '05', '5e0', '0x5']) {
      const response = await app.inject({ method: 'GET', url: '/api/me/imports/' + id });
      assert.equal(response.statusCode, id === '999' ? 404 : 400);
    }
    const cancelled = await app.inject({ method: 'POST', url: '/api/me/imports/5/cancel' });
    assert.equal(cancelled.statusCode, 200);
    assert.equal(cancelled.json().importRun.status, 'CANCEL_REQUESTED');
  } finally { await app.close(); }
});

test('API safely handles active conflicts, credential-reconnect and date range errors', async () => {
  const app = await appWithService({
    ...fakeService(),
    requestImport: async () => { throw new ActiveImportRunError(5); },
  });
  const body = { from: start.toISOString(), to: end.toISOString(), rated: true };
  try {
    const invalid = await app.inject({ method: 'POST', url: '/api/me/imports/lichess',
      payload: { from: end.toISOString(), to: start.toISOString() } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.json().code, 'INVALID_RANGE');

    const conflict = await app.inject({ method: 'POST', url: '/api/me/imports/lichess', payload: body });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().code, 'ACTIVE_IMPORT');
    assert.equal(conflict.body.includes('5'), false, 'no run ownership inferred from conflict');
  } finally { await app.close(); }

  const second = await appWithService({
    ...fakeService(),
    requestImport: async () => { throw new LichessCredentialUnavailableError('revoked'); },
  });
  try {
    const response = await second.inject({ method: 'POST', url: '/api/me/imports/lichess', payload: body });
    assert.equal(response.statusCode, 409);
    assert.equal(response.json().code, 'LICHESS_RECONNECT_REQUIRED');
    assert.equal(response.json().credentialState, 'revoked');
  } finally { await second.close(); }
});

test('latest endpoint requires application authentication, not Lichess connection', async () => {
  const app = await buildApp({
    prisma: { $disconnect: async () => undefined },
    authConfig: { mode: 'clerk', issuer: 'https://issuer.example',
      jwksUrl: new URL('https://issuer.example/.well-known/jwks.json'),
      authorizedParties: ['http://localhost:4200'] },
    accountImportService: fakeService(),
  });
  try {
    const response = await app.inject({ method: 'GET', url: '/api/me/imports/lichess/latest' });
    assert.equal(response.statusCode, 401);
  } finally { await app.close(); }
});
