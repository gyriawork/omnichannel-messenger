import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!key || !/^[0-9a-fA-F]{64,}$/.test(key)) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 64+ character hex string (256 bits)');
  }
  return Buffer.from(key.slice(0, 64), 'hex');
}

/**
 * Encrypt a string using AES-256-GCM.
 * Returns base64-encoded string: IV (16 bytes) + AuthTag (16 bytes) + Ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  const authTag = cipher.getAuthTag();

  // Pack: IV + AuthTag + Ciphertext
  const packed = Buffer.concat([iv, authTag, encrypted]);
  return packed.toString('base64');
}

/**
 * Decrypt a base64-encoded AES-256-GCM encrypted string.
 */
export function decrypt(encryptedBase64: string): string {
  const key = getKey();
  const packed = Buffer.from(encryptedBase64, 'base64');

  // Unpack: IV (16) + AuthTag (16) + Ciphertext (rest)
  const iv = packed.subarray(0, IV_LENGTH);
  const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Encrypt a JSON object (e.g., OAuth credentials).
 */
export function encryptCredentials(data: Record<string, unknown>): string {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypt to a JSON object.
 */
export function decryptCredentials<T = Record<string, unknown>>(encrypted: string): T {
  return JSON.parse(decrypt(encrypted)) as T;
}
