import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { createTestServer } from '../__test__/setup';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

describe('Activity Routes', () => {
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
        id: 'test-org-activity-' + Date.now(),
        name: 'Activity Test Org',
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
        email: `activity-test-${Date.now()}@test.local`,
        name: 'Activity Tester',
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

    // Create sample activity logs
    const now = Date.now();
    await prisma.activityLog.createMany({
      data: [
        {
          category: 'users',
          action: 'user_invited',
          description: 'Invited test user',
          userId,
          userName: 'Activity Tester',
          organizationId: orgId,
          createdAt: new Date(now - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        },
        {
          category: 'chats',
          action: 'chat_imported',
          description: 'Imported 3 chats from Telegram',
          userId,
          userName: 'Activity Tester',
          organizationId: orgId,
          createdAt: new Date(now - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        },
        {
          category: 'broadcast',
          action: 'broadcast_sent',
          description: 'Sent broadcast to 25 contacts',
          userId,
          userName: 'Activity Tester',
          organizationId: orgId,
          createdAt: new Date(now - 24 * 60 * 60 * 1000), // 1 day ago
        },
        {
          category: 'templates',
          action: 'template_created',
          description: 'Created "Welcome" template',
          userId,
          userName: 'Activity Tester',
          organizationId: orgId,
          createdAt: new Date(now - 12 * 60 * 60 * 1000), // 12 hours ago
        },
        {
          category: 'integrations',
          action: 'integration_connected',
          description: 'Connected Slack workspace',
          userId,
          userName: 'Activity Tester',
          organizationId: orgId,
          createdAt: new Date(now - 2 * 60 * 60 * 1000), // 2 hours ago
        },
        {
          category: 'settings',
          action: 'settings_updated',
          description: 'Updated antiban settings for Telegram',
          userId,
          userName: 'Activity Tester',
          organizationId: orgId,
          createdAt: new Date(now - 60 * 60 * 1000), // 1 hour ago
        },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    // Cleanup activity logs
    await prisma.activityLog.deleteMany({
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

  describe('GET /api/activity', () => {
    it('should list activity logs for organization', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(Array.isArray(data.logs)).toBe(true);
      expect(data.logs.length).toBeGreaterThanOrEqual(6);
      expect(data).toHaveProperty('total');
      expect(data).toHaveProperty('cursor');
    });

    it('should include activity log details', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      const log = data.logs[0];

      expect(log).toHaveProperty('id');
      expect(log).toHaveProperty('category');
      expect(log).toHaveProperty('action');
      expect(log).toHaveProperty('description');
      expect(log).toHaveProperty('userId');
      expect(log).toHaveProperty('userName');
      expect(log).toHaveProperty('createdAt');
    });

    it('should filter by category', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity?category=broadcast',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.logs.length).toBeGreaterThanOrEqual(1);
      
      const allBroadcasts = data.logs.every((log: any) => log.category === 'broadcast');
      expect(allBroadcasts).toBe(true);
    });

    it('should filter by action', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity?action=user_invited',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      
      const allMatching = data.logs.every((log: any) => log.action === 'user_invited');
      expect(allMatching).toBe(true);
    });

    it('should support pagination with cursor', async () => {
      const firstPage = await server.inject({
        method: 'GET',
        url: '/api/activity?limit=2',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(firstPage.statusCode).toBe(200);
      const data1 = firstPage.json();
      expect(data1.logs.length).toBe(2);
      expect(data1.cursor).toBeDefined();

      // Fetch next page
      const secondPage = await server.inject({
        method: 'GET',
        url: `/api/activity?limit=2&cursor=${data1.cursor}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(secondPage.statusCode).toBe(200);
      const data2 = secondPage.json();
      expect(data2.logs.length).toBeGreaterThanOrEqual(1);
      
      // Verify different logs
      const firstPageIds = data1.logs.map((l: any) => l.id);
      const secondPageIds = data2.logs.map((l: any) => l.id);
      const hasDifferent = !firstPageIds.some((id: string) => secondPageIds.includes(id));
      expect(hasDifferent).toBe(true);
    });

    it('should support date range filtering', async () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);

      const response = await server.inject({
        method: 'GET',
        url: `/api/activity?startDate=${twoDaysAgo.toISOString()}&endDate=${now.toISOString()}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      
      // Should include recent activities
      const hasRecent = data.logs.some((log: any) => {
        const logTime = new Date(log.createdAt).getTime();
        return logTime >= twoDaysAgo.getTime() && logTime <= now.getTime();
      });
      expect(hasRecent).toBe(true);
    });

    it('should support combined filters', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity?category=integrations&action=integration_connected',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      
      const allMatching = data.logs.every((log: any) => 
        log.category === 'integrations' && log.action === 'integration_connected'
      );
      expect(allMatching).toBe(true);
    });

    it('should return empty results for non-matching filter', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity?category=nonexistent',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.logs).toHaveLength(0);
      expect(data.total).toBe(0);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should isolate by organization', async () => {
      // Create another org with activity
      const org2 = await prisma.organization.create({
        data: {
          id: 'test-org-activity-2-' + Date.now(),
          name: 'Activity Org 2',
          defaultLanguage: 'en',
          timezone: 'UTC',
          chatVisibilityAll: true,
          status: 'active',
        },
      });

      const passwordHash = await bcrypt.hash('pass123', 12);
      const user2 = await prisma.user.create({
        data: {
          email: `activity-user2-${Date.now()}@test.local`,
          name: 'Activity User 2',
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

      // Create different activity in org2
      await prisma.activityLog.create({
        data: {
          category: 'users',
          action: 'user_created',
          description: 'Created new user',
          userId: user2.id,
          userName: 'Activity User 2',
          organizationId: org2.id,
        },
      });

      // Fetch from both orgs
      const response1 = await server.inject({
        method: 'GET',
        url: '/api/activity',
        headers: { authorization: `Bearer ${token}` },
      });

      const response2 = await server.inject({
        method: 'GET',
        url: '/api/activity',
        headers: { authorization: `Bearer ${token2}` },
      });

      expect(response1.statusCode).toBe(200);
      expect(response2.statusCode).toBe(200);

      const data1 = response1.json();
      const data2 = response2.json();

      // org1 should not see org2's activity
      const hasOrg2Activity = data1.logs.some((log: any) => 
        log.organizationId === org2.id || log.userName === 'Activity User 2'
      );
      expect(hasOrg2Activity).toBe(false);

      // Cleanup
      await prisma.activityLog.deleteMany({
        where: { organizationId: org2.id },
      });
      await prisma.user.delete({ where: { id: user2.id } });
      await prisma.organization.delete({ where: { id: org2.id } });
    });
  });

  describe('GET /api/activity/:id', () => {
    it('should fetch single activity log by id', async () => {
      // Get list first
      const listResponse = await server.inject({
        method: 'GET',
        url: '/api/activity?limit=1',
        headers: { authorization: `Bearer ${token}` },
      });

      const listData = listResponse.json();
      const logId = listData.logs[0].id;

      // Fetch single
      const response = await server.inject({
        method: 'GET',
        url: `/api/activity/${logId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.id).toBe(logId);
      expect(data).toHaveProperty('category');
      expect(data).toHaveProperty('action');
      expect(data).toHaveProperty('description');
    });

    it('should return 404 for non-existent id', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity/nonexistent-id-' + Date.now(),
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should require authentication', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/activity/some-id',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should not allow cross-organization access', async () => {
      // Create org2 with activity
      const org2 = await prisma.organization.create({
        data: {
          id: 'test-org-activity-cross-' + Date.now(),
          name: 'Activity Cross Org',
          defaultLanguage: 'en',
          timezone: 'UTC',
          chatVisibilityAll: true,
          status: 'active',
        },
      });

      const passwordHash = await bcrypt.hash('pass123', 12);
      const user2 = await prisma.user.create({
        data: {
          email: `cross-activity-${Date.now()}@test.local`,
          name: 'Cross User',
          passwordHash,
          role: 'admin',
          status: 'active',
          organizationId: org2.id,
        },
      });

      const log2 = await prisma.activityLog.create({
        data: {
          category: 'users',
          action: 'user_invited',
          description: 'Cross org activity',
          userId: user2.id,
          userName: 'Cross User',
          organizationId: org2.id,
        },
      });

      const token2 = server.jwt.sign(
        { userId: user2.id, email: user2.email, organizationId: org2.id },
        { expiresIn: '15m' }
      );

      // Try to access org2's activity with org1's token
      const response = await server.inject({
        method: 'GET',
        url: `/api/activity/${log2.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404); // org1 shouldn't see org2's activity

      // Cleanup
      await prisma.activityLog.deleteMany({
        where: { organizationId: org2.id },
      });
      await prisma.user.delete({ where: { id: user2.id } });
      await prisma.organization.delete({ where: { id: org2.id } });
    });
  });

  describe('Activity timestamp accuracy', () => {
    it('should preserve createdAt timestamp', async () => {
      const testTime = new Date('2026-03-15T10:30:00Z');
      
      const log = await prisma.activityLog.create({
        data: {
          category: 'chats',
          action: 'chat_imported',
          description: 'Test timestamp',
          userId,
          userName: 'Activity Tester',
          organizationId: orgId,
          createdAt: testTime,
        },
      });

      const response = await server.inject({
        method: 'GET',
        url: `/api/activity/${log.id}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(new Date(data.createdAt).getTime()).toBe(testTime.getTime());
    });
  });
});
