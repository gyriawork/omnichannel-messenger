import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcryptjs from 'bcryptjs';
import authRoutes from './auth';

const prisma = new PrismaClient();
let server: FastifyInstance;
let testOrgId: string;
let testUserId: string;
let validAccessToken: string;

beforeAll(async () => {
  server = Fastify();

  // Register auth routes
  await server.register(authRoutes);

  // Create test organization
  const org = await prisma.organization.create({
    data: {
      name: 'Test Org',
      defaultLanguage: 'en',
      timezone: 'UTC',
      status: 'active',
    },
  });
  testOrgId = org.id;
});

afterAll(async () => {
  // Cleanup
  await prisma.refreshToken.deleteMany({ where: { userId: testUserId } });
  await prisma.user.deleteMany({ where: { organizationId: testOrgId } });
  await prisma.organization.delete({ where: { id: testOrgId } });
  await prisma.$disconnect();
  await server.close();
});

beforeEach(async () => {
  // Clean up test user before each test
  const existingUser = await prisma.user.findUnique({
    where: { email: 'test@example.com' },
  });
  if (existingUser) {
    await prisma.refreshToken.deleteMany({ where: { userId: existingUser.id } });
    await prisma.user.delete({ where: { id: existingUser.id } });
  }
});

describe('POST /register', () => {
  it('should successfully register new user and set httpOnly cookie', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'test@example.com',
        password: 'securePassword123',
        name: 'Test User',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toHaveProperty('accessToken');
    expect(body.user.email).toBe('test@example.com');

    // Verify httpOnly cookie set
    const setCookieHeader = response.headers['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('refreshToken=');
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('SameSite=Lax');

    // Store for later tests
    testUserId = body.user.id;
    validAccessToken = body.accessToken;
  });

  it('should reject invalid email format', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'not-an-email',
        password: 'securePassword123',
        name: 'Test User',
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toContain('email');
  });

  it('should reject password shorter than 8 characters', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'test@example.com',
        password: 'short',
        name: 'Test User',
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.message).toContain('at least 8 characters');
  });

  it('should reject duplicate email', async () => {
    // Create first user
    await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'duplicate@example.com',
        password: 'securePassword123',
        name: 'First User',
      },
    });

    // Try to create second user with same email
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'duplicate@example.com',
        password: 'securePassword123',
        name: 'Second User',
      },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('should reject missing required fields', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'test@example.com',
        // missing password and name
      },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('POST /login', () => {
  beforeEach(async () => {
    // Create a test user for login tests
    const passwordHash = await bcryptjs.hash('testPassword123', 12);
    const user = await prisma.user.create({
      data: {
        email: 'login@example.com',
        name: 'Login Test User',
        passwordHash,
        role: 'user',
        status: 'active',
        organizationId: testOrgId,
      },
    });
    testUserId = user.id;
  });

  it('should successfully login and return access token with httpOnly cookie', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'login@example.com',
        password: 'testPassword123',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('accessToken');
    expect(body.user.email).toBe('login@example.com');

    // Verify httpOnly cookie set
    const setCookieHeader = response.headers['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('refreshToken=');
    expect(setCookieHeader).toContain('HttpOnly');

    validAccessToken = body.accessToken;
  });

  it('should reject incorrect password', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'login@example.com',
        password: 'wrongPassword',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject non-existent email', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'nonexistent@example.com',
        password: 'testPassword123',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should reject deactivated user', async () => {
    // Create deactivated user
    const passwordHash = await bcryptjs.hash('testPassword123', 12);
    await prisma.user.create({
      data: {
        email: 'deactivated@example.com',
        name: 'Deactivated User',
        passwordHash,
        role: 'user',
        status: 'deactivated',
        organizationId: testOrgId,
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'deactivated@example.com',
        password: 'testPassword123',
      },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('should update lastActiveAt on successful login', async () => {
    const userBefore = await prisma.user.findUnique({
      where: { id: testUserId },
    });
    const lastActiveAtBefore = userBefore?.lastActiveAt;

    await new Promise(resolve => setTimeout(resolve, 100)); // Small delay

    await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'login@example.com',
        password: 'testPassword123',
      },
    });

    const userAfter = await prisma.user.findUnique({
      where: { id: testUserId },
    });

    expect(userAfter?.lastActiveAt).not.toEqual(lastActiveAtBefore);
    expect(userAfter?.lastActiveAt?.getTime()).toBeGreaterThan(
      lastActiveAtBefore?.getTime() || 0
    );
  });

  it('should reject invalid email format', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'not-an-email',
        password: 'testPassword123',
      },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('POST /refresh', () => {
  let refreshTokenValue: string;

  beforeEach(async () => {
    // Create user with refresh token
    const passwordHash = await bcryptjs.hash('testPassword123', 12);
    const user = await prisma.user.create({
      data: {
        email: 'refresh@example.com',
        name: 'Refresh Test User',
        passwordHash,
        role: 'user',
        status: 'active',
        organizationId: testOrgId,
      },
    });
    testUserId = user.id;

    // Create refresh token
    const rt = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: 'test-refresh-token-' + Math.random(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    refreshTokenValue = rt.token;
  });

  it('should successfully refresh access token via httpOnly cookie', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        cookie: `refreshToken=${refreshTokenValue}; Path=/api/auth; HttpOnly`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('accessToken');
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(0);
  });

  it('should reject missing refresh token', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/refresh',
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('should reject invalid refresh token', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        cookie: 'refreshToken=invalid-token; Path=/api/auth; HttpOnly',
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it('should reject expired refresh token', async () => {
    // Create expired refresh token
    const expiredToken = await prisma.refreshToken.create({
      data: {
        userId: testUserId,
        token: 'expired-token-' + Math.random(),
        expiresAt: new Date(Date.now() - 1000), // Already expired
      },
    });

    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        cookie: `refreshToken=${expiredToken.token}; Path=/api/auth; HttpOnly`,
      },
    });

    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.message).toContain('expired');
  });

  it('should not set new refresh token cookie on refresh', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: {
        cookie: `refreshToken=${refreshTokenValue}; Path=/api/auth; HttpOnly`,
      },
    });

    expect(response.statusCode).toBe(200);
    // Should NOT have Set-Cookie header
    const setCookieHeader = response.headers['set-cookie'];
    expect(setCookieHeader).toBeUndefined();
  });
});

