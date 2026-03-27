import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { vi } from 'vitest';

const JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-at-least-16-chars';

export interface TestUserData {
  id: string;
  email: string;
  name: string;
  role: 'superadmin' | 'admin' | 'user';
  organizationId: string | null;
}

export const TEST_ORG_ID = '00000000-0000-4000-8000-000000000001';
export const TEST_ORG_ID_2 = '00000000-0000-4000-8000-000000000002';

export const TEST_USER: TestUserData = {
  id: '00000000-0000-4000-8000-000000000010',
  email: 'testuser@example.com',
  name: 'Test User',
  role: 'user',
  organizationId: TEST_ORG_ID,
};

export const TEST_ADMIN: TestUserData = {
  id: '00000000-0000-4000-8000-000000000020',
  email: 'admin@example.com',
  name: 'Test Admin',
  role: 'admin',
  organizationId: TEST_ORG_ID,
};

export const TEST_SUPERADMIN: TestUserData = {
  id: '00000000-0000-4000-8000-000000000030',
  email: 'superadmin@example.com',
  name: 'Super Admin',
  role: 'superadmin',
  organizationId: TEST_ORG_ID,
};

export function generateTestToken(user: Partial<TestUserData> = {}): string {
  const payload = {
    id: user.id ?? TEST_USER.id,
    email: user.email ?? TEST_USER.email,
    name: user.name ?? TEST_USER.name,
    role: user.role ?? TEST_USER.role,
    organizationId: user.organizationId !== undefined ? user.organizationId : TEST_USER.organizationId,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' });
}

export function generateExpiredToken(user: Partial<TestUserData> = {}): string {
  const payload = {
    id: user.id ?? TEST_USER.id,
    email: user.email ?? TEST_USER.email,
    name: user.name ?? TEST_USER.name,
    role: user.role ?? TEST_USER.role,
    organizationId: user.organizationId !== undefined ? user.organizationId : TEST_USER.organizationId,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '0s' });
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function createMockPrisma() {
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

  const mock = {
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
  };

  mock.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
    return fn(mock);
  });

  return mock;
}

export async function buildTestApp(
  routePlugin: (fastify: FastifyInstance) => Promise<void>,
  prefix: string,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);

  app.setErrorHandler((error, _request, reply) => {
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests', statusCode: 429 },
      });
    }
    if (error.validation) {
      return reply.status(422).send({
        error: { code: 'VALIDATION_ERROR', message: error.message, statusCode: 422 },
      });
    }
    return reply.status(error.statusCode ?? 500).send({
      error: { code: 'INTERNAL_ERROR', message: error.message, statusCode: error.statusCode ?? 500 },
    });
  });

  await app.register(routePlugin, { prefix });
  await app.ready();
  return app;
}
