import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcryptjs from 'bcryptjs';
import broadcastRoutes from './broadcasts';

const prisma = new PrismaClient();
let server: FastifyInstance;
let testOrgId: string;
let testUserId: string;
let testChatId: string;
let authToken: string;

beforeAll(async () => {
  server = Fastify();
  await server.register(broadcastRoutes);

  // Create test organization and user
  const org = await prisma.organization.create({
    data: { name: 'Test Org', defaultLanguage: 'en', timezone: 'UTC', status: 'active' },
  });
  testOrgId = org.id;

  const passwordHash = await bcryptjs.hash('testpass123', 12);
  const user = await prisma.user.create({
    data: {
      email: 'test@broadcast.com',
      name: 'Test User',
      passwordHash,
      role: 'admin',
      status: 'active',
      organizationId: testOrgId,
    },
  });
  testUserId = user.id;
  authToken = 'test-jwt-token'; // In real tests, generate actual JWT

  // Create test chat
  const chat = await prisma.chat.create({
    data: {
      name: 'Test Chat',
      messenger: 'telegram',
      externalChatId: 'tg-123',
      chatType: 'direct',
      status: 'active',
      organizationId: testOrgId,
      importedById: testUserId,
    },
  });
  testChatId = chat.id;
});

afterAll(async () => {
  await prisma.broadcast.deleteMany({ where: { organizationId: testOrgId } });
  await prisma.chat.deleteMany({ where: { organizationId: testOrgId } });
  await prisma.user.deleteMany({ where: { organizationId: testOrgId } });
  await prisma.organization.delete({ where: { id: testOrgId } });
  await prisma.$disconnect();
  await server.close();
});

describe('POST /broadcasts', () => {
  it('should create broadcast with valid payload', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/broadcasts',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Test Broadcast',
        messageText: 'Hello everyone!',
        chatIds: [testChatId],
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe('Test Broadcast');
    expect(body.status).toBe('draft');
    expect(body.createdById).toBe(testUserId);
  });

  it('should reject missing required fields', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/broadcasts',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Test Broadcast',
        // missing messageText and chatIds
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should reject empty chatIds', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/broadcasts',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Test Broadcast',
        messageText: 'Hello!',
        chatIds: [],
      },
    });

    expect(response.statusCode).toBe(422);
    const body = response.json();
    expect(body.error.message).toContain('at least one chat');
  });

  it('should require authentication', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/broadcasts',
      payload: {
        name: 'Test Broadcast',
        messageText: 'Hello!',
        chatIds: [testChatId],
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /broadcasts', () => {
  let broadcastId: string;

  beforeEach(async () => {
    const broadcast = await prisma.broadcast.create({
      data: {
        name: 'Test Broadcast',
        messageText: 'Test message',
        status: 'draft',
        organizationId: testOrgId,
        createdById: testUserId,
      },
    });
    broadcastId = broadcast.id;
  });

  it('should list broadcasts for organization', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/broadcasts',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.broadcasts)).toBe(true);
    expect(body.broadcasts.length).toBeGreaterThan(0);
  });

  it('should support pagination', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/broadcasts?limit=10&offset=0',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('broadcasts');
    expect(body).toHaveProperty('total');
  });
});

describe('GET /broadcasts/:id', () => {
  let broadcastId: string;

  beforeEach(async () => {
    const broadcast = await prisma.broadcast.create({
      data: {
        name: 'Test Broadcast',
        messageText: 'Test message',
        status: 'draft',
        organizationId: testOrgId,
        createdById: testUserId,
      },
    });
    broadcastId = broadcast.id;
  });

  it('should get broadcast by id', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/broadcasts/${broadcastId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(broadcastId);
    expect(body.name).toBe('Test Broadcast');
  });

  it('should return 404 for non-existent broadcast', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/broadcasts/non-existent-id',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('PATCH /broadcasts/:id', () => {
  let broadcastId: string;

  beforeEach(async () => {
    const broadcast = await prisma.broadcast.create({
      data: {
        name: 'Test Broadcast',
        messageText: 'Test message',
        status: 'draft',
        organizationId: testOrgId,
        createdById: testUserId,
      },
    });
    broadcastId = broadcast.id;
  });

  it('should update broadcast', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/broadcasts/${broadcastId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Updated Broadcast',
        messageText: 'Updated message',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.name).toBe('Updated Broadcast');
    expect(body.messageText).toBe('Updated message');
  });

  it('should not allow updating sent broadcast', async () => {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'sent' },
    });

    const response = await server.inject({
      method: 'PATCH',
      url: `/api/broadcasts/${broadcastId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { name: 'Updated' },
    });

    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error.code).toBe('CONFLICT');
  });

  it('should reject invalid update payload', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/broadcasts/${broadcastId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: '', // Empty name not allowed
      },
    });

    expect(response.statusCode).toBe(422);
  });
});

describe('DELETE /broadcasts/:id', () => {
  let broadcastId: string;

  beforeEach(async () => {
    const broadcast = await prisma.broadcast.create({
      data: {
        name: 'Test Broadcast',
        messageText: 'Test message',
        status: 'draft',
        organizationId: testOrgId,
        createdById: testUserId,
      },
    });
    broadcastId = broadcast.id;
  });

  it('should delete draft broadcast', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/broadcasts/${broadcastId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);

    // Verify deletion
    const broadcast = await prisma.broadcast.findUnique({
      where: { id: broadcastId },
    });
    expect(broadcast).toBeNull();
  });

  it('should not allow deleting sent broadcast', async () => {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'sent' },
    });

    const response = await server.inject({
      method: 'DELETE',
      url: `/api/broadcasts/${broadcastId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(409);
  });

  it('should return 404 for non-existent broadcast', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: '/api/broadcasts/non-existent-id',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
  });
});
