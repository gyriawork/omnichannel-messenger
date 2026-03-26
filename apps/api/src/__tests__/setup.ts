import { beforeAll, afterAll } from 'vitest';

// Set test environment variables
process.env.JWT_SECRET = 'test-jwt-secret-at-least-16-chars';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-16chars';
process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-encryption-key-32-chars!!';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://anton@localhost:5432/omnichannel';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
process.env.NODE_ENV = 'test';
