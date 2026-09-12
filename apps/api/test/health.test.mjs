import assert from 'node:assert/strict';
import test from 'node:test';
import { HealthResponseSchema } from '@why-i-suck-at-chess/contracts';
import { buildApp } from '../dist/app.js';

const noDatabase = { $disconnect: async () => undefined };

test('GET /health returns the verified bootstrap contract', async () => {
  const app = await buildApp({
    prisma: noDatabase,
    authConfig: { mode: 'dev-single-user' },
  });
  const response = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(HealthResponseSchema.parse(response.json()), {
    ok: true,
    service: 'why-i-suck-at-chess-api',
  });
  await app.close();
});
