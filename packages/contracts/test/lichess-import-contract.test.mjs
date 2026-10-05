import assert from 'node:assert/strict';
import test from 'node:test';
import {
  lichessImportRunResponseSchema,
  lichessLatestImportResponseSchema,
  LichessConnectionStatusSchema,
} from '../dist/index.js';

const example = {
  id: 14,
  provider: 'LICHESS',
  status: 'RUNNING',
  lichessUserIdSnapshot: 'owner-lichess-id',
  lichessUsernameSnapshot: 'Owner',
  scope: { provider: 'LICHESS', speeds: ['bullet', 'blitz', 'rapid'], rated: true },
  requestedFrom: '2026-09-01T00:00:00.000Z',
  requestedTo: '2026-09-30T00:00:00.000Z',
  windowsTotal: 1, windowsCompleted: 0,
  gamesSeen: 30, gamesMatchedScope: 25,
  gamesImported: 20, gamesDuplicate: 3, gamesUpdated: 2, gamesSkippedOutOfScope: 5,
  errorCode: null, error: null, lastProgressAt: '2026-09-20T11:22:00.000Z',
  rateLimitUntil: null, startedAt: '2026-09-20T11:20:00.000Z', completedAt: null,
};

test('run response is strict, typed and preserves persisted progress and identity snapshot', () => {
  assert.deepEqual(lichessImportRunResponseSchema.parse({ importRun: example }).importRun, example);
  assert.deepEqual(lichessLatestImportResponseSchema.parse({ importRun: null }), { importRun: null });
  assert.equal(lichessLatestImportResponseSchema.parse({ importRun: example }).importRun.id, 14);
  assert.equal(lichessImportRunResponseSchema.safeParse({ importRun: { ...example, secret: 'token' } }).success, false);
  assert.equal(lichessImportRunResponseSchema.safeParse({ importRun: { ...example, status: 'PAUSED' } }).success, false);
  assert.equal(lichessImportRunResponseSchema.safeParse({ importRun: { ...example, gamesSeen: -1 } }).success, false);
  assert.equal(lichessImportRunResponseSchema.safeParse({ importRun: { ...example, accessToken: 'secret' } }).success, false);
});

test('credential states cannot manufacture a connected identity', () => {
  const missing = { connected: false, account: null, credentialState: 'missing', reconnectRequired: true };
  assert.deepEqual(LichessConnectionStatusSchema.parse(missing), missing);
  assert.equal(LichessConnectionStatusSchema.safeParse({ ...missing, credentialState: 'ok' }).success, false);
});
