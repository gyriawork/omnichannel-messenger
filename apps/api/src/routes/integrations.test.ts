import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestServer } from '../__test__/setup';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

describe('Integration Routes', () => {
  let server: FastifyInstance;
  let prisma: PrismaClient;
  let orgId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    server = await createTestServer();
    prisma = new PrismaClient();

    // Create test organization
    const org = await prisma.organization.create({
      data: {
        id: 'test-org-integrations-' + Date.now(),
        name: 'Integration Test Org',
        defaultLanguage: 'en',
        timezone: 'UTC',
        chatVisibilityAll: true,
        status: 'active',
      },
    });
    orgId = org.id;

    // Create test user
    const passwordHash = await bcrypt.hash('testpass123', 12);
    const user = await prisma.user.create({
      data: {
        email: `integ-test-${Date.now()}@test.local`,
        name: 'Integration Tester',
        passwordHash,
        role: 'admin',
        status: 'active',
        organizationId: orgId,
      },
    });
    userId = user.id;

    // Generate test token
    token = server.jwt.sign(
      { userId, email: user.email, organizationId: orgId },
      { expiresIn: '15m' }
    );
  });

  afterAll(async () => {
    // Cleanup integrations
    await prisma.integration.deleteMany({
      where: { organizationId: orgId },
    });

    // Cleanup user
    await prisma.user.deleteMany({
      where: { organizationId: orgId },
    });

    // Cleanup org
    await prisma.organization.delete({
      where: { id: orgId },
    });

    await prisma.$disconnect();
    await server.close();
  });

  describe('POST /integrations/:messenger/connect', () => {
    it('should initiate OAuth flow for Telegram', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/integrations/telegram/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          botToken: 'test-bot-token-123',
          botUsername: 'testbot',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('status', 'connected');
      expect(data).toHaveProperty('messenger', 'telegram');
      expect(data).toHaveProperty('connectedAt');

      // Verify stored in database
      const integration = await prisma.integration.findFirst({
        where: {
          messenger: 'telegram',
          organizationId: orgId,
        },
      });
      expect(integration).toBeDefined();
      expect(integration?.status).toBe('connected');
    });

    it('should initiate OAuth flow for Slack', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/integrations/slack/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          accessToken: 'xoxb-slack-token',
          teamId: 'T123456',
          teamName: 'Test Workspace',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('status', 'connected');
      expect(data).toHaveProperty('messenger', 'slack');
    });

    it('should reject invalid messenger type', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/integrations/invalid-messenger/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: { accessToken: 'test' },
      });

      expect(response.statusCode).toBe(422);
      const error = response.json();
      expect(error.error.code).toBe('VALIDATION_ERROR');
    });

    it('should reject missing credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/integrations/telegram/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(response.statusCode).toBe(422);
      const error = response.json();
      expect(error.error.code).toBe('VALIDATION_ERROR');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/integrations/telegram/connect',
        payload: { botToken: 'test' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject if already connected', async () => {
      // Create first integration
      await prisma.integration.create({
        data: {
          messenger: 'whatsapp',
          organizationId: orgId,
          status: 'connected',
          credentials: { phoneNumber: '+1234567890' },
          connectedAt: new Date(),
        },
      });

      // Try to connect again
      const response = await server.inject({
        method: 'POST',
        url: '/api/integrations/whatsapp/connect',
        headers: { authorization: `Bearer ${token}` },
        payload: { phoneNumber: '+0987654321' },
      });

      expect(response.statusCode).toBe(409);
      const error = response.json();
      expect(error.error.code).toBe('INTEGRATION_ALREADY_CONNECTED');
    });
  });

  describe('GET /integrations/:messenger/status', () => {
    it('should return connected integration status', async () => {
      // Create integration
      await prisma.integration.create({
        data: {
          messenger: 'gmail',
          organizationId: orgId,
          status: 'connected',
          credentials: { accessToken: 'encrypted-token' },
          connectedAt: new Date(),
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/integrations/gmail/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('status', 'connected');
      expect(data).toHaveProperty('messenger', 'gmail');
      expect(data).toHaveProperty('connectedAt');
    });

    it('should return disconnected status if no integration', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/integrations/telegram/status',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('status', 'disconnected');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/integrations/telegram/status',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('DELETE /integrations/:messenger', () => {
    it('should disconnect integration', async () => {
      // Create integration
      const integration = await prisma.integration.create({
        data: {
          messenger: 'slack',
          organizationId: orgId,
          status: 'connected',
          credentials: { accessToken: 'token' },
          connectedAt: new Date(),
        },
      });

      const response = await server.inject({
        method: 'DELETE',
        url: '/api/integrations/slack',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('status', 'disconnected');

      // Verify deleted from database
      const deleted = await prisma.integration.findUnique({
        where: { id: integration.id },
      });
      expect(deleted).toBeNull();
    });

    it('should return 404 if not connected', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/integrations/whatsapp',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/integrations/telegram',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should isolate by organization', async () => {
      // Create another org
      const org2 = await prisma.organization.create({
        data: {
          id: 'test-org-2-' + Date.now(),
          name: 'Org 2',
          defaultLanguage: 'en',
          timezone: 'UTC',
          chatVisibilityAll: true,
          status: 'active',
        },
      });

      // Create user in org2
      const passwordHash = await bcrypt.hash('pass123', 12);
      const user2 = await prisma.user.create({
        data: {
          email: `user2-${Date.now()}@test.local`,
          name: 'User 2',
          passwordHash,
          role: 'admin',
          status: 'active',
          organizationId: org2.id,
        },
      });

      const token2 = server.jwt.sign(
        { userId: user2.id, email: user2.email, organizationId: org2.id },
        { expiresIn: '15m' }
      );

      // Create integration in org1
      await prisma.integration.create({
        data: {
          messenger: 'telegram',
          organizationId: orgId,
          status: 'connected',
          credentials: { botToken: 'token' },
          connectedAt: new Date(),
        },
      });

      // Try to delete from org2 (should fail)
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/integrations/telegram',
        headers: { authorization: `Bearer ${token2}` },
      });

      expect(response.statusCode).toBe(404);

      // Cleanup org2
      await prisma.user.delete({ where: { id: user2.id } });
      await prisma.organization.delete({ where: { id: org2.id } });
    });
  });

  describe('GET /integrations', () => {
    it('should list all integrations for organization', async () => {
      // Create multiple integrations
      await prisma.integration.createMany({
        data: [
          {
            messenger: 'telegram',
            organizationId: orgId,
            status: 'connected',
            credentials: { botToken: 'tg-token' },
            connectedAt: new Date(),
          },
          {
            messenger: 'slack',
            organizationId: orgId,
            status: 'disconnected',
            credentials: null,
            connectedAt: null,
          },
        ],
        skipDuplicates: true,
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/integrations',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(2);

      const messengers = data.map((i: any) => i.messenger);
      expect(messengers).toContain('telegram');
      expect(messengers).toContain('slack');
    });

    it('should only return integrations for current organization', async () => {
      const org2 = await prisma.organization.create({
        data: {
          id: 'test-org-isolated-' + Date.now(),
          name: 'Isolated Org',
          defaultLanguage: 'en',
          timezone: 'UTC',
          chatVisibilityAll: true,
          status: 'active',
        },
      });

      const passwordHash = await bcrypt.hash('pass123', 12);
      const user2 = await prisma.user.create({
        data: {
          email: `isolated-${Date.now()}@test.local`,
          name: 'Isolated User',
          passwordHash,
          role: 'admin',
          status: 'active',
          organizationId: org2.id,
        },
      });

      const token2 = server.jwt.sign(
        { userId: user2.id, email: user2.email, organizationId: org2.id },
        { expiresIn: '15m' }
      );

      // Create integration in org1 (already exists from previous test)
      // Request from org2
      const response = await server.inject({
        method: 'GET',
        url: '/api/integrations',
        headers: { authorization: `Bearer ${token2}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      // org2 should not see org1's integrations
      const org1Integrations = data.filter((i: any) => i.organizationId === orgId);
      expect(org1Integrations).toHaveLength(0);

      // Cleanup
      await prisma.user.delete({ where: { id: user2.id } });
      await prisma.organization.delete({ where: { id: org2.id } });
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/integrations',
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
