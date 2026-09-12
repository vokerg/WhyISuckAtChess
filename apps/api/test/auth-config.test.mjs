import assert from 'node:assert/strict';
import test from 'node:test';
import { loadAuthConfig } from '../dist/auth/auth.config.js';

const AUTH_ENV_NAMES = [
  'AUTH_MODE',
  'NODE_ENV',
  'CLERK_JWT_ISSUER',
  'CLERK_JWKS_URL',
  'CLERK_JWT_AUDIENCE',
  'CLERK_AUTHORIZED_PARTIES',
];

function withAuthEnv(overrides, callback) {
  const previous = new Map(AUTH_ENV_NAMES.map((name) => [name, process.env[name]]));

  try {
    for (const name of AUTH_ENV_NAMES) {
      const value = Object.hasOwn(overrides, name) ? overrides[name] : undefined;
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    return callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

test('missing AUTH_MODE fails closed even outside production', () => {
  withAuthEnv({ NODE_ENV: 'development' }, () => {
    assert.throws(
      () => loadAuthConfig(),
      /AUTH_MODE is required and must be either dev-single-user or clerk/,
    );
  });
});

test('unsupported AUTH_MODE fails closed', () => {
  withAuthEnv({ AUTH_MODE: 'anything-else', NODE_ENV: 'development' }, () => {
    assert.throws(
      () => loadAuthConfig(),
      /AUTH_MODE is required and must be either dev-single-user or clerk/,
    );
  });
});

test('explicit dev-single-user mode remains available outside production', () => {
  withAuthEnv({ AUTH_MODE: 'dev-single-user', NODE_ENV: 'development' }, () => {
    assert.deepEqual(loadAuthConfig(), { mode: 'dev-single-user' });
  });
});

test('explicit Clerk mode loads the required verification configuration', () => {
  withAuthEnv({
    AUTH_MODE: 'clerk',
    NODE_ENV: 'production',
    CLERK_JWT_ISSUER: 'https://issuer.example',
    CLERK_JWKS_URL: 'https://issuer.example/.well-known/jwks.json',
    CLERK_JWT_AUDIENCE: 'why-api',
    CLERK_AUTHORIZED_PARTIES: 'https://app.example, http://localhost:4200',
  }, () => {
    const config = loadAuthConfig();
    assert.equal(config.mode, 'clerk');
    assert.equal(config.issuer, 'https://issuer.example');
    assert.equal(config.jwksUrl.href, 'https://issuer.example/.well-known/jwks.json');
    assert.equal(config.audience, 'why-api');
    assert.deepEqual(config.authorizedParties, ['https://app.example', 'http://localhost:4200']);
  });
});

test('dev-single-user remains forbidden in production', () => {
  withAuthEnv({ AUTH_MODE: 'dev-single-user', NODE_ENV: 'production' }, () => {
    assert.throws(
      () => loadAuthConfig(),
      /AUTH_MODE=dev-single-user is not allowed when NODE_ENV=production/,
    );
  });
});
