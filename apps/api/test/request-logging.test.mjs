import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import { apiLoggerOptions, registerSafeNotFoundHandler, serializeSafeHttpRequest } from '../dist/request-logging.js';
import { registerLichessRoutes } from '../dist/modules/lichess/lichess.routes.js';
import { LichessOAuthError } from '../dist/modules/lichess/lichess-connection.service.js';

test('request serializer retains route identity but never logs raw query or credential headers', () => {
  const secretCode = 'oauth-code-should-never-appear';
  const secretState = 'pkce-state-should-never-appear';
  const serialized = serializeSafeHttpRequest({
    method: 'GET',
    url: `/api/auth/lichess/callback?code=${secretCode}&state=${secretState}`,
    headers: { authorization: 'Bearer secret-bearer', cookie: '__session=secret-cookie' },
    socket: { remoteAddress: '127.0.0.1', remotePort: 12345 },
  });

  assert.deepEqual(serialized, {
    method: 'GET',
    url: '/api/auth/lichess/callback',
    remoteAddress: '127.0.0.1',
    remotePort: 12345,
  });
  assert.equal(JSON.stringify(serialized).includes(secretCode), false);
  assert.equal(JSON.stringify(serialized).includes(secretState), false);
  assert.equal(JSON.stringify(serialized).includes('secret-bearer'), false);
  assert.equal(JSON.stringify(serialized).includes('secret-cookie'), false);
});

test('actual Fastify request logs and OAuth redirects do not disclose callback secrets', async () => {
  const logs = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      logs.push(chunk.toString());
      done();
    },
  });
  const app = Fastify({ logger: { ...apiLoggerOptions, stream: sink } });
  registerSafeNotFoundHandler(app);
  const code = 'sensitive-code-123';
  const state = 'sensitive-state-456';
  const description = 'sensitive-description-789';
  const queries = [];

  await registerLichessRoutes(app, {
    async handleCallback(query) {
      queries.push(query);
      if (query.error) throw new LichessOAuthError('Provider rejected the callback.');
    },
  });

  try {
    const success = await app.inject({
      method: 'GET',
      url: `/api/auth/lichess/callback?code=${code}&state=${state}`,
    });
    assert.equal(success.statusCode, 302);
    assert.match(success.headers.location, /lichessConnected=1$/);
    assert.equal(success.headers['cache-control'], 'no-store');
    assert.equal(success.headers['referrer-policy'], 'no-referrer');

    const error = await app.inject({
      method: 'GET',
      url: `/api/auth/lichess/callback?state=${state}&error=access_denied&error_description=${description}`,
    });
    assert.equal(error.statusCode, 302);
    assert.match(error.headers.location, /lichessConnected=error$/);
    assert.equal(error.headers['cache-control'], 'no-store');
    assert.equal(error.headers['referrer-policy'], 'no-referrer');

    assert.equal(queries.length, 2);
    assert.equal(queries[0].code, code);
    assert.equal(queries[0].state, state);

    // Fastify's default 404 logger includes the raw URL in a free-form msg;
    // the production-safe fallback must remove the query from logs AND output.
    const missing = await app.inject({ method: 'GET', url: `/missing?code=${code}&state=${state}` });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().message, 'Route GET:/missing not found');
    assert.doesNotMatch(missing.body, /sensitive-code-123|sensitive-state-456/);
  } finally {
    await app.close();
  }

  const output = logs.join('');
  assert.match(output, /\/api\/auth\/lichess\/callback/);
  assert.doesNotMatch(output, /sensitive-code-123|sensitive-state-456|sensitive-description-789/);
  assert.doesNotMatch(output, /error_description|__session|Authorization/);
});
