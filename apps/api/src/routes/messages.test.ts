import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcryptjs from 'bcryptjs';
import messageRoutes from './messages';

const prisma = new PrismaClient();
let server: FastifyInstance;
let testOrgId: string;
let testUserId: string;
let testUserName: string;
let testChatId: string;
let testChat2Id: string;
let authToken: string;

// Other-org user for cross-org tests
let otherOrgId: string;
let otherUserId: string;
let otherAuthToken: string;

function generateToken(payload: {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string | null;
}): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '15m' });
}

beforeAll(async () => {
  server = Fastify();
  await server.register(messageRoutes);

  // Create test organization and user
  const org = await prisma.organization.create({
    data: { name: 'Msg Test Org', defaultLanguage: 'en', timezone: 'UTC', status: 'active' },
  });
  testOrgId = org.id;

  const passwordHash = await bcryptjs.hash('testpass123', 12);
  const user = await prisma.user.create({
    data: {
      email: 'test@messages.com',
      name: 'Message Test User',
      passwordHash,
      role: 'admin',
      status: 'active',
      organizationId: testOrgId,
    },
  });
  testUserId = user.id;
  testUserName = user.name;
  authToken = generateToken({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: testOrgId,
  });

  // Create two test chats
  const chat = await prisma.chat.create({
    data: {
      name: 'Test Chat 1',
      messenger: 'telegram',
      externalChatId: 'msg-tg-123',
      chatType: 'direct',
      status: 'active',
      organizationId: testOrgId,
      importedById: testUserId,
    },
  });
  testChatId = chat.id;

  const chat2 = await prisma.chat.create({
    data: {
      name: 'Test Chat 2',
      messenger: 'slack',
      externalChatId: 'msg-sl-456',
      chatType: 'group',
      status: 'active',
      organizationId: testOrgId,
      importedById: testUserId,
    },
  });
  testChat2Id = chat2.id;

  // Create other organization + user for cross-org access tests
  const otherOrg = await prisma.organization.create({
    data: { name: 'Other Org', defaultLanguage: 'en', timezone: 'UTC', status: 'active' },
  });
  otherOrgId = otherOrg.id;

  const otherUser = await prisma.user.create({
    data: {
      email: 'other@messages.com',
      name: 'Other User',
      passwordHash,
      role: 'admin',
      status: 'active',
      organizationId: otherOrgId,
    },
  });
  otherUserId = otherUser.id;
  otherAuthToken = generateToken({
    id: otherUser.id,
    email: otherUser.email,
    name: otherUser.name,
    role: otherUser.role,
    organizationId: otherOrgId,
  });
});

afterAll(async () => {
  // Cleanup in correct order due to foreign keys
  const orgIds = [testOrgId, otherOrgId];
  await prisma.reaction.deleteMany({ where: { message: { chat: { organizationId: { in: orgIds } } } } });
  await prisma.message.deleteMany({ where: { chat: { organizationId: { in: orgIds } } } });
  await prisma.chat.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.activityLog.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: orgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
  await server.close();
});

beforeEach(async () => {
  // Clean messages and reactions between tests
  await prisma.reaction.deleteMany({ where: { message: { chat: { organizationId: { in: [testOrgId, otherOrgId] } } } } });
  await prisma.message.deleteMany({ where: { chat: { organizationId: { in: [testOrgId, otherOrgId] } } } });
});

// ─── GET /chats/:chatId/messages ───

