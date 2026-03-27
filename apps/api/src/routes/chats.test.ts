import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildTestApp, generateTestToken, authHeader, TEST_ORG_ID, TEST_USER, TEST_ADMIN } from '../test-utils.js';

const { mockPrisma } = vi.hoisted(() => {
  const mockModel = () => ({
    findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), createMany: vi.fn(), update: vi.fn(),
    updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(),
    count: vi.fn(), upsert: vi.fn(),
  });
  const mp = {
    user: mockModel(), refreshToken: mockModel(), chat: mockModel(),
    chatTag: mockModel(), tag: mockModel(), template: mockModel(),
    integration: mockModel(), organization: mockModel(), message: mockModel(),
    chatPreference: mockModel(), chatParticipant: mockModel(),
    broadcast: mockModel(), activityLog: mockModel(),
    $transaction: vi.fn(), $disconnect: vi.fn(), $connect: vi.fn(),
  };
  return { mockPrisma: mp };
});

vi.mock('../lib/prisma.js', () => ({ default: mockPrisma }));
vi.mock('../lib/crypto.js', () => ({
  encryptCredentials: vi.fn((c: unknown) => JSON.stringify(c)),
  decryptCredentials: vi.fn((s: string) => JSON.parse(s)),
}));
vi.mock('../integrations/factory.js', () => ({
  createAdapter: vi.fn(() => ({
    connect: vi.fn(), disconnect: vi.fn(), listChats: vi.fn().mockResolvedValue([]),
  })),
}));
vi.mock('../integrations/base.js', () => ({
  MessengerError: class MessengerError extends Error {},
}));

import chatRoutes from './chats.js';

describe('Chat Routes', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma));
    app = await buildTestApp(chatRoutes, '/api');
  });

  describe('GET /api/chats', () => {
    it('should return chats filtered by org', async () => {
      const token = generateTestToken(TEST_USER);
      mockPrisma.chat.findMany.mockResolvedValue([{
        id: 'chat-1', name: 'Test Chat', messenger: 'telegram',
        externalChatId: 'tg_001', chatType: 'direct', status: 'active',
        organizationId: TEST_ORG_ID, ownerId: null, owner: null,
        importedById: TEST_USER.id, messageCount: 5,
        lastActivityAt: new Date(), tags: [], messages: [], preferences: [],
        createdAt: new Date(), updatedAt: new Date(),
      }]);
      mockPrisma.chat.count.mockResolvedValue(1);

      const res = await app.inject({ method: 'GET', url: '/api/chats', headers: authHeader(token) });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.chats).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.chats[0].name).toBe('Test Chat');
    });

    it('should return 401 without auth', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/chats' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/chats/import', () => {
    it('should import chats successfully', async () => {
      const token = generateTestToken(TEST_USER);
      mockPrisma.chat.findMany.mockResolvedValueOnce([]);
      mockPrisma.chat.createMany.mockResolvedValue({ count: 2 });
      mockPrisma.chat.findMany.mockResolvedValueOnce([
        { id: 'c1', name: 'Chat 1', messenger: 'telegram', externalChatId: 'tg_001', organizationId: TEST_ORG_ID },
        { id: 'c2', name: 'Chat 2', messenger: 'telegram', externalChatId: 'tg_002', organizationId: TEST_ORG_ID },
      ]);

      const res = await app.inject({
        method: 'POST', url: '/api/chats/import', headers: authHeader(token),
        payload: {
          messenger: 'telegram',
          chats: [
            { externalChatId: 'tg_001', name: 'Chat 1', chatType: 'direct' },
            { externalChatId: 'tg_002', name: 'Chat 2', chatType: 'group' },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.imported).toBe(2);
      expect(body.skipped).toBe(0);
    });

    it('should return 422 for empty chats array', async () => {
      const token = generateTestToken(TEST_USER);
      const res = await app.inject({
        method: 'POST', url: '/api/chats/import', headers: authHeader(token),
        payload: { messenger: 'telegram', chats: [] },
      });
      expect(res.statusCode).toBe(422);
    });

    it('should return 422 for invalid messenger', async () => {
      const token = generateTestToken(TEST_USER);
      const res = await app.inject({
        method: 'POST', url: '/api/chats/import', headers: authHeader(token),
        payload: { messenger: 'invalid', chats: [{ externalChatId: 'x', name: 'X' }] },
      });
      expect(res.statusCode).toBe(422);
    });
  });

  describe('PATCH /api/chats/:id', () => {
    it('should update a chat (admin)', async () => {
      const token = generateTestToken(TEST_ADMIN);
      const chatId = '00000000-0000-4000-8000-000000000100';

      mockPrisma.chat.findFirst.mockResolvedValueOnce({ id: chatId, organizationId: TEST_ORG_ID, status: 'active' });
      mockPrisma.chat.update.mockResolvedValue({
        id: chatId, name: 'Updated Chat', messenger: 'telegram',
        externalChatId: 'tg_001', chatType: 'direct', status: 'read-only',
        organizationId: TEST_ORG_ID, ownerId: null, importedById: TEST_USER.id,
        messageCount: 0, lastActivityAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
      });
      mockPrisma.chat.findFirst.mockResolvedValueOnce({ id: chatId, tags: [], owner: null });

      const res = await app.inject({
        method: 'PATCH', url: `/api/chats/${chatId}`, headers: authHeader(token),
        payload: { status: 'read-only' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('read-only');
    });

    it('should return 403 for non-admin user', async () => {
      const token = generateTestToken(TEST_USER);
      const chatId = '00000000-0000-4000-8000-000000000100';
      const res = await app.inject({
        method: 'PATCH', url: `/api/chats/${chatId}`, headers: authHeader(token),
        payload: { status: 'read-only' },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
