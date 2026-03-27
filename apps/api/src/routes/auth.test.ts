import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp } from '../test-utils.js';

const { mockPrisma } = vi.hoisted(() => {
  const mockModel = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    createMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    count: vi.fn(),
    upsert: vi.fn(),
  });

  return {
    mockPrisma: {
      user: mockModel(),
      refreshToken: mockModel(),
      chat: mockModel(),
      chatTag: mockModel(),
      tag: mockModel(),
      template: mockModel(),
      integration: mockModel(),
      organization: mockModel(),
      message: mockModel(),
      chatPreference: mockModel(),
      chatParticipant: mockModel(),
      broadcast: mockModel(),
      activityLog: mockModel(),
      $transaction: vi.fn(),
      $disconnect: vi.fn(),
      $connect: vi.fn(),
    },
  };
});

vi.mock('../lib/prisma.js', () => ({
  default: mockPrisma,
}));

import authRoutes from './auth.js';

describe('Auth Routes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp(authRoutes, '/api/auth');
  });

  // ── POST /api/auth/register ──

  describe('POST /api/auth/register', () => {
    it('should register a new user successfully', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-user-id',
        email: 'newuser@example.com',
        name: 'New User',
        role: 'user',
        organizationId: null,
        passwordHash: 'hashed',
        status: 'active',
      });
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'newuser@example.com',
          password: 'password123',
          name: 'New User',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.user.email).toBe('newuser@example.com');
      expect(body.user.name).toBe('New User');
    });

    it('should return 409 for duplicate email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'existing-user-id',
        email: 'existing@example.com',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'existing@example.com',
          password: 'password123',
          name: 'Existing User',
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 422 for validation error (short password)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'test@example.com',
          password: 'short',
          name: 'Test',
        },
      });

      expect(res.statusCode).toBe(422);
      const body = res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 422 for invalid email', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'not-an-email',
          password: 'password123',
          name: 'Test',
        },
      });

      expect(res.statusCode).toBe(422);
    });
  });

  // ── POST /api/auth/login ──

  describe('POST /api/auth/login', () => {
    it('should login successfully with correct credentials', async () => {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('password123', 12);

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        name: 'Test User',
        role: 'user',
        organizationId: null,
        passwordHash: hash,
        status: 'active',
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.refreshToken.create.mockResolvedValue({});

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'password123',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      expect(body.user.email).toBe('user@example.com');
    });

    it('should return 401 for wrong password', async () => {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('correctpassword', 12);

      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-id',
        email: 'user@example.com',
        name: 'Test User',
        role: 'user',
        organizationId: null,
        passwordHash: hash,
        status: 'active',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'user@example.com',
          password: 'wrongpassword',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('should return 401 for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'nobody@example.com',
          password: 'password123',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });

  // ── POST /api/auth/refresh ──

  describe('POST /api/auth/refresh', () => {
    it('should refresh token successfully', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-id',
        token: 'valid-refresh-token',
        expiresAt: new Date(Date.now() + 86400000),
        user: {
          id: 'user-id',
          email: 'user@example.com',
          name: 'Test User',
          role: 'user',
          organizationId: null,
        },
      });

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: {
          refreshToken: 'valid-refresh-token',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accessToken).toBeDefined();
    });

    it('should return 401 for invalid refresh token', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: {
          refreshToken: 'invalid-token',
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('should return 401 when no refresh token is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: {},
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