describe('GET /chats/:chatId/messages', () => {
  it('should return empty list when no messages', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messages).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('should list messages in descending order', async () => {
    // Create several messages with staggered timestamps
    const msg1 = await prisma.message.create({
      data: { chatId: testChatId, senderName: 'Alice', text: 'First', isSelf: false },
    });
    await new Promise((r) => setTimeout(r, 50));
    const msg2 = await prisma.message.create({
      data: { chatId: testChatId, senderName: 'Bob', text: 'Second', isSelf: false },
    });
    await new Promise((r) => setTimeout(r, 50));
    const msg3 = await prisma.message.create({
      data: { chatId: testChatId, senderName: 'Alice', text: 'Third', isSelf: false },
    });

    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messages).toHaveLength(3);
    // Most recent first
    expect(body.messages[0].text).toBe('Third');
    expect(body.messages[1].text).toBe('Second');
    expect(body.messages[2].text).toBe('First');
  });

  it('should support cursor-based pagination', async () => {
    // Create 5 messages
    for (let i = 1; i <= 5; i++) {
      await prisma.message.create({
        data: { chatId: testChatId, senderName: 'User', text: `Message ${i}`, isSelf: false },
      });
      await new Promise((r) => setTimeout(r, 20));
    }

    // Get first page with limit=2
    const page1 = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages?limit=2`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(page1.statusCode).toBe(200);
    const body1 = page1.json();
    expect(body1.messages).toHaveLength(2);
    expect(body1.nextCursor).toBeTruthy();

    // Get second page using cursor
    const page2 = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages?limit=2&cursor=${body1.nextCursor}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(page2.statusCode).toBe(200);
    const body2 = page2.json();
    expect(body2.messages).toHaveLength(2);

    // Ensure no overlap between pages
    const page1Ids = body1.messages.map((m: { id: string }) => m.id);
    const page2Ids = body2.messages.map((m: { id: string }) => m.id);
    for (const id of page2Ids) {
      expect(page1Ids).not.toContain(id);
    }
  });

  it('should include reply-to previews', async () => {
    const parent = await prisma.message.create({
      data: {
        chatId: testChatId,
        senderName: 'Alice',
        text: 'This is the original long message that should be truncated when shown as a reply preview in the response',
        isSelf: false,
      },
    });
    await prisma.message.create({
      data: {
        chatId: testChatId,
        senderName: 'Bob',
        text: 'Reply here',
        isSelf: false,
        replyToMessageId: parent.id,
      },
    });

    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    const body = response.json();
    const reply = body.messages.find((m: { text: string }) => m.text === 'Reply here');
    expect(reply.replyToMessage).toBeTruthy();
    expect(reply.replyToMessage.senderName).toBe('Alice');
    // Preview should be truncated to 100 chars + '...'
    expect(reply.replyToMessage.text.length).toBeLessThanOrEqual(103);
  });

  it('should reject invalid limit', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages?limit=0`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 404 for non-existent chat', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${fakeId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should deny access to chat from another organization', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${otherAuthToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should require authentication', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages`,
    });

    expect(response.statusCode).toBe(401);
  });
});

// ─── POST /chats/:chatId/messages ───

describe('POST /chats/:chatId/messages', () => {
  it('should create a message with text', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: 'Hello world!' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.text).toBe('Hello world!');
    expect(body.chatId).toBe(testChatId);
    expect(body.senderName).toBe(testUserName);
    expect(body.isSelf).toBe(true);
    expect(body.deliveryStatus).toBeTruthy();
  });

  it('should create a reply message', async () => {
    const parent = await prisma.message.create({
      data: { chatId: testChatId, senderName: 'Alice', text: 'Original', isSelf: false },
    });

    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: 'Replying to you', replyToMessageId: parent.id },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.replyToMessageId).toBe(parent.id);
    expect(body.replyToMessage).toBeTruthy();
    expect(body.replyToMessage.senderName).toBe('Alice');
  });

  it('should reject reply to message in different chat', async () => {
    const otherChatMsg = await prisma.message.create({
      data: { chatId: testChat2Id, senderName: 'Alice', text: 'In other chat', isSelf: false },
    });

    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: 'Cross-chat reply', replyToMessageId: otherChatMsg.id },
    });

    expect(response.statusCode).toBe(404);
    const body = response.json();
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('should reject text exceeding max length', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: 'x'.repeat(10001) },
    });

    expect(response.statusCode).toBe(422);
  });

  it('should increment chat messageCount', async () => {
    const before = await prisma.chat.findUnique({ where: { id: testChatId }, select: { messageCount: true } });

    await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: 'Counting message' },
    });

    const after = await prisma.chat.findUnique({ where: { id: testChatId }, select: { messageCount: true } });
    expect(after!.messageCount).toBe(before!.messageCount + 1);
  });

  it('should return 404 for non-existent chat', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${fakeId}/messages`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: 'Hello' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should deny sending to chat from another organization', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages`,
      headers: { authorization: `Bearer ${otherAuthToken}` },
      payload: { text: 'Unauthorized' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should require authentication', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages`,
      payload: { text: 'No auth' },
    });

    expect(response.statusCode).toBe(401);
  });
});

// ─── PATCH /messages/:id — Edit ───

