import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcryptjs from 'bcryptjs';
import templateRoutes from './templates';

const prisma = new PrismaClient();
let server: FastifyInstance;
let testOrgId: string;
let testUserId: string;
let authToken: string;

beforeAll(async () => {
  server = Fastify();
  await server.register(templateRoutes);

  const org = await prisma.organization.create({
    data: { name: 'Test Org', defaultLanguage: 'en', timezone: 'UTC', status: 'active' },
  });
  testOrgId = org.id;

  const passwordHash = await bcryptjs.hash('testpass123', 12);
  const user = await prisma.user.create({
    data: {
      email: 'test@template.com',
      name: 'Test User',
      passwordHash,
      role: 'user',
      status: 'active',
      organizationId: testOrgId,
    },
  });
  testUserId = user.id;
  authToken = 'test-jwt-token';
});

afterAll(async () => {
  await prisma.template.deleteMany({ where: { organizationId: testOrgId } });
  await prisma.user.deleteMany({ where: { organizationId: testOrgId } });
  await prisma.organization.delete({ where: { id: testOrgId } });
  await prisma.$disconnect();
  await server.close();
});

describe('POST /templates', () => {
  it('should create template with valid payload', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Welcome Template',
        messageText: 'Welcome to our service!',
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.name).toBe('Welcome Template');
    expect(body.messageText).toBe('Welcome to our service!');
    expect(body.createdById).toBe(testUserId);
  });

  it('should reject missing required fields', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Welcome Template',
        // missing messageText
      },
    });

    expect(response.statusCode).toBe(422);
  });

  it('should reject duplicate template names within organization', async () => {
    // Create first template
    await server.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Duplicate',
        messageText: 'Message 1',
      },
    });

    // Try to create duplicate
    const response = await server.inject({
      method: 'POST',
      url: '/api/templates',
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        name: 'Duplicate',
        messageText: 'Message 2',
      },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe('GET /templates', () => {
  beforeEach(async () => {
    await prisma.template.create({
      data: {
        name: 'Template 1',
        messageText: 'Message 1',
        organizationId: testOrgId,
        createdById: testUserId,
      },
    });
  });

  it('should list templates for organization', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/templates',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.templates)).toBe(true);
    expect(body.templates.length).toBeGreaterThan(0);
  });
});

describe('GET /templates/:id', () => {
  let templateId: string;

  beforeEach(async () => {
    const template = await prisma.template.create({
      data: {
        name: 'Get Test',
        messageText: 'Message',
        organizationId: testOrgId,
        createdById: testUserId,
      },
    });
    templateId = template.id;
  });

  it('should get template by id', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/api/templates/${templateId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(templateId);
  });

  it('should return 404 for non-existent template', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/api/templates/non-existent',
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe('PATCH /templates/:id', () => {
  let templateId: string;

  beforeEach(async () => {
    const template = await prisma.template.create({
      data: {
        name: 'Update Test',
        messageText: 'Original message',
        organizationId: testOrgId,
        createdById: testUserId,
      },
    });
    templateId = template.id;
  });

  it('should update template', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: `/api/templates/${templateId}`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: {
        messageText: 'Updated message',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.messageText).toBe('Updated message');
  });
});

describe('DELETE /templates/:id', () => {
  let templateId: string;

  beforeEach(async () => {
    const template = await prisma.template.create({
      data: {
        name: 'Delete Test',
        messageText: 'Message',
        organizationId: testOrgId,
        createdById: testUserId,
      },
    });
    templateId = template.id;
  });

  it('should delete template', async () => {
    const response = await server.inject({
      method: 'DELETE',
      url: `/api/templates/${templateId}`,
      headers: { authorization: `Bearer ${authToken}` },
    });

    expect(response.statusCode).toBe(200);

    const template = await prisma.template.findUnique({
      where: { id: templateId },
    });
    expect(template).toBeNull();
  });
});