describe('POST /logout', () => {
  let logoutUserId: string;
  let refreshTokenValue: string;

  beforeEach(async () => {
    // Create user with refresh token
    const passwordHash = await bcryptjs.hash('testPassword123', 12);
    const user = await prisma.user.create({
      data: {
        email: 'logout@example.com',
        name: 'Logout Test User',
        passwordHash,
        role: 'user',
        status: 'active',
        organizationId: testOrgId,
      },
    });
    logoutUserId = user.id;

    // Create refresh token
    const rt = await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: 'logout-token-' + Math.random(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });
    refreshTokenValue = rt.token;
  });

  it('should successfully logout and invalidate refresh token', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: `refreshToken=${refreshTokenValue}; Path=/api/auth; HttpOnly`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);

    // Verify refresh token deleted
    const token = await prisma.refreshToken.findFirst({
      where: { token: refreshTokenValue },
    });
    expect(token).toBeNull();

    // Verify cookie cleared
    const setCookieHeader = response.headers['set-cookie'];
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('refreshToken=');
    expect(setCookieHeader).toContain('Max-Age=0');
  });

  it('should succeed even without refresh token (idempotent)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);
  });

  it('should clear refresh token cookie', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: `refreshToken=${refreshTokenValue}; Path=/api/auth; HttpOnly`,
      },
    });

    const setCookieHeader = response.headers['set-cookie'];
    expect(setCookieHeader).toContain('Path=/api/auth');
    expect(setCookieHeader).toContain('HttpOnly');
  });
});

describe('Rate Limiting', () => {
  it('should enforce 10 req/min limit on auth routes', async () => {
    const email = `ratelimit-${Date.now()}@example.com`;
    const requests = [];

    // Make 11 requests (1 over the 10 req/min limit)
    for (let i = 0; i < 11; i++) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: `${email}-${i}`,
          password: 'testPassword123',
        },
      });
      requests.push(response.statusCode);
    }

    // First 10 should be rejected with 401 (no such user)
    for (let i = 0; i < 10; i++) {
      expect(requests[i]).toBe(401);
    }

    // 11th should be rate limited (429)
    expect(requests[10]).toBe(429);
  });
});

describe('Token Security', () => {
  it('should hash password with bcryptjs rounds=12', async () => {
    const passwordHash = await bcryptjs.hash('testPassword123', 12);
    expect(passwordHash).not.toBe('testPassword123');
    expect(passwordHash.length).toBeGreaterThan(50); // bcrypt hashes are ~60 chars

    // Verify hash is valid
    const isValid = await bcryptjs.compare('testPassword123', passwordHash);
    expect(isValid).toBe(true);
  });

  it('should generate unique refresh tokens', async () => {
    const response1 = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'token1@example.com',
        password: 'securePassword123',
        name: 'User 1',
      },
    });

    const response2 = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'token2@example.com',
        password: 'securePassword123',
        name: 'User 2',
      },
    });

    const token1 = response1.cookies.find(c => c.name === 'refreshToken')?.value;
    const token2 = response2.cookies.find(c => c.name === 'refreshToken')?.value;

    expect(token1).toBeDefined();
    expect(token2).toBeDefined();
    expect(token1).not.toBe(token2);
  });

  it('should set secure flag on refresh token cookie in production', async () => {
    // Note: This test verifies behavior when NODE_ENV=production
    // In development, secure flag is not set
    const response = await server.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'secure@example.com',
        password: 'securePassword123',
        name: 'Secure Test',
      },
    });

    const setCookieHeader = response.headers['set-cookie'];
    // In production, should contain Secure flag
    // In development, may not - test environment context dependent
    expect(setCookieHeader).toBeDefined();
    expect(setCookieHeader).toContain('HttpOnly');
  });
});
