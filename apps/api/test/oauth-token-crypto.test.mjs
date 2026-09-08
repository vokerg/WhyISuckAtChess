import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptToken,
  encryptToken,
} from '../dist/modules/lichess/oauth-token-crypto.js';

const encryptionKey = Buffer.alloc(32, 0x42).toString('base64');

test('Lichess OAuth tokens round-trip through AES-256-GCM without plaintext storage', () => {
  process.env.LICHESS_TOKEN_ENCRYPTION_KEY = encryptionKey;
  const encrypted = encryptToken('oauth-secret-token');

  assert.notEqual(encrypted.ciphertext, 'oauth-secret-token');
  assert.equal(decryptToken(encrypted), 'oauth-secret-token');
});

test('Lichess OAuth token authentication rejects tampering', () => {
  process.env.LICHESS_TOKEN_ENCRYPTION_KEY = encryptionKey;
  const encrypted = encryptToken('oauth-secret-token');
  const bytes = Buffer.from(encrypted.ciphertext, 'base64');
  bytes[0] ^= 0xff;

  assert.throws(() => decryptToken({
    ...encrypted,
    ciphertext: bytes.toString('base64'),
  }));
});

test('Lichess OAuth token crypto rejects invalid encryption keys', () => {
  process.env.LICHESS_TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
  assert.throws(() => encryptToken('oauth-secret-token'), /32-byte key/);
  process.env.LICHESS_TOKEN_ENCRYPTION_KEY = encryptionKey;
});
