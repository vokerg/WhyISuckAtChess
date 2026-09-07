import crypto from 'node:crypto';

export interface EncryptedTokenRecord {
  ciphertext: string;
  iv: string;
  authTag: string;
}

const algorithm = 'aes-256-gcm';

export function encryptToken(plainText: string): EncryptedTokenRecord {
  const key = readTokenEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptToken(record: EncryptedTokenRecord): string {
  const key = readTokenEncryptionKey();
  const decipher = crypto.createDecipheriv(algorithm, key, Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'));
  const plainText = Buffer.concat([
    decipher.update(Buffer.from(record.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plainText.toString('utf8');
}

function readTokenEncryptionKey(): Buffer {
  const encoded = process.env['LICHESS_TOKEN_ENCRYPTION_KEY'];
  if (!encoded) {
    throw new Error('LICHESS_TOKEN_ENCRYPTION_KEY is required for Lichess OAuth token encryption.');
  }

  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32) {
    throw new Error('LICHESS_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key for AES-256-GCM.');
  }
  return key;
}
