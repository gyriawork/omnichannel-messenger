import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createServer } from '../server';

describe('OAuth Routes', () => {
  let server: FastifyInstance;
  let prisma: PrismaClient;
  let orgId: string;
  let userId: string;
  let token: string;

  beforeAll(async () => {
    server = await createServer();
    prisma = new PrismaClient();

    // Create organization
    const org = await prisma.organization.create({
      data: {
        id: 'test-org-oauth',
        name: 'OAuth Test Org',
        defaultLanguage: 'en',
        timezone: 'UTC',
        status: 'active',
      },
    });
    orgId = org.id;

    // Create user
    const passwordHash = await bcrypt.hash('password123', 12);
    const user = await prisma.user.create({
      data: {
        email: 'oauth-user@test.com',
        name: 'OAuth Tester',
        passwordHash,
        role: 'user',
        status: 'active',
        organizationId: orgId,
      },
    });
    userId = user.id;

    // Generate token
    token = server.jwt.sign({ userId, orgId }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    await prisma.oauthState.deleteMany({});
    await prisma.integration.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
    await server.close();
  });

  beforeEach(async () => {
    await prisma.oauthState.deleteMany({});
    await prisma.integration.deleteMany({ where: { organizationId: orgId } });
  });

  describe('POST /api/oauth/callback/telegram', () => {
    let stateToken: string;

    beforeEach(async () => {
      // Create valid state token
      const state = await prisma.oauthState.create({
        data: {
          provider: 'telegram',
          userId,
          organizationId: orgId,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 min from now
        },
      });
      stateToken = state.id;
    });

    it('should complete OAuth flow with valid state and token', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
          botToken: 'test-bot-token-123',
          botUsername: 'testbot_handle',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('status', 'connected');
      expect(data).toHaveProperty('provider', 'telegram');

      // Verify integration was created
      const integration = await prisma.integration.findFirst({
        where: {
          provider: 'telegram',
          organizationId: orgId,
        },
      });
      expect(integration).toBeDefined();
      expect(integration?.status).toBe('connected');
    });

    it('should reject callback without state parameter', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          botToken: 'test-bot-token',
          botUsername: 'testbot',
        },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should reject callback with invalid state', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: 'invalid-state-token',
          botToken: 'test-bot-token',
          botUsername: 'testbot',
        },
      });

      expect(response.statusCode).toBe(400);
      const data = response.json();
      expect(data.error.code).toBe('INVALID_STATE');
    });

    it('should reject callback with expired state', async () => {
      // Create expired state
      const expiredState = await prisma.oauthState.create({
        data: {
          provider: 'telegram',
          userId,
          organizationId: orgId,
          expiresAt: new Date(Date.now() - 1000), // 1 second ago
        },
      });

      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: expiredState.id,
          botToken: 'test-bot-token',
          botUsername: 'testbot',
        },
      });

      expect(response.statusCode).toBe(400);
      const data = response.json();
      expect(data.error.code).toBe('EXPIRED_STATE');
    });

    it('should reject unauthenticated callback', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        payload: {
          state: stateToken,
          botToken: 'test-bot-token',
          botUsername: 'testbot',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject callback with missing bot credentials', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
          // missing botToken and botUsername
        },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should cleanup state token after successful callback', async () => {
      await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
          botToken: 'test-bot-token',
          botUsername: 'testbot',
        },
      });

      // Verify state was deleted
      const stateExists = await prisma.oauthState.findUnique({
        where: { id: stateToken },
      });
      expect(stateExists).toBeNull();
    });

    it('should prevent state token reuse', async () => {
      // First callback succeeds
      const response1 = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
          botToken: 'test-bot-token-1',
          botUsername: 'testbot1',
        },
      });
      expect(response1.statusCode).toBe(200);

      // Second callback with same state should fail
      const response2 = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
          botToken: 'test-bot-token-2',
          botUsername: 'testbot2',
        },
      });
      expect(response2.statusCode).toBe(400);
    });
  });

  describe('POST /api/oauth/callback/slack', () => {
    let stateToken: string;

    beforeEach(async () => {
      const state = await prisma.oauthState.create({
        data: {
          provider: 'slack',
          userId,
          organizationId: orgId,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      stateToken = state.id;
    });

    it('should complete Slack OAuth flow', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/slack',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
          code: 'slack-auth-code-123',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.provider).toBe('slack');
      expect(data.status).toBe('connected');
    });

    it('should reject without code parameter', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/slack',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
        },
      });

      expect(response.statusCode).toBe(422);
    });
  });

  describe('POST /api/oauth/callback/whatsapp', () => {
    let stateToken: string;

    beforeEach(async () => {
      const state = await prisma.oauthState.create({
        data: {
          provider: 'whatsapp',
          userId,
          organizationId: orgId,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      stateToken = state.id;
    });

    it('should complete WhatsApp OAuth flow', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/whatsapp',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
          phoneNumberId: 'wa-phone-123',
          accessToken: 'whatsapp-access-token',
          businessAccountId: 'wa-business-456',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.provider).toBe('whatsapp');
    });

    it('should validate required fields for WhatsApp', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/whatsapp',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
          phoneNumberId: 'wa-phone-123',
          // missing accessToken and businessAccountId
        },
      });

      expect(response.statusCode).toBe(422);
    });
  });

  describe('POST /api/oauth/callback/gmail', () => {
    let stateToken: string;

    beforeEach(async () => {
      const state = await prisma.oauthState.create({
        data: {
          provider: 'gmail',
          userId,
          organizationId: orgId,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
      stateToken = state.id;
    });

    it('should complete Gmail OAuth flow', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/gmail',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          state: stateToken,
          code: 'gmail-auth-code-789',
          scope: 'https://www.googleapis.com/auth/gmail.send',
        },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.provider).toBe('gmail');
    });
  });

  describe('POST /api/oauth/start/:provider', () => {
    it('should generate state token for Telegram', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/start/telegram',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('authUrl');
      expect(data).toHaveProperty('state');
      expect(data.authUrl).toContain('https://t.me/');
    });

    it('should generate state token for Slack', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/start/slack',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data).toHaveProperty('authUrl');
      expect(data.authUrl).toContain('slack.com');
    });

    it('should reject invalid provider', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/start/invalid-provider',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject unauthenticated start', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/start/telegram',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should create state record with expiry', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/start/telegram',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const { state } = response.json();

      // Verify state was created in DB
      const stateRecord = await prisma.oauthState.findUnique({
        where: { id: state },
      });
      expect(stateRecord).toBeDefined();
      expect(stateRecord?.provider).toBe('telegram');
      expect(stateRecord?.userId).toBe(userId);
      expect(stateRecord?.expiresAt).toBeInstanceOf(Date);
      expect(stateRecord?.expiresAt.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Security & CSRF Protection', () => {
    it('should reject state token from different user', async () => {
      // Create another user
      const otherUser = await prisma.user.create({
        data: {
          email: 'other-oauth@test.com',
          name: 'Other OAuth User',
          passwordHash: await bcrypt.hash('password', 12),
          role: 'user',
          status: 'active',
          organizationId: orgId,
        },
      });
      const otherToken = server.jwt.sign({ userId: otherUser.id, orgId }, { expiresIn: '15m' });

      // Create state for original user
      const state = await prisma.oauthState.create({
        data: {
          provider: 'telegram',
          userId,
          organizationId: orgId,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      // Try to use state with different user
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${otherToken}` },
        payload: {
          state: state.id,
          botToken: 'test-bot',
          botUsername: 'testbot',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_STATE');

      await prisma.user.delete({ where: { id: otherUser.id } });
    });

    it('should reject state token from different organization', async () => {
      // Create another org
      const otherOrg = await prisma.organization.create({
        data: {
          id: 'other-oauth-org',
          name: 'Other OAuth Org',
          defaultLanguage: 'en',
          timezone: 'UTC',
          status: 'active',
        },
      });

      const otherOrgUser = await prisma.user.create({
        data: {
          email: 'other-org-oauth@test.com',
          name: 'Other Org OAuth',
          passwordHash: await bcrypt.hash('password', 12),
          role: 'user',
          status: 'active',
          organizationId: otherOrg.id,
        },
      });
      const otherOrgToken = server.jwt.sign({ userId: otherOrgUser.id, orgId: otherOrg.id }, { expiresIn: '15m' });

      // Create state in other org
      const state = await prisma.oauthState.create({
        data: {
          provider: 'telegram',
          userId: otherOrgUser.id,
          organizationId: otherOrg.id,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });

      // Try to use state from different org
      const response = await server.inject({
        method: 'POST',
        url: '/api/oauth/callback/telegram',
        headers: { authorization: `Bearer ${token}` }, // First org token
        payload: {
          state: state.id,
          botToken: 'test-bot',
          botUsername: 'testbot',
        },
      });

      expect(response.statusCode).toBe(400);

      // Cleanup
      await prisma.oauthState.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.user.delete({ where: { id: otherOrgUser.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    });
  });
});