describe('PATCH /messages/:id', () => {
  let ownMessageId: string;
  let otherPersonMessageId: string;

  beforeEach(async () => {
    // Create own message
    const own = await prisma.message.create({
      data: {
        chatId: testChatId,
        senderName: testUserName,
        senderExternalId: testUserId,
        text: 'My original text',
        isSelf: true,
      },
    });
    ownMessageId = own.id;

    // Create someone else's message
    const other = await prisma.message.create({
      data: {
        chatId: testChatId,
        senderName: 'Somebody',
        senderExternalId: 'external-999',
        text: 'Not my message',
        isSelf: false,
      },
    });
    otherPersonMessageId = other.id;
  });

  it('should edit own message text', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${ownMessageId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: 'Updated text' },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.text).toBe('Updated text');
    expect(body.editedAt).toBeTruthy();
  });

  it('should not allow editing someone else\'s message', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${otherPersonMessageId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: 'Hijacked' },
    });

    expect(response.statusCode).toBe(403);
    const body = response.json();
    expect(body.error.code).toBe('AUTH_INSUFFICIENT_PERMISSIONS');
  });

  it('should reject empty text', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${ownMessageId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: '' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('should return 404 for non-existent message', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${fakeId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { text: 'Updated' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should deny editing message from another organization', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${ownMessageId}`,
      headers: { authorization: `Bearer ${otherAuthToken}` },
      payload: { text: 'Cross-org edit' },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should require authentication', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${ownMessageId}`,
      payload: { text: 'No auth' },
    });

    expect(response.statusCode).toBe(401);
  });
});

// ─── DELETE /messages/:id ───

describe('DELETE /messages/:id', () => {
  let ownMessageId: string;
  let otherPersonMessageId: string;

  beforeEach(async () => {
    const own = await prisma.message.create({
      data: {
        chatId: testChatId,
        senderName: testUserName,
        senderExternalId: testUserId,
        text: 'Message to delete',
        isSelf: true,
      },
    });
    ownMessageId = own.id;

    const other = await prisma.message.create({
      data: {
        chatId: testChatId,
        senderName: 'Somebody',
        senderExternalId: 'external-999',
        text: 'Not mine',
        isSelf: false,
      },
    });
    otherPersonMessageId = other.id;
  });

  it('should delete own message', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/messages/${ownMessageId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.success).toBe(true);

    // Verify deleted
    const msg = await prisma.message.findUnique({ where: { id: ownMessageId } });
    expect(msg).toBeNull();
  });

  it('should not allow deleting someone else\'s message', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/messages/${otherPersonMessageId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should return 404 for non-existent message', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'DELETE',
      url: `/messages/${fakeId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should deny deleting message from another organization', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/messages/${ownMessageId}`,
      headers: { authorization: `Bearer ${otherAuthToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it('should require authentication', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/messages/${ownMessageId}`,
    });

    expect(response.statusCode).toBe(401);
  });
});

// ─── PATCH /messages/:id/pin ───

describe('PATCH /messages/:id/pin', () => {
  let messageId: string;

  beforeEach(async () => {
    const msg = await prisma.message.create({
      data: {
        chatId: testChatId,
        senderName: 'Alice',
        text: 'Pin me',
        isSelf: false,
      },
    });
    messageId = msg.id;
  });

  it('should pin a message', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${messageId}/pin`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { isPinned: true },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.isPinned).toBe(true);
  });

  it('should unpin a message', async () => {
    // Pin first
    await prisma.message.update({ where: { id: messageId }, data: { isPinned: true } });

    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${messageId}/pin`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { isPinned: false },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.isPinned).toBe(false);
  });

  it('should reject invalid payload (missing isPinned)', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${messageId}/pin`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {},
    });

    expect(response.statusCode).toBe(422);
  });

  it('should return 404 for non-existent message', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${fakeId}/pin`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { isPinned: true },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should deny pinning message from another organization', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/messages/${messageId}/pin`,
      headers: { authorization: `Bearer ${otherAuthToken}` },
      payload: { isPinned: true },
    });

    expect(response.statusCode).toBe(403);
  });
});

// ─── POST /messages/:id/forward ───

