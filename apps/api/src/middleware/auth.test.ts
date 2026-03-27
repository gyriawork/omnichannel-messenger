import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { generateTestToken, generateExpiredToken, authHeader, TEST_USER, TEST_ADMIN } from '../test-utils.js';
import { authenticate } from './auth.js';
import { requireRole } from './rbac.js';

describe('Auth Middleware', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ logger: false });

    // A test route that uses authenticate
    app.get(
      '/test',
      { preHandler: [authenticate] },
      async (request, reply) => {
        return reply.send({ user: request.user });
      },
    );

    // A test route that requires admin role
    app.get(
      '/admin-only',
      { preHandler: [authenticate, requireRole('admin', 'superadmin')] },
      async (request, reply) => {
        return reply.send({ user: request.user });
      },
    );

    await app.ready();
  });

  describe('authenticate', () => {
    it('should pass with a valid JWT', async () => {
      const token = generateTestToken(TEST_USER);

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: authHeader(token),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.id).toBe(TEST_USER.id);
      expect(body.user.email).toBe(TEST_USER.email);
      expect(body.user.role).toBe('user');
    });

    it('should return 401 for expired JWT', async () => {
      const token = generateExpiredToken(TEST_USER);

      // Wait a bit for the token to actually expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: authHeader(token),
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('should return 401 for missing Authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('should return 401 for malformed Authorization header', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: { Authorization: 'NotBearer token123' },
      });

      expect(res.statusCode).toBe(401);
    });

    it('should return 401 for invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/test',
        headers: authHeader('totally-invalid-jwt-token'),
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });
  });

  describe('requireRole', () => {
    it('should allow admin to access admin-only route', async () => {
      const token = generateTestToken(TEST_ADMIN);

      const res = await app.inject({
        method: 'GET',
        url: '/admin-only',
        headers: authHeader(token),
      });

      expect(res.statusCode).toBe(200);
    });

    it('should block regular user from admin-only route', async () => {
      const token = generateTestToken(TEST_USER);

      const res = await app.inject({
        method: 'GET',
        url: '/admin-only',
        headers: authHeader(token),
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
    });
  });
});
