import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestServer } from '../__test__/setup';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

describe('Settings Routes', () => {
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
        id: 'test-org-settings-' + Date.now(),
        name: 'Settings Test Org',
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
        email: `settings-test-${Date.now()}@test.local`,
        name: 'Settings Tester',
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

    // Create default antiban settings
    await prisma.antibanSettings.createMany({
      data: [
        {
          messenger: 'telegram',
          organizationId: orgId,
          messagesPerBatch: 10,
          delayBetweenMessages: 5,
          delayBetweenBatches: 180,
          maxMessagesPerHour: 50,
          maxMessagesPerDay: 300,
          autoRetryEnabled: true,
          maxRetryAttempts: 3,
          retryWindowHours: 6,
        },
        {
          messenger: 'slack',
          organizationId: orgId,
          messagesPerBatch: 30,
          delayBetweenMessages: 1,
          delayBetweenBatches: 30,
          maxMessagesPerHour: 200,
          maxMessagesPerDay: 2000,
          autoRetryEnabled: true,
          maxRetryAttempts: 3,
          retryWindowHours: 6,
        },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    // Cleanup antiban settings
    await prisma.antibanSettings.deleteMany({
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

  describe('GET /api/settings/antiban/:messenger', () => {
    it('should return antiban settings for Telegram', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/settings/antiban/telegram',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('messenger', 'telegram');
      expect(data).toHaveProperty('messagesPerBatch', 10);
      expect(data).toHaveProperty('delayBetweenMessages', 5);
      expect(data).toHaveProperty('delayBetweenBatches', 180);
      expect(data).toHaveProperty('maxMessagesPerHour', 50);
      expect(data).toHaveProperty('maxMessagesPerDay', 300);
      expect(data).toHaveProperty('autoRetryEnabled', true);
    });

    it('should return settings for Slack', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/settings/antiban/slack',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.messenger).toBe('slack');
      expect(data.messagesPerBatch).toBe(30);
      expect(data.delayBetweenMessages).toBe(1);
    });

    it('should reject invalid messenger type', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/settings/antiban/invalid-messenger',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/settings/antiban/telegram',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should isolate by organization', async () => {
      const org2 = await prisma.organization.create({
        data: {
          id: 'test-org-settings-2-' + Date.now(),
          name: 'Settings Org 2',
          defaultLanguage: 'en',
          timezone: 'UTC',
          chatVisibilityAll: true,
          status: 'active',
        },
      });

      const passwordHash = await bcrypt.hash('pass123', 12);
      const user2 = await prisma.user.create({
        data: {
          email: `settings-user2-${Date.now()}@test.local`,
          name: 'Settings User 2',
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

      // Org2 has different settings
      await prisma.antibanSettings.create({
        data: {
          messenger: 'telegram',
          organizationId: org2.id,
          messagesPerBatch: 50,
          delayBetweenMessages: 1,
          delayBetweenBatches: 60,
          maxMessagesPerHour: 500,
          maxMessagesPerDay: 3000,
          autoRetryEnabled: false,
          maxRetryAttempts: 1,
          retryWindowHours: 2,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/settings/antiban/telegram',
        headers: { authorization: `Bearer ${token2}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.messagesPerBatch).toBe(50); // org2's value, not org1's
      expect(data.delayBetweenMessages).toBe(1);

      // Cleanup
      await prisma.antibanSettings.deleteMany({
        where: { organizationId: org2.id },
      });
      await prisma.user.delete({ where: { id: user2.id } });
      await prisma.organization.delete({ where: { id: org2.id } });
    });
  });

  describe('PATCH /api/settings/antiban/:messenger', () => {
    it('should update antiban settings for Telegram', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/settings/antiban/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          messagesPerBatch: 20,
          delayBetweenMessages: 10,
          maxMessagesPerHour: 100,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('messagesPerBatch', 20);
      expect(data).toHaveProperty('delayBetweenMessages', 10);
      expect(data).toHaveProperty('maxMessagesPerHour', 100);

      // Verify persisted
      const verified = await prisma.antibanSettings.findUnique({
        where: {
          messenger_organizationId: {
            messenger: 'telegram',
            organizationId: orgId,
          },
        },
      });
      expect(verified?.messagesPerBatch).toBe(20);
    });

    it('should update only provided fields', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/settings/antiban/slack',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          maxMessagesPerDay: 5000,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.maxMessagesPerDay).toBe(5000);
      expect(data.messagesPerBatch).toBe(30); // unchanged
    });

    it('should validate messagesPerBatch range', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/settings/antiban/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          messagesPerBatch: 0, // invalid: must be >= 1
        },
      });

      expect(response.statusCode).toBe(422);
      const error = response.json();
      expect(error.error.code).toBe('VALIDATION_ERROR');
    });

    it('should validate delay ranges', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/settings/antiban/slack',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          delayBetweenBatches: -10, // invalid: must be >= 0
        },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should validate maxMessagesPerHour > 0', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/settings/antiban/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          maxMessagesPerHour: 0,
        },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should allow updating retry settings', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/settings/antiban/slack',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          autoRetryEnabled: false,
          maxRetryAttempts: 5,
          retryWindowHours: 12,
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.autoRetryEnabled).toBe(false);
      expect(data.maxRetryAttempts).toBe(5);
      expect(data.retryWindowHours).toBe(12);
    });

    it('should reject invalid messenger type', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/settings/antiban/invalid',
        headers: { authorization: `Bearer ${token}` },
        payload: { messagesPerBatch: 15 },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'PATCH',
        url: '/api/settings/antiban/telegram',
        payload: { messagesPerBatch: 15 },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should enforce admin or above role', async () => {
      // Create regular user
      const passwordHash = await bcrypt.hash('userpass', 12);
      const regularUser = await prisma.user.create({
        data: {
          email: `regular-${Date.now()}@test.local`,
          name: 'Regular User',
          passwordHash,
          role: 'user',
          status: 'active',
          organizationId: orgId,
        },
      });

      const userToken = server.jwt.sign(
        { userId: regularUser.id, email: regularUser.email, organizationId: orgId },
        { expiresIn: '15m' }
      );

      const response = await server.inject({
        method: 'PATCH',
        url: '/api/settings/antiban/telegram',
        headers: { authorization: `Bearer ${userToken}` },
        payload: { messagesPerBatch: 15 },
      });

      expect(response.statusCode).toBe(403); // Forbidden
      const error = response.json();
      expect(error.error.code).toBe('INSUFFICIENT_PERMISSIONS');

      await prisma.user.delete({ where: { id: regularUser.id } });
    });
  });

  describe('GET /api/settings/antiban', () => {
    it('should list all antiban settings for organization', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/settings/antiban',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(2); // telegram + slack at minimum

      const messengers = data.map((s: any) => s.messenger);
      expect(messengers).toContain('telegram');
      expect(messengers).toContain('slack');
    });

    it('should include all required fields', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/settings/antiban',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      const telegram = data.find((s: any) => s.messenger === 'telegram');

      expect(telegram).toHaveProperty('messagesPerBatch');
      expect(telegram).toHaveProperty('delayBetweenMessages');
      expect(telegram).toHaveProperty('delayBetweenBatches');
      expect(telegram).toHaveProperty('maxMessagesPerHour');
      expect(telegram).toHaveProperty('maxMessagesPerDay');
      expect(telegram).toHaveProperty('autoRetryEnabled');
      expect(telegram).toHaveProperty('maxRetryAttempts');
      expect(telegram).toHaveProperty('retryWindowHours');
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/settings/antiban',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should only return settings for current organization', async () => {
      const org2 = await prisma.organization.create({
        data: {
          id: 'test-org-settings-list-' + Date.now(),
          name: 'Settings Org List',
          defaultLanguage: 'en',
          timezone: 'UTC',
          chatVisibilityAll: true,
          status: 'active',
        },
      });

      const passwordHash = await bcrypt.hash('pass123', 12);
      const user2 = await prisma.user.create({
        data: {
          email: `settings-list-${Date.now()}@test.local`,
          name: 'Settings List User',
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

      // Create settings for org2
      await prisma.antibanSettings.create({
        data: {
          messenger: 'whatsapp',
          organizationId: org2.id,
          messagesPerBatch: 5,
          delayBetweenMessages: 15,
          delayBetweenBatches: 600,
          maxMessagesPerHour: 20,
          maxMessagesPerDay: 80,
          autoRetryEnabled: true,
          maxRetryAttempts: 3,
          retryWindowHours: 6,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: '/api/settings/antiban',
        headers: { authorization: `Bearer ${token2}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      
      // org2 should only see whatsapp
      expect(data.length).toBe(1);
      expect(data[0].messenger).toBe('whatsapp');
      
      // Should not see org1's settings
      const hasOrgOneSettings = data.some(
        (s: any) => s.messenger === 'telegram' || s.messenger === 'slack'
      );
      expect(hasOrgOneSettings).toBe(false);

      // Cleanup
      await prisma.antibanSettings.deleteMany({
        where: { organizationId: org2.id },
      });
      await prisma.user.delete({ where: { id: user2.id } });
      await prisma.organization.delete({ where: { id: org2.id } });
    });
  });
});