describe('POST /messages/:id/forward', () => {
  let sourceMessageId: string;

  beforeEach(async () => {
    const msg = await prisma.message.create({
      data: {
        chatId: testChatId,
        senderName: 'Alice',
        text: 'Forward me please',
        isSelf: false,
      },
    });
    sourceMessageId = msg.id;
  });

  it('should forward a message to another chat', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/messages/${sourceMessageId}/forward`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { targetChatId: testChat2Id },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.chatId).toBe(testChat2Id);
    expect(body.text).toContain('[Forwarded from');
    expect(body.text).toContain('Forward me please');
    expect(body.isSelf).toBe(true);
  });

  it('should increment target chat messageCount', async () => {
    const before = await prisma.chat.findUnique({ where: { id: testChat2Id }, select: { messageCount: true } });

    await server.inject({
      method: 'POST',
      url: `/messages/${sourceMessageId}/forward`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { targetChatId: testChat2Id },
    });

    const after = await prisma.chat.findUnique({ where: { id: testChat2Id }, select: { messageCount: true } });
    expect(after!.messageCount).toBe(before!.messageCount + 1);
  });

  it('should return 404 for non-existent source message', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'POST',
      url: `/messages/${fakeId}/forward`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { targetChatId: testChat2Id },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should return 404 for non-existent target chat', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'POST',
      url: `/messages/${sourceMessageId}/forward`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { targetChatId: fakeId },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should reject invalid payload', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/messages/${sourceMessageId}/forward`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {},
    });

    expect(response.statusCode).toBe(422);
  });

  it('should deny forwarding message from another organization', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/messages/${sourceMessageId}/forward`,
      headers: { authorization: `Bearer ${otherAuthToken}` },
      payload: { targetChatId: testChat2Id },
    });

    expect(response.statusCode).toBe(404); // source message not found for other org
  });
});

// ─── GET /chats/:chatId/messages/search ───

describe('GET /chats/:chatId/messages/search', () => {
  beforeEach(async () => {
    await prisma.message.createMany({
      data: [
        { chatId: testChatId, senderName: 'Alice', text: 'Hello world', isSelf: false },
        { chatId: testChatId, senderName: 'Bob', text: 'Goodbye world', isSelf: false },
        { chatId: testChatId, senderName: 'Alice', text: 'Something else entirely', isSelf: false },
      ],
    });
  });

  it('should search messages by text (case-insensitive)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages/search?q=world`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messages).toHaveLength(2);
    body.messages.forEach((m: { text: string }) => {
      expect(m.text.toLowerCase()).toContain('world');
    });
  });

  it('should respect limit parameter', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages/search?q=world&limit=1`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messages).toHaveLength(1);
  });

  it('should return empty for non-matching query', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages/search?q=nonexistentxyz`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messages).toHaveLength(0);
  });

  it('should reject missing query parameter', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages/search`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(422);
  });

  it('should return 404 for non-existent chat', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${fakeId}/messages/search?q=hello`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should deny search in chat from another organization', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages/search?q=hello`,
      headers: { authorization: `Bearer ${otherAuthToken}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

// ─── POST /chats/:chatId/messages/:messageId/reactions ───

describe('POST /chats/:chatId/messages/:messageId/reactions', () => {
  let messageId: string;

  beforeEach(async () => {
    const msg = await prisma.message.create({
      data: { chatId: testChatId, senderName: 'Alice', text: 'React to me', isSelf: false },
    });
    messageId = msg.id;
  });

  it('should add a reaction to a message', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages/${messageId}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { emoji: '👍' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.emoji).toBe('👍');
    expect(body.userId).toBe(testUserId);
    expect(body.messageId).toBe(messageId);
  });

  it('should upsert the same reaction (idempotent)', async () => {
    // Add same reaction twice
    await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages/${messageId}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { emoji: '❤️' },
    });

    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages/${messageId}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { emoji: '❤️' },
    });

    expect(response.statusCode).toBe(201);

    // Should still only be one reaction
    const reactions = await prisma.reaction.findMany({
      where: { messageId, userId: testUserId, emoji: '❤️' },
    });
    expect(reactions).toHaveLength(1);
  });

  it('should reject empty emoji', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages/${messageId}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { emoji: '' },
    });

    expect(response.statusCode).toBe(422);
  });

  it('should return 404 for message not in chat', async () => {
    // Message from chat 2
    const otherMsg = await prisma.message.create({
      data: { chatId: testChat2Id, senderName: 'Alice', text: 'Other', isSelf: false },
    });

    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages/${otherMsg.id}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { emoji: '👍' },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should deny reaction in chat from another organization', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages/${messageId}/reactions`,
      headers: { authorization: `Bearer ${otherAuthToken}` },
      payload: { emoji: '👍' },
    });

    expect(response.statusCode).toBe(403);
  });
});

