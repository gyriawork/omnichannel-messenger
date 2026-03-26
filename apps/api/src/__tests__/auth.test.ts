import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from './helpers.js';
import type { FastifyInstance } from 'fastify';
import prisma from '../lib/prisma.js';
import bcrypt from 'bcryptjs';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('POST /api/auth/register', () => {
  const endpoint = '/api/auth/register';

  beforeEach(async () => {
    // Clean up only register-specific test users
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { startsWith: 'test-register' } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { startsWith: 'test-cookie' } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { startsWith: 'test-dup' } } },
    });
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { startsWith: 'test-short' } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: ['test-register@example.com', 'test-cookie@example.com', 'test-dup@example.com', 'test-short@example.com'] } },
    });
  });

  it('should register a new user and return tokens', async () => {
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: {
        email: 'test-register@example.com',
        password: 'password123',
        name: 'Test User',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.user.email).toBe('test-register@example.com');
    expect(body.user.name).toBe('Test User');
    expect(body.user.role).toBe('user');
    // Should NOT return password
    expect(body.user.passwordHash).toBeUndefined();
  });

  it('should set refreshToken as httpOnly cookie', async () => {
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: {
        email: 'test-cookie@example.com',
        password: 'password123',
        name: 'Cookie Test',
      },
    });

    expect(response.statusCode).toBe(201);
    const cookies = response.cookies;
    const rtCookie = cookies.find((c: any) => c.name === 'refreshToken');
    expect(rtCookie).toBeDefined();
    expect(rtCookie?.httpOnly).toBe(true);
    expect(rtCookie?.path).toBe('/api/auth');
  });

  it('should reject duplicate email', async () => {
    // First register
    await app.inject({
      method: 'POST',
      url: endpoint,
      payload: { email: 'test-dup@example.com', password: 'password123', name: 'First' },
    });

    // Second register with same email
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: { email: 'test-dup@example.com', password: 'password456', name: 'Second' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('should reject short password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: { email: 'test-short@example.com', password: 'abc', name: 'Short' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('should reject invalid email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: { email: 'not-an-email', password: 'password123', name: 'Invalid' },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('POST /api/auth/login', () => {
  const endpoint = '/api/auth/login';

  beforeAll(async () => {
    // Create a test user for login tests
    const hash = await bcrypt.hash('testpass123', 12);
    await prisma.user.upsert({
      where: { email: 'test-login@example.com' },
      update: { passwordHash: hash, status: 'active' },
      create: {
        email: 'test-login@example.com',
        name: 'Login Tester',
        passwordHash: hash,
        role: 'user',
        status: 'active',
      },
    });

    // Create a deactivated user
    const hash2 = await bcrypt.hash('testpass123', 12);
    await prisma.user.upsert({
      where: { email: 'test-deactivated@example.com' },
      update: { passwordHash: hash2, status: 'deactivated' },
      create: {
        email: 'test-deactivated@example.com',
        name: 'Deactivated User',
        passwordHash: hash2,
        role: 'user',
        status: 'deactivated',
      },
    });
  });

  it('should login with valid credentials', async () => {
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: { email: 'test-login@example.com', password: 'testpass123' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    expect(body.user.email).toBe('test-login@example.com');
  });

  it('should reject wrong password', async () => {
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: { email: 'test-login@example.com', password: 'wrongpass' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('should reject non-existent email', async () => {
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: { email: 'nonexistent@example.com', password: 'testpass123' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should reject deactivated user', async () => {
    const response = await app.inject({
      method: 'POST',
      url: endpoint,
      payload: { email: 'test-deactivated@example.com', password: 'testpass123' },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
  });
});

describe('POST /api/auth/refresh', () => {
  it('should return new access token with valid refresh token', async () => {
    // Login first to get a refresh token
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test-login@example.com', password: 'testpass123' },
    });

    const { refreshToken } = loginRes.json();

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accessToken).toBeDefined();
  });

  it('should reject invalid refresh token', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken: 'invalid-token-uuid' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('POST /api/auth/logout', () => {
  it('should invalidate refresh token', async () => {
    // Login
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test-login@example.com', password: 'testpass123' },
    });
    const { refreshToken } = loginRes.json();

    // Logout
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      payload: { refreshToken },
    });
    expect(logoutRes.statusCode).toBe(200);

    // Try to refresh — should fail
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      payload: { refreshToken },
    });
    expect(refreshRes.statusCode).toBe(401);
  });
});
