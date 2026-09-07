import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HealthResponseSchema,
  LichessConnectionStatusSchema,
} from '../dist/index.js';

test('health response contract accepts the bootstrap payload', () => {
  assert.deepEqual(
    HealthResponseSchema.parse({ ok: true, service: 'why-i-suck-at-chess-api' }),
    { ok: true, service: 'why-i-suck-at-chess-api' },
  );
});

test('health response contract rejects unrelated payloads', () => {
  assert.equal(HealthResponseSchema.safeParse({ ok: false }).success, false);
});

test('Lichess connection status exposes safe account provenance without token material', () => {
  const parsed = LichessConnectionStatusSchema.parse({
    connected: true,
    account: {
      lichessUserId: 'lichess-user-id',
      username: 'ExampleUser',
      scopes: [],
      connectedAt: '2026-09-07T05:00:00.000Z',
      expiresAt: null,
    },
    credentialState: 'usable',
    reconnectRequired: false,
  });

  assert.equal(parsed.account.username, 'ExampleUser');
  assert.equal('accessToken' in parsed, false);
  assert.equal('accessToken' in parsed.account, false);
});

test('Lichess connection status rejects accidental token fields', () => {
  const result = LichessConnectionStatusSchema.strict().safeParse({
    connected: false,
    account: null,
    credentialState: 'missing',
    reconnectRequired: true,
    accessToken: 'must-never-cross-wire',
  });
  assert.equal(result.success, false);
});