// ─── GET /chats/:chatId/messages/:messageId/reactions ───

describe('GET /chats/:chatId/messages/:messageId/reactions', () => {
  let messageId: string;

  beforeEach(async () => {
    const msg = await prisma.message.create({
      data: { chatId: testChatId, senderName: 'Alice', text: 'Get reactions', isSelf: false },
    });
    messageId = msg.id;

    // Add reactions from test user
    await prisma.reaction.create({ data: { messageId, userId: testUserId, emoji: '👍' } });
    await prisma.reaction.create({ data: { messageId, userId: testUserId, emoji: '❤️' } });
    // Add reaction from other user (using a fake userId for simplicity)
    await prisma.reaction.create({ data: { messageId, userId: otherUserId, emoji: '👍' } });
  });

  it('should return grouped reactions with counts', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages/${messageId}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.reactions).toBeDefined();

    const thumbs = body.reactions.find((r: { emoji: string }) => r.emoji === '👍');
    expect(thumbs).toBeTruthy();
    expect(thumbs.count).toBe(2);
    expect(thumbs.userReacted).toBe(true);

    const heart = body.reactions.find((r: { emoji: string }) => r.emoji === '❤️');
    expect(heart).toBeTruthy();
    expect(heart.count).toBe(1);
    expect(heart.userReacted).toBe(true);
  });

  it('should show userReacted=false when user has not reacted', async () => {
    // Create a new message with only other user's reaction
    const msg2 = await prisma.message.create({
      data: { chatId: testChatId, senderName: 'Alice', text: 'Other reactions', isSelf: false },
    });
    await prisma.reaction.create({ data: { messageId: msg2.id, userId: otherUserId, emoji: '🔥' } });

    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages/${msg2.id}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const fire = body.reactions.find((r: { emoji: string }) => r.emoji === '🔥');
    expect(fire).toBeTruthy();
    expect(fire.count).toBe(1);
    expect(fire.userReacted).toBe(false);
  });

  it('should return 404 for message not in chat', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'GET',
      url: `/chats/${testChatId}/messages/${fakeId}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
  });
});

// ─── DELETE /chats/:chatId/messages/:messageId/reactions/:emoji ───

describe('DELETE /chats/:chatId/messages/:messageId/reactions/:emoji', () => {
  let messageId: string;

  beforeEach(async () => {
    const msg = await prisma.message.create({
      data: { chatId: testChatId, senderName: 'Alice', text: 'Remove reaction', isSelf: false },
    });
    messageId = msg.id;

    await prisma.reaction.create({ data: { messageId, userId: testUserId, emoji: '👍' } });
  });

  it('should remove own reaction', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/chats/${testChatId}/messages/${messageId}/reactions/👍`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(204);

    // Verify deleted
    const reaction = await prisma.reaction.findFirst({
      where: { messageId, userId: testUserId, emoji: '👍' },
    });
    expect(reaction).toBeNull();
  });

  it('should return 404 for non-existent reaction', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/chats/${testChatId}/messages/${messageId}/reactions/🔥`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should not delete another user\'s reaction', async () => {
    // Add reaction from other user
    await prisma.reaction.create({ data: { messageId, userId: otherUserId, emoji: '❤️' } });

    // Try to delete other user's reaction using our auth
    const response = await server.inject({
      method: 'DELETE',
      url: `/chats/${testChatId}/messages/${messageId}/reactions/❤️`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    // Should return 404 because we don't have that reaction
    expect(response.statusCode).toBe(404);

    // Other user's reaction should still exist
    const reaction = await prisma.reaction.findFirst({
      where: { messageId, userId: otherUserId, emoji: '❤️' },
    });
    expect(reaction).toBeTruthy();
  });

  it('should return 404 for message not in chat', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await server.inject({
      method: 'DELETE',
      url: `/chats/${testChatId}/messages/${fakeId}/reactions/👍`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it('should deny removing reaction in chat from another organization', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/chats/${testChatId}/messages/${messageId}/reactions/👍`,
      headers: { authorization: `Bearer ${otherAuthToken}` },
    });

    expect(response.statusCode).toBe(403);
  });
});
