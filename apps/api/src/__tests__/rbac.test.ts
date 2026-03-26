import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth.js';
import { requireRole, requireMinRole, requireOrganization, getOrgId } from '../middleware/rbac.js';

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-16-chars';

function makeToken(overrides: Record<string, unknown> = {}) {
  return jwt.sign(
    {
      id: 'user-1',
      email: 'test@test.com',
      name: 'Test',
      role: 'user',
      organizationId: 'org-1',
      ...overrides,
    },
    JWT_SECRET,
    { expiresIn: '15m' },
  );
}

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });

  // Auth-only route
  app.get('/auth-test', { preHandler: [authenticate] }, async (req) => ({
    user: req.user,
  }));

  // Role-specific routes
  app.get(
    '/admin-only',
    { preHandler: [authenticate, requireRole('admin', 'superadmin')] },
    async () => ({ ok: true }),
  );

  app.get(
    '/superadmin-only',
    { preHandler: [authenticate, requireRole('superadmin')] },
    async () => ({ ok: true }),
  );

  // Min role route
  app.get(
    '/min-admin',
    { preHandler: [authenticate, requireMinRole('admin')] },
    async () => ({ ok: true }),
  );

  // Org check route
  app.get(
    '/org-check',
    { preHandler: [authenticate, requireOrganization()] },
    async (req) => ({ orgId: getOrgId(req) }),
  );

  // Org check with param
  app.get(
    '/org-check/:organizationId',
    { preHandler: [authenticate, requireOrganization()] },
    async (req) => ({ orgId: getOrgId(req) }),
  );

  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// ── authenticate middleware ──

describe('authenticate middleware', () => {
  it('should reject missing Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth-test' });
    expect(res.statusCode).toBe(401);
  });

  it('should reject malformed header (no Bearer prefix)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth-test',
      headers: { authorization: 'Basic abc123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should reject expired token', async () => {
    const expiredToken = jwt.sign(
      { id: 'u1', email: 'e', name: 'n', role: 'user', organizationId: null },
      JWT_SECRET,
      { expiresIn: '0s' },
    );
    // Wait a tiny bit for expiry
    await new Promise((r) => setTimeout(r, 100));

    const res = await app.inject({
      method: 'GET',
      url: '/auth-test',
      headers: { authorization: `Bearer ${expiredToken}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.message).toContain('expired');
  });

  it('should reject invalid token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth-test',
      headers: { authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('should accept valid token and set request.user', async () => {
    const token = makeToken({ id: 'user-abc', role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/auth-test',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user.id).toBe('user-abc');
    expect(body.user.role).toBe('admin');
  });
});

// ── requireRole ──

describe('requireRole middleware', () => {
  it('should allow admin to access admin-only route', async () => {
    const token = makeToken({ role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should allow superadmin to access admin-only route', async () => {
    const token = makeToken({ role: 'superadmin' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should reject user from admin-only route', async () => {
    const token = makeToken({ role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/admin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('should reject admin from superadmin-only route', async () => {
    const token = makeToken({ role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/superadmin-only',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── requireMinRole ──

describe('requireMinRole middleware', () => {
  it('should allow admin when min is admin', async () => {
    const token = makeToken({ role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/min-admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should allow superadmin when min is admin', async () => {
    const token = makeToken({ role: 'superadmin' });
    const res = await app.inject({
      method: 'GET',
      url: '/min-admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should reject user when min is admin', async () => {
    const token = makeToken({ role: 'user' });
    const res = await app.inject({
      method: 'GET',
      url: '/min-admin',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

// ── requireOrganization ──

describe('requireOrganization middleware', () => {
  it('should allow user accessing own org', async () => {
    const token = makeToken({ organizationId: 'org-1' });
    const res = await app.inject({
      method: 'GET',
      url: '/org-check',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().orgId).toBe('org-1');
  });

  it('should reject user accessing different org via params', async () => {
    const token = makeToken({ organizationId: 'org-1' });
    const res = await app.inject({
      method: 'GET',
      url: '/org-check/org-2',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('should allow superadmin to access any org', async () => {
    const token = makeToken({ role: 'superadmin', organizationId: 'org-1' });
    const res = await app.inject({
      method: 'GET',
      url: '/org-check/org-2',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('should reject user with no organizationId', async () => {
    const token = makeToken({ organizationId: null });
    const res = await app.inject({
      method: 'GET',
      url: '/org-check',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ── getOrgId helper ──

describe('getOrgId helper', () => {
  it('should return user org for regular user', async () => {
    const token = makeToken({ organizationId: 'org-123' });
    const res = await app.inject({
      method: 'GET',
      url: '/org-check',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.json().orgId).toBe('org-123');
  });
});
