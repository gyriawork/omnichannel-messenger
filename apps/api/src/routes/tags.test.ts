import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, generateTestToken, authHeader, TEST_ORG_ID, TEST_USER, TEST_ADMIN } from '../test-utils.js';

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

import tagRoutes from './tags.js';

describe('Tag Routes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp(tagRoutes, '/api');
  });

  describe('GET /api/tags', () => {
    it('should list tags for the org', async () => {
      const token = generateTestToken(TEST_USER);
      mockPrisma.tag.findMany.mockResolvedValue([
        { id: 'tag-1', name: 'VIP', color: '#FF0000', organizationId: TEST_ORG_ID, _count: { chats: 3 } },
        { id: 'tag-2', name: 'Support', color: '#00FF00', organizationId: TEST_ORG_ID, _count: { chats: 7 } },
      ]);

      const res = await app.inject({ method: 'GET', url: '/api/tags', headers: authHeader(token) });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tags).toHaveLength(2);
      expect(body.tags[0].name).toBe('VIP');
      expect(body.tags[0].chatCount).toBe(3);
    });

    it('should return 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/tags' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/tags', () => {
    it('should create a tag (admin)', async () => {
      const token = generateTestToken(TEST_ADMIN);
      mockPrisma.tag.findFirst.mockResolvedValue(null);
      mockPrisma.tag.create.mockResolvedValue({
        id: 'new-tag-id', name: 'Urgent', color: '#FF0000', organizationId: TEST_ORG_ID,
      });

      const res = await app.inject({
        method: 'POST', url: '/api/tags', headers: authHeader(token),
        payload: { name: 'Urgent', color: '#FF0000' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().name).toBe('Urgent');
    });

    it('should return 403 for non-admin user', async () => {
      const token = generateTestToken(TEST_USER);
      const res = await app.inject({
        method: 'POST', url: '/api/tags', headers: authHeader(token),
        payload: { name: 'Urgent', color: '#FF0000' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('should return 422 for duplicate tag name', async () => {
      const token = generateTestToken(TEST_ADMIN);
      mockPrisma.tag.findFirst.mockResolvedValue({
        id: 'existing-tag', name: 'Urgent', color: '#00FF00', organizationId: TEST_ORG_ID,
      });

      const res = await app.inject({
        method: 'POST', url: '/api/tags', headers: authHeader(token),
        payload: { name: 'Urgent', color: '#FF0000' },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('PATCH /api/tags/:id', () => {
    it('should update a tag (admin)', async () => {
      const token = generateTestToken(TEST_ADMIN);
      const tagId = '00000000-0000-4000-8000-000000000200';
      mockPrisma.tag.findFirst.mockResolvedValueOnce({
        id: tagId, name: 'Old Name', color: '#FF0000', organizationId: TEST_ORG_ID,
      });
      mockPrisma.tag.update.mockResolvedValue({
        id: tagId, name: 'Old Name', color: '#00FF00', organizationId: TEST_ORG_ID,
      });

      const res = await app.inject({
        method: 'PATCH', url: `/api/tags/${tagId}`, headers: authHeader(token),
        payload: { color: '#00FF00' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().color).toBe('#00FF00');
    });

    it('should return 404 for non-existent tag', async () => {
      const token = generateTestToken(TEST_ADMIN);
      const tagId = '00000000-0000-4000-8000-000000000999';
      mockPrisma.tag.findFirst.mockResolvedValue(null);

      const res = await app.inject({
        method: 'PATCH', url: `/api/tags/${tagId}`, headers: authHeader(token),
        payload: { color: '#00FF00' },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/tags/:id', () => {
    it('should delete a tag (admin)', async () => {
      const token = generateTestToken(TEST_ADMIN);
      const tagId = '00000000-0000-4000-8000-000000000200';
      mockPrisma.tag.findFirst.mockResolvedValue({
        id: tagId, name: 'To Delete', color: '#FF0000', organizationId: TEST_ORG_ID,
      });
      mockPrisma.tag.delete.mockResolvedValue({});

      const res = await app.inject({ method: 'DELETE', url: `/api/tags/${tagId}`, headers: authHeader(token) });
      expect(res.statusCode).toBe(204);
    });

    it('should return 404 for non-existent tag', async () => {
      const token = generateTestToken(TEST_ADMIN);
      const tagId = '00000000-0000-4000-8000-000000000999';
      mockPrisma.tag.findFirst.mockResolvedValue(null);

      const res = await app.inject({ method: 'DELETE', url: `/api/tags/${tagId}`, headers: authHeader(token) });
      expect(res.statusCode).toBe(404);
    });
  });
});
