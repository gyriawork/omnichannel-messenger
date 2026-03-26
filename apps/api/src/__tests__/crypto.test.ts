import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../lib/crypto.js';

describe('crypto', () => {
  it('should encrypt and decrypt a string', () => {
    const original = 'my-secret-oauth-token-12345';
    const encrypted = encrypt(original);
    expect(encrypted).not.toBe(original);
    expect(encrypted.length).toBeGreaterThan(0);

    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it('should produce different ciphertexts for same plaintext (random IV)', () => {
    const text = 'same-input';
    const enc1 = encrypt(text);
    const enc2 = encrypt(text);
    expect(enc1).not.toBe(enc2); // Different IVs = different output

    // But both decrypt to the same value
    expect(decrypt(enc1)).toBe(text);
    expect(decrypt(enc2)).toBe(text);
  });

  it('should handle empty string', () => {
    const encrypted = encrypt('');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  it('should handle unicode', () => {
    const text = 'Привет мир 🌍 你好世界';
    const encrypted = encrypt(text);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(text);
  });

  it('should handle long strings', () => {
    const text = 'x'.repeat(10000);
    const encrypted = encrypt(text);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(text);
  });

  it('should throw on tampered ciphertext', () => {
    const encrypted = encrypt('test');
    const tampered = encrypted.slice(0, -4) + 'XXXX';
    expect(() => decrypt(tampered)).toThrow();
  });
});
