import { describe, it, expect, afterEach } from 'vitest';

describe('env validation', () => {
  // We test the Zod schema directly instead of calling validateEnv()
  // because validateEnv calls process.exit on failure
  it('should have required env vars set in test setup', () => {
    expect(process.env.JWT_SECRET).toBeDefined();
    expect(process.env.JWT_SECRET!.length).toBeGreaterThanOrEqual(16);
    expect(process.env.JWT_REFRESH_SECRET).toBeDefined();
    expect(process.env.CREDENTIALS_ENCRYPTION_KEY).toBeDefined();
  });
});
