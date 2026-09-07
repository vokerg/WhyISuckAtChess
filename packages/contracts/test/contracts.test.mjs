import assert from 'node:assert/strict';
import test from 'node:test';
import { HealthResponseSchema } from '../dist/index.js';

test('health response contract accepts the bootstrap payload', () => {
  assert.deepEqual(
    HealthResponseSchema.parse({ ok: true, service: 'why-i-suck-at-chess-api' }),
    { ok: true, service: 'why-i-suck-at-chess-api' },
  );
});

test('health response contract rejects unrelated payloads', () => {
  assert.equal(HealthResponseSchema.safeParse({ ok: false }).success, false);
});
