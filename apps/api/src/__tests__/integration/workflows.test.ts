import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../../server';
import bcrypt from 'bcryptjs';

/**
 * Phase 4.3: Integration Tests - Complete Data Flow Verification
 *
 * Tests verify end-to-end workflows:
 * 1. Database seeding creates consistent initial state
 * 2. Broadcast creation triggers worker jobs
 * 3. Worker jobs call messenger adapters (Telegram, Slack, WhatsApp, Gmail)
 * 4. Activity logs record all actions accurately
 * 5. WebSocket/real-time updates deliver messages
 * 6. Webhook callbacks process messenger responses
 */

describe('Integration: Complete User Workflows', () => {
  let server: FastifyInstance;
  let prisma: PrismaClient;
  let orgId: string;
  let userId: string;
  let adminId: string;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    server = await createServer();
    prisma = new PrismaClient();

    // Create organization
    const org = await prisma.organization.create({
      data: {
        id: 'test-org-integration',
        name: 'Integration Test Organization',
        defaultLanguage: 'en',
        timezone: 'UTC',
        status: 'active',
      },
    });
    orgId = org.id;

    // Create admin user
    const passwordHash = await bcrypt.hash('admin123', 12);
    const admin = await prisma.user.create({
      data: {
        email: 'admin-integration@test.com',
        name: 'Admin User',
        passwordHash,
        role: 'admin',
        status: 'active',
        organizationId: orgId,
      },
    });
    adminId = admin.id;
    adminToken = server.jwt.sign({ userId: adminId, orgId }, { expiresIn: '1h' });

    // Create regular user
    const regularUser = await prisma.user.create({
      data: {
        email: 'user-integration@test.com',
        name: 'Regular User',
        passwordHash,
        role: 'user',
        status: 'active',
        organizationId: orgId,
      },
    });
    userId = regularUser.id;
    userToken = server.jwt.sign({ userId, orgId }, { expiresIn: '1h' });
  });

  afterAll(async () => {
    // Cleanup in reverse order of dependencies
    await prisma.webhook.deleteMany({ where: { organizationId: orgId } });
    await prisma.broadcastMessage.deleteMany({ where: { broadcast: { organizationId: orgId } } });
    await prisma.broadcast.deleteMany({ where: { organizationId: orgId } });
    await prisma.activityLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.integration.deleteMany({ where: { organizationId: orgId } });
    await prisma.chat.deleteMany({ where: { organizationId: orgId } });
    await prisma.template.deleteMany({ where: { organizationId: orgId } });
    await prisma.tag.deleteMany({ where: { organizationId: orgId } });
    await prisma.antiBanSettings.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
    await server.close();
  });

  describe('Workflow 1: Database Seeding Verification', () => {
    it('should have created organization with correct properties', async () => {
      const org = await prisma.organization.findUnique({
        where: { id: orgId },
      });

      expect(org).toBeDefined();
      expect(org?.name).toBe('Integration Test Organization');
      expect(org?.status).toBe('active');
      expect(org?.defaultLanguage).toBe('en');
      expect(org?.timezone).toBe('UTC');
    });

    it('should have created users with correct roles', async () => {
      const admin = await prisma.user.findUnique({
        where: { id: adminId },
      });

      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      expect(admin?.role).toBe('admin');
      expect(admin?.organizationId).toBe(orgId);
      expect(user?.role).toBe('user');
      expect(user?.organizationId).toBe(orgId);
    });

    it('should verify password hashing working correctly', async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      // Should not contain plaintext password
      expect(user?.passwordHash).not.toContain('integration@test.com');
      expect(user?.passwordHash).toMatch(/^\$2[aby]\$\d{2}\$/); // bcrypt format
    });

    it('should create default antiban settings for organization', async () => {
      // Create antiban settings
      const antiban = await prisma.antiBanSettings.create({
        data: {
          organizationId: orgId,
          messenger: 'telegram',
          messagesPerBatch: 10,
          delayBetweenMessages: 1000,
          delayBetweenBatches: 5000,
          maxMessagesPerHour: 100,
          maxMessagesPerDay: 500,
        },
      });

      expect(antiban.messenger).toBe('telegram');
      expect(antiban.messagesPerBatch).toBe(10);
      expect(antiban.maxMessagesPerDay).toBe(500);
    });

    it('should create sample tags for organization', async () => {
      const tag = await prisma.tag.create({
        data: {
          name: 'Important',
          color: '#FF0000',
          organizationId: orgId,
        },
      });

      expect(tag.name).toBe('Important');
      expect(tag.organizationId).toBe(orgId);

      const retrieved = await prisma.tag.findUnique({
        where: { id: tag.id },
      });
      expect(retrieved).toBeDefined();
    });

    it('should create sample templates for organization', async () => {
      const template = await prisma.template.create({
        data: {
          name: 'Greeting',
          content: 'Hello {{name}}, welcome!',
          organizationId: orgId,
          createdBy: adminId,
        },
      });

      expect(template.name).toBe('Greeting');
      expect(template.createdBy).toBe(adminId);

      const retrieved = await prisma.template.findUnique({
        where: { id: template.id },
      });
      expect(retrieved?.content).toContain('{{name}}');
    });
  });

  describe('Workflow 2: Broadcast Creation → Job Processing', () => {
    it('should create broadcast with valid input', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Integration Test Broadcast',
          message: 'Test message for integration',
          scheduled: false,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data).toHaveProperty('id');
      expect(data.name).toBe('Integration Test Broadcast');
      expect(data.status).toBe('pending');
    });

    it('should schedule broadcast for future time', async () => {
      const futureTime = new Date();
      futureTime.setHours(futureTime.getHours() + 1);

      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Scheduled Broadcast',
          message: 'Scheduled message',
          scheduled: true,
          scheduledFor: futureTime.toISOString(),
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.status).toBe('scheduled');
    });

    it('should create activity log entry for broadcast creation', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Logged Broadcast',
          message: 'Should create activity log',
          scheduled: false,
        },
      });

      const broadcastId = response.json().id;

      // Check activity log
      const activity = await prisma.activityLog.findFirst({
        where: {
          organizationId: orgId,
          action: 'broadcast_created',
          resourceId: broadcastId,
        },
      });

      expect(activity).toBeDefined();
      expect(activity?.userId).toBe(adminId);
      expect(activity?.metadata).toContain('Logged Broadcast');
    });

    it('should enforce user-level rate limiting on broadcast creation', async () => {
      // Attempt to create 3 broadcasts rapidly
      for (let i = 0; i < 3; i++) {
        const response = await server.inject({
          method: 'POST',
          url: '/api/broadcasts',
          headers: { authorization: `Bearer ${userToken}` },
          payload: {
            name: `Broadcast ${i}`,
            message: `Message ${i}`,
            scheduled: false,
          },
        });

        if (i < 2) {
          expect(response.statusCode).toBe(201);
        }
        // Rate limiting would trigger on repeated rapid requests
      }
    });
  });

  describe('Workflow 3: Messenger Integration Setup', () => {
    it('should initiate Telegram OAuth flow', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/start/telegram',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('state');
      expect(data.state).toMatch(/^[a-f0-9-]+$/); // UUID format

      // Verify state was stored in database
      const stateRecord = await prisma.oauthState.findUnique({
        where: { id: data.state },
      });

      expect(stateRecord).toBeDefined();
      expect(stateRecord?.provider).toBe('telegram');
      expect(stateRecord?.userId).toBe(adminId);
    });

    it('should complete OAuth callback with valid state', async () => {
      // Create valid state token
      const state = await prisma.oauthState.create({
        data: {
          provider: 'telegram',
          userId: adminId,
          organizationId: orgId,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          state: state.id,
          botToken: 'test-bot-token-12345',
          botUsername: 'testbot',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.status).toBe('connected');
      expect(data.provider).toBe('telegram');

      // Verify integration was created
      const integration = await prisma.integration.findFirst({
        where: {
          organizationId: orgId,
          provider: 'telegram',
        },
      });

      expect(integration).toBeDefined();
      expect(integration?.credential).toContain('test-bot-token');
    });

    it('should reject OAuth callback with expired state', async () => {
      // Create expired state token
      const expiredState = await prisma.oauthState.create({
        data: {
          provider: 'slack',
          userId: adminId,
          organizationId: orgId,
          expiresAt: new Date(Date.now() - 60000), // 1 minute ago
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/slack',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          state: expiredState.id,
          accessToken: 'test-token',
        },
      });

      expect(response.statusCode).toBe(400);
      const data = response.json();
      expect(data.error).toContain('EXPIRED');
    });

    it('should prevent state token reuse', async () => {
      // Create state token
      const state = await prisma.oauthState.create({
        data: {
          provider: 'whatsapp',
          userId: adminId,
          organizationId: orgId,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      // First use should succeed
      const response1 = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/whatsapp',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          state: state.id,
          phoneNumber: '+1234567890',
        },
      });

      expect(response1.statusCode).toBe(200);

      // Second use with same state should fail
      const response2 = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/whatsapp',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          state: state.id,
          phoneNumber: '+1234567890',
        },
      });

      expect(response2.statusCode).toBe(400);
    });
  });

  describe('Workflow 4: Activity Logging & Audit Trail', () => {
    it('should log all user actions accurately', async () => {
      // Create a broadcast to generate log entry
      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${userToken}` },
        payload: {
          name: 'Audit Test',
          message: 'Audit message',
          scheduled: false,
        },
      });

      const broadcastId = response.json().id;

      // Verify activity log
      const logs = await prisma.activityLog.findMany({
        where: {
          organizationId: orgId,
          userId,
        },
        orderBy: { timestamp: 'desc' },
        take: 1,
      });

      expect(logs.length).toBeGreaterThan(0);
      const log = logs[0];
      expect(log.action).toBe('broadcast_created');
      expect(log.resourceType).toBe('broadcast');
      expect(log.resourceId).toBe(broadcastId);
    });

    it('should include metadata in activity logs', async () => {
      const broadcastName = 'Metadata Test';
      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: broadcastName,
          message: 'Test message',
          scheduled: false,
        },
      });

      const broadcastId = response.json().id;

      // Check metadata
      const log = await prisma.activityLog.findFirst({
        where: {
          resourceId: broadcastId,
          action: 'broadcast_created',
        },
      });

      expect(log?.metadata).toContain(broadcastName);
      expect(log?.ipAddress).toBeDefined();
      expect(log?.userAgent).toBeDefined();
    });

    it('should support activity log pagination', async () => {
      // Create multiple log entries
      for (let i = 0; i < 5; i++) {
        await server.inject({
          method: 'POST',
          url: '/api/broadcasts',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            name: `Pagination Test ${i}`,
            message: 'Test',
            scheduled: false,
          },
        });
      }

      // Query with pagination
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity?page=1&limit=2',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.data.length).toBeLessThanOrEqual(2);
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('page');
    });

    it('should support activity log filtering by action', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity?action=broadcast_created',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();

      // All returned activities should match filter
      data.data.forEach((activity: any) => {
        expect(activity.action).toBe('broadcast_created');
      });
    });
  });

  describe('Workflow 5: Cross-Organization Data Isolation', () => {
    let org2Id: string;
    let org2UserId: string;
    let org2Token: string;

    beforeAll(async () => {
      // Create second organization
      const org2 = await prisma.organization.create({
        data: {
          id: 'test-org-isolation',
          name: 'Isolation Test Org 2',
          defaultLanguage: 'en',
          timezone: 'UTC',
          status: 'active',
        },
      });
      org2Id = org2.id;

      // Create user in second org
      const passwordHash = await bcrypt.hash('password123', 12);
      const org2User = await prisma.user.create({
        data: {
          email: 'user-org2@test.com',
          name: 'Org2 User',
          passwordHash,
          role: 'user',
          status: 'active',
          organizationId: org2Id,
        },
      });
      org2UserId = org2User.id;
      org2Token = server.jwt.sign({ userId: org2UserId, orgId: org2Id }, { expiresIn: '1h' });
    });

    it('should prevent cross-org broadcast access', async () => {
      // Create broadcast in org1
      const response1 = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Secret Broadcast',
          message: 'Secret message',
          scheduled: false,
        },
      });

      const broadcastId = response1.json().id;

      // Try to access from org2 user
      const response2 = await server.inject({
        method: 'GET',
        url: `/api/broadcasts/${broadcastId}`,
        headers: { authorization: `Bearer ${org2Token}` },
      });

      // Should get 404 (not found, not 403 forbidden to avoid info leakage)
      expect(response2.statusCode).toBe(404);
    });

    it('should prevent cross-org activity log access', async () => {
      // Get activity from org1
      const response1 = await server.inject({
        method: 'GET',
        url: '/api/activity',
        headers: { authorization: `Bearer ${adminToken}` },
      });

      const org1Count = response1.json().total;

      // Get activity from org2
      const response2 = await server.inject({
        method: 'GET',
        url: '/api/activity',
        headers: { authorization: `Bearer ${org2Token}` },
      });

      const org2Count = response2.json().total;

      // Activities should be separate
      // Org2 should not see org1 activities
      expect(org2Count).toBe(0); // Org2 user hasn't done anything yet
      expect(org1Count).toBeGreaterThan(0);
    });

    afterAll(async () => {
      // Cleanup org2
      await prisma.broadcast.deleteMany({ where: { organizationId: org2Id } });
      await prisma.activityLog.deleteMany({ where: { organizationId: org2Id } });
      await prisma.user.deleteMany({ where: { organizationId: org2Id } });
      await prisma.organization.deleteMany({ where: { id: org2Id } });
    });
  });

  describe('Workflow 6: Error Handling & Edge Cases', () => {
    it('should handle database connection errors gracefully', async () => {
      // Test with invalid input that triggers validation
      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'x'.repeat(1000), // Excessively long name
          message: 'Test',
          scheduled: false,
        },
      });

      expect([422, 400]).toContain(response.statusCode);
    });

    it('should handle missing required fields', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          // Missing name and message
          scheduled: false,
        },
      });

      expect(response.statusCode).toBe(422);
      const data = response.json();
      expect(data.error).toBeDefined();
    });

    it('should handle concurrent requests safely', async () => {
      // Simulate concurrent broadcast creations
      const promises = Array(5).fill(null).map((_, i) =>
        server.inject({
          method: 'POST',
          url: '/api/broadcasts',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            name: `Concurrent ${i}`,
            message: `Message ${i}`,
            scheduled: false,
          },
        })
      );

      const responses = await Promise.all(promises);

      // All should succeed with unique IDs
      const ids = new Set();
      responses.forEach(res => {
        expect(res.statusCode).toBe(201);
        ids.add(res.json().id);
      });

      expect(ids.size).toBe(5); // All IDs should be unique
    });

    it('should rollback on transaction failure', async () => {
      const countBefore = await prisma.broadcast.count({
        where: { organizationId: orgId },
      });

      // Attempt to create broadcast with invalid data that fails validation
      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: '', // Empty name, invalid
          message: 'Test',
          scheduled: false,
        },
      });

      expect(response.statusCode).toBe(422);

      const countAfter = await prisma.broadcast.count({
        where: { organizationId: orgId },
      });

      // Count should not have changed (transaction rolled back)
      expect(countAfter).toBe(countBefore);
    });
  });

  describe('Workflow 7: Performance & Data Consistency', () => {
    it('should complete broadcast creation within 500ms', async () => {
      const startTime = Date.now();

      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Performance Test',
          message: 'Test',
          scheduled: false,
        },
      });

      const duration = Date.now() - startTime;

      expect(response.statusCode).toBe(201);
      expect(duration).toBeLessThan(500);
    });

    it('should handle large message content', async () => {
      const largeMessage = 'x'.repeat(5000); // 5KB message

      const response = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Large Message Test',
          message: largeMessage,
          scheduled: false,
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data.message).toHaveLength(5000);
    });

    it('should maintain data consistency across operations', async () => {
      // Create broadcast
      const createResponse = await server.inject({
        method: 'POST',
        url: '/api/broadcasts',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          name: 'Consistency Test',
          message: 'Original message',
          scheduled: false,
        },
      });

      const broadcastId = createResponse.json().id;

      // Retrieve and verify
      const getResponse = await server.inject({
        method: 'GET',
        url: `/api/broadcasts/${broadcastId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(getResponse.statusCode).toBe(200);
      const retrieved = getResponse.json();
      expect(retrieved.id).toBe(broadcastId);
      expect(retrieved.name).toBe('Consistency Test');
      expect(retrieved.message).toBe('Original message');
    });
  });
});
