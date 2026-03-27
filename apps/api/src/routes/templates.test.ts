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
vi.mock('../lib/activity-logger.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

import templateRoutes from './templates.js';

describe('Template Routes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp(templateRoutes, '/api');
  });

  describe('GET /api/templates', () => {
    it('should list templates', async () => {
      const token = generateTestToken(TEST_USER);
      mockPrisma.template.findMany.mockResolvedValue([{
        id: 'tpl-1', name: 'Welcome', messageText: 'Hello {name}!',
        usageCount: 10, organizationId: TEST_ORG_ID, createdById: TEST_USER.id,
        createdBy: { id: TEST_USER.id, name: TEST_USER.name },
        createdAt: new Date(), updatedAt: new Date(),
      }]);
      mockPrisma.template.count.mockResolvedValue(1);

      const res = await app.inject({ method: 'GET', url: '/api/templates', headers: authHeader(token) });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.templates).toHaveLength(1);
      expect(body.templates[0].name).toBe('Welcome');
      expect(body.pagination.total).toBe(1);
    });

    it('should return 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/templates' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/templates', () => {
    it('should create a template', async () => {
      const token = generateTestToken(TEST_USER);
      mockPrisma.template.create.mockResolvedValue({
        id: 'tpl-new', name: 'Follow Up', messageText: 'Just following up on...',
        usageCount: 0, organizationId: TEST_ORG_ID, createdById: TEST_USER.id,
        createdBy: { id: TEST_USER.id, name: TEST_USER.name },
        createdAt: new Date(), updatedAt: new Date(),
      });

      const res = await app.inject({
        method: 'POST', url: '/api/templates', headers: authHeader(token),
        payload: { name: 'Follow Up', messageText: 'Just following up on...' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.name).toBe('Follow Up');
      expect(body.messageText).toBe('Just following up on...');
    });

    it('should return 422 for missing name', async () => {
      const token = generateTestToken(TEST_USER);
      const res = await app.inject({
        method: 'POST', url: '/api/templates', headers: authHeader(token),
        payload: { messageText: 'Some text' },
      });
      expect(res.statusCode).toBe(422);
    });

    it('should return 422 for missing messageText', async () => {
      const token = generateTestToken(TEST_USER);
      const res = await app.inject({
        method: 'POST', url: '/api/templates', headers: authHeader(token),
        payload: { name: 'Template Name' },
      });
      expect(res.statusCode).toBe(422);
    });
  });
});
