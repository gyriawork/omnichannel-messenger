import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, generateTestToken, authHeader, TEST_ORG_ID, TEST_USER } from '../test-utils.js';

const { mockPrisma } = vi.hoisted(() => {
  const mockModel = () => ({
    findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), createMany: vi.fn(), update: vi.fn(),
    updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(),
    count: vi.fn(), upsert: vi.fn(),
  });
  return {
    mockPrisma: {
      user: mockModel(), refreshToken: mockModel(), chat: mockModel(),
      chatTag: mockModel(), tag: mockModel(), template: mockModel(),
      integration: mockModel(), organization: mockModel(), message: mockModel(),
      chatPreference: mockModel(), chatParticipant: mockModel(),
      broadcast: mockModel(), activityLog: mockModel(),
      $transaction: vi.fn(), $disconnect: vi.fn(), $connect: vi.fn(),
    },
  };
});

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }));
vi.mock('../lib/crypto.js', () => ({
  encryptCredentials: vi.fn((c: unknown) => JSON.stringify(c)),
  decryptCredentials: vi.fn((s: string) => JSON.parse(s)),
}));
vi.mock('../integrations/factory.js', () => ({
  createAdapter: vi.fn(() => ({
    connect: vi.fn(), disconnect: vi.fn(),
    getStatus: vi.fn().mockReturnValue('disconnected'),
    listChats: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../integrations/base.js', () => ({
  MessengerError: class MessengerError extends Error {},
}));
vi.mock('../websocket/index.js', () => ({
  getIO: vi.fn(() => ({ to: vi.fn().mockReturnThis(), emit: vi.fn() })),
}));

import integrationRoutes from './integrations.js';

describe('Integration Routes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp(integrationRoutes, '/api');
  });

  describe('GET /api/integrations', () => {
    it('should list integrations for the org', async () => {
      const token = generateTestToken(TEST_USER);
      mockPrisma.integration.findMany.mockResolvedValue([{
        id: 'int-1', messenger: 'telegram', status: 'connected', settings: {},
        organizationId: TEST_ORG_ID, userId: TEST_USER.id,
        connectedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        credentials: 'encrypted',
      }]);

      const res = await app.inject({ method: 'GET', url: '/api/integrations', headers: authHeader(token) });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.integrations).toHaveLength(1);
      expect(body.integrations[0].messenger).toBe('telegram');
      expect(body.integrations[0].credentials).toBeUndefined();
    });

    it('should return 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/integrations' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/integrations/:messenger/disconnect', () => {
    it('should disconnect an integration', async () => {
      const token = generateTestToken(TEST_USER);
      mockPrisma.integration.findFirst.mockResolvedValue({
        id: 'int-1', messenger: 'telegram', status: 'connected', settings: {},
        organizationId: TEST_ORG_ID, userId: TEST_USER.id,
        credentials: JSON.stringify({ apiId: 123, apiHash: 'abc' }),
        connectedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      });
      mockPrisma.integration.update.mockResolvedValue({
        id: 'int-1', messenger: 'telegram', status: 'disconnected', settings: {},
        organizationId: TEST_ORG_ID, userId: TEST_USER.id,
        connectedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      });

      const res = await app.inject({
        method: 'POST', url: '/api/integrations/telegram/disconnect', headers: authHeader(token),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().integration.status).toBe('disconnected');
    });

    it('should return 404 when no integration found', async () => {
      const token = generateTestToken(TEST_USER);
      mockPrisma.integration.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST', url: '/api/integrations/telegram/disconnect', headers: authHeader(token),
      });
      expect(res.statusCode).toBe(404);
    });
  });
});
