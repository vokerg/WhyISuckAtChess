import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('web proxy and launcher honor non-default API and web ports', () => {
  const output = execFileSync(process.execPath, ['-e', `
    const config = require('./scripts/dev-config.cjs');
    const proxy = require('./apps/web/proxy.conf.cjs');
    process.stdout.write(JSON.stringify({ config, target: proxy['/api'].target }));
  `], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: '3123', WEB_APP_URL: 'http://localhost:4321' },
    encoding: 'utf8',
  });
  assert.deepEqual(JSON.parse(output), {
    config: { apiPort: 3123, webPort: 4321 },
    target: 'http://127.0.0.1:3123',
  });
});

test('invalid API port fails before launching child processes', () => {
  assert.throws(() => execFileSync(process.execPath, ['-e', "require('./scripts/dev-config.cjs')"], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: 'not-a-port' },
    stdio: 'pipe',
  }), /PORT must be a valid TCP port/);
});
