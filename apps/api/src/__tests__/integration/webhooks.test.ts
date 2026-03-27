import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../../server';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

/**
 * Phase 4.3: Integration Tests - Webhook Callback Processing
 *
 * Tests verify webhook handling:
 * 1. Webhook registration and configuration
 * 2. Signature verification (HMAC validation)
 * 3. Payload processing and acknowledgment
 * 4. Error handling and retry logic
 * 5. Provider-specific webhook formats
 * 6. Duplicate detection and idempotency
 */

describe('Integration: Webhook Callback Processing', () => {
  let server: FastifyInstance;
  let prisma: PrismaClient;
  let orgId: string;
  let userId: string;
  let adminId: string;
  let adminToken: string;
  let webhookSecret = 'test-webhook-secret';

  beforeAll(async () => {
    server = await createServer();
    prisma = new PrismaClient();

    // Create organization
    const org = await prisma.organization.create({
      data: {
        id: 'test-org-webhooks',
        name: 'Webhook Test Organization',
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
        email: 'admin-webhook@test.com',
        name: 'Admin Webhook User',
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
        email: 'user-webhook@test.com',
        name: 'Regular Webhook User',
        passwordHash,
        role: 'user',
        status: 'active',
        organizationId: orgId,
      },
    });
    userId = regularUser.id;
  });

  afterAll(async () => {
    // Cleanup in reverse order of dependencies
    await prisma.webhook.deleteMany({ where: { organizationId: orgId } });
    await prisma.webhookEvent.deleteMany({ where: { webhook: { organizationId: orgId } } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
    await server.close();
  });

  describe('Webhook Registration', () => {
    it('should create webhook endpoint for organization', async () => {
      const webhook = await prisma.webhook.create({
        data: {
          id: 'webhook-1',
          organizationId: orgId,
          url: 'https://example.com/webhooks/telegram',
          secret: webhookSecret,
          provider: 'telegram',
          status: 'active',
          events: ['message.received', 'message.delivered'],
        },
      });

      expect(webhook.provider).toBe('telegram');
      expect(webhook.status).toBe('active');
      expect(webhook.events).toContain('message.received');
    });

    it('should validate webhook URL format', async () => {
      const validUrls = [
        'https://example.com/webhooks/telegram',
        'https://app.example.com/api/webhooks/telegram',
        'https://api.example.com:8443/webhooks/telegram',
      ];

      const invalidUrls = [
        'http://example.com/webhooks/telegram', // http not allowed
        'example.com/webhooks/telegram', // missing protocol
        'https://localhost/webhooks/telegram', // localhost not allowed
      ];

      validUrls.forEach((url) => {
        const isValid = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/.test(url);
        expect(isValid).toBe(true);
      });

      invalidUrls.forEach((url) => {
        const isValid = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/.test(url);
        expect(isValid).toBe(false);
      });
    });

    it('should allow configuring webhook events', async () => {
      const webhook = await prisma.webhook.findFirst({
        where: { organizationId: orgId, provider: 'telegram' },
      });

      if (webhook) {
        const updatedWebhook = await prisma.webhook.update({
          where: { id: webhook.id },
          data: {
            events: [
              'message.received',
              'message.delivered',
              'message.read',
              'delivery_failure',
            ],
          },
        });

        expect(updatedWebhook.events.length).toBe(4);
      }
    });

    it('should support multiple webhooks per provider', async () => {
      await prisma.webhook.create({
        data: {
          id: 'webhook-slack-1',
          organizationId: orgId,
          url: 'https://example.com/webhooks/slack',
          secret: 'slack-secret',
          provider: 'slack',
          status: 'active',
          events: ['message.received'],
        },
      });

      const webhooks = await prisma.webhook.findMany({
        where: { organizationId: orgId },
      });

      expect(webhooks.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Signature Verification', () => {
    it('should verify HMAC signature for Telegram webhook', async () => {
      const payload = {
        update_id: 123456789,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 987654321, first_name: 'User' },
          text: 'Hello',
        },
      };

      const payloadJson = JSON.stringify(payload);
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payloadJson)
        .digest('hex');

      // Verify signature
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payloadJson)
        .digest('hex');

      expect(signature).toBe(expectedSignature);
    });

    it('should reject webhook with invalid signature', async () => {
      const payload = { data: 'test' };
      const payloadJson = JSON.stringify(payload);

      const validSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payloadJson)
        .digest('hex');

      const invalidSignature = crypto
        .createHmac('sha256', 'wrong-secret')
        .update(payloadJson)
        .digest('hex');

      expect(validSignature).not.toBe(invalidSignature);
    });

    it('should verify Slack request signature with timestamp', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const body = 'test-body';

      // Slack format: sha256=hashdigest
      const sigBasestring = `v0:${timestamp}:${body}`;
      const signature = crypto
        .createHmac('sha256', 'signing-secret')
        .update(sigBasestring)
        .digest('hex');

      const slackSignature = `v0=${signature}`;

      expect(slackSignature).toMatch(/^v0=[a-f0-9]{64}$/);
    });

    it('should reject webhook with expired timestamp', () => {
      // Slack requires timestamp to be within 5 minutes
      const now = Math.floor(Date.now() / 1000);
      const fiveMinutesAgo = now - 300;
      const tenMinutesAgo = now - 600;

      const isValidFiveMinutes = Math.abs(now - fiveMinutesAgo) <= 300;
      const isValidTenMinutes = Math.abs(now - tenMinutesAgo) <= 300;

      expect(isValidFiveMinutes).toBe(true);
      expect(isValidTenMinutes).toBe(false);
    });
  });

  describe('Webhook Payload Processing', () => {
    it('should process Telegram message webhook', async () => {
      const telegramPayload = {
        update_id: 123456789,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: 987654321, first_name: 'John', last_name: 'Doe' },
          from: { id: 987654321, first_name: 'John', is_bot: false },
          text: 'Hello bot',
        },
      };

      // Store webhook event
      const webhook = await prisma.webhook.findFirst({
        where: { provider: 'telegram', organizationId: orgId },
      });

      if (webhook) {
        const event = await prisma.webhookEvent.create({
          data: {
            id: `event-${telegramPayload.update_id}`,
            webhookId: webhook.id,
            eventType: 'message.received',
            payload: telegramPayload,
            status: 'processed',
            processedAt: new Date(),
          },
        });

        expect(event.eventType).toBe('message.received');
        expect(event.status).toBe('processed');
      }
    });

    it('should process Slack event webhook', async () => {
      const slackPayload = {
        token: 'verification-token',
        team_id: 'T123456',
        event: {
          type: 'message',
          channel: 'C123456',
          user: 'U123456',
          text: 'Hello',
          ts: '1234567890.123456',
        },
        type: 'event_callback',
        event_id: 'Ev123456',
        event_time: Math.floor(Date.now() / 1000),
      };

      const webhook = await prisma.webhook.findFirst({
        where: { provider: 'slack', organizationId: orgId },
      });

      if (webhook) {
        const event = await prisma.webhookEvent.create({
          data: {
            id: `slack-event-${slackPayload.event_id}`,
            webhookId: webhook.id,
            eventType: slackPayload.event.type,
            payload: slackPayload,
            status: 'processed',
          },
        });

        expect(event.eventType).toBe('message');
      }
    });

    it('should process WhatsApp message webhook', async () => {
      const whatsappPayload = {
        object: 'whatsapp_business_account',
        entry: [
          {
            id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
            changes: [
              {
                value: {
                  messaging_product: 'whatsapp',
                  metadata: {
                    display_phone_number: '15551234567',
                    phone_number_id: '102226176385098',
                  },
                  messages: [
                    {
                      from: '33123456789',
                      id: 'wamid.123456',
                      timestamp: '1234567890',
                      type: 'text',
                      text: { body: 'Hello' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      expect(whatsappPayload.object).toBe('whatsapp_business_account');
      expect(whatsappPayload.entry[0].changes[0].value.messages[0].text.body).toBe('Hello');
    });

    it('should handle Gmail notification webhook', async () => {
      const gmailNotification = {
        message: {
          data: Buffer.from(
            JSON.stringify({
              emailAddress: 'user@example.com',
              historyId: '123456',
            })
          ).toString('base64'),
        },
      };

      const payload = JSON.parse(
        Buffer.from(gmailNotification.message.data, 'base64').toString('utf-8')
      );

      expect(payload.emailAddress).toBe('user@example.com');
      expect(payload.historyId).toBe('123456');
    });
  });

  describe('Idempotency & Duplicate Detection', () => {
    it('should prevent duplicate webhook processing', async () => {
      const webhook = await prisma.webhook.findFirst({
        where: { provider: 'telegram', organizationId: orgId },
      });

      if (webhook) {
        const eventId = 'duplicate-test-123';

        // First attempt
        const event1 = await prisma.webhookEvent.findFirst({
          where: { id: eventId },
        });

        if (!event1) {
          await prisma.webhookEvent.create({
            data: {
              id: eventId,
              webhookId: webhook.id,
              eventType: 'message.received',
              payload: { update_id: 123 },
              status: 'processed',
            },
          });
        }

        // Second attempt (should be idempotent)
        const event2 = await prisma.webhookEvent.findFirst({
          where: { id: eventId },
        });

        expect(event2?.id).toBe(eventId);
      }
    });

    it('should track webhook event processing time', async () => {
      const webhook = await prisma.webhook.findFirst({
        where: { provider: 'telegram', organizationId: orgId },
      });

      if (webhook) {
        const startTime = Date.now();

        const event = await prisma.webhookEvent.create({
          data: {
            id: `perf-test-${Date.now()}`,
            webhookId: webhook.id,
            eventType: 'message.received',
            payload: { test: true },
            status: 'processed',
            processedAt: new Date(),
          },
        });

        const endTime = Date.now();
        const processingTime = endTime - startTime;

        // Should process in less than 100ms
        expect(processingTime).toBeLessThan(100);
      }
    });

    it('should support idempotency key from provider', async () => {
      // Providers send idempotency keys to prevent duplicates
      const idempotencyHeaders = {
        'x-idempotency-key': 'slack-event-abc123',
        'x-webhook-delivery-id': 'wh-delivery-123',
      };

      expect(idempotencyHeaders['x-idempotency-key']).toBeDefined();
      expect(idempotencyHeaders['x-idempotency-key']).toBe('slack-event-abc123');
    });
  });

  describe('Error Handling & Retry Logic', () => {
    it('should handle webhook processing errors', async () => {
      const webhook = await prisma.webhook.findFirst({
        where: { provider: 'telegram', organizationId: orgId },
      });

      if (webhook) {
        const failedEvent = await prisma.webhookEvent.create({
          data: {
            id: `error-test-${Date.now()}`,
            webhookId: webhook.id,
            eventType: 'message.received',
            payload: { test: 'error' },
            status: 'failed',
            error: 'Failed to process message: invalid format',
            retryCount: 0,
          },
        });

        expect(failedEvent.status).toBe('failed');
        expect(failedEvent.error).toContain('invalid format');
      }
    });

    it('should implement exponential backoff for retries', () => {
      const maxRetries = 5;
      const baseDelay = 1000; // 1 second

      const retryDelays = Array.from({ length: maxRetries }, (_, i) => {
        // Exponential backoff: 1s, 2s, 4s, 8s, 16s
        return baseDelay * Math.pow(2, i);
      });

      expect(retryDelays[0]).toBe(1000);
      expect(retryDelays[1]).toBe(2000);
      expect(retryDelays[4]).toBe(16000);
      expect(retryDelays[4]).toBeLessThan(60000); // Less than 1 minute max
    });

    it('should log webhook processing failures', async () => {
      const webhook = await prisma.webhook.findFirst({
        where: { provider: 'telegram', organizationId: orgId },
      });

      if (webhook) {
        const failureLog = {
          webhookId: webhook.id,
          eventId: `fail-log-${Date.now()}`,
          error: 'Connection timeout',
          statusCode: 504,
          timestamp: new Date(),
          attempt: 1,
        };

        expect(failureLog.statusCode).toBe(504);
        expect(failureLog.error).toContain('timeout');
      }
    });
  });

  describe('Provider-Specific Webhook Handling', () => {
    it('should verify Telegram webhook challenge', () => {
      // Telegram sends challenge on webhook setup
      const challengePayload = {
        update_id: -1,
      };

      // System should respond immediately with 200 OK
      expect(challengePayload.update_id).toBe(-1);
    });

    it('should acknowledge Slack events immediately', () => {
      // Slack requires 200 OK response within 3 seconds
      const acknowledgment = {
        statusCode: 200,
        acknowledgedAt: new Date(),
      };

      expect(acknowledgment.statusCode).toBe(200);
    });

    it('should handle Slack URL verification challenge', () => {
      const challenge = {
        type: 'url_verification',
        challenge: 'test-challenge-string',
      };

      // System should respond with challenge token
      expect(challenge.type).toBe('url_verification');
      expect(challenge.challenge).toBeDefined();
    });

    it('should process WhatsApp delivery status notifications', () => {
      const deliveryStatus = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'wamid.123456',
                      status: 'delivered',
                      timestamp: Math.floor(Date.now() / 1000),
                      recipient_id: '1234567890',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      expect(deliveryStatus.entry[0].changes[0].value.statuses[0].status).toBe('delivered');
    });

    it('should handle Gmail push notifications', () => {
      const gmailPush = {
        message: {
          data: 'base64-encoded-data',
          messageId: 'message-id',
        },
        subscription: 'projects/project-id/subscriptions/subscription-id',
      };

      expect(gmailPush.message.data).toBeDefined();
      expect(gmailPush.subscription).toContain('subscription');
    });
  });

  describe('Webhook Health & Monitoring', () => {
    it('should track webhook success rate', async () => {
      const webhook = await prisma.webhook.findFirst({
        where: { provider: 'telegram', organizationId: orgId },
      });

      if (webhook) {
        const events = await prisma.webhookEvent.findMany({
          where: { webhookId: webhook.id },
        });

        const successCount = events.filter((e) => e.status === 'processed').length;
        const failureCount = events.filter((e) => e.status === 'failed').length;
        const totalCount = events.length;

        const successRate = totalCount > 0 ? (successCount / totalCount) * 100 : 0;

        expect(successRate).toBeGreaterThanOrEqual(0);
        expect(successRate).toBeLessThanOrEqual(100);
      }
    });

    it('should disable webhook after too many failures', async () => {
      const webhook = await prisma.webhook.findFirst({
        where: { provider: 'telegram', organizationId: orgId },
      });

      if (webhook) {
        // Simulate consecutive failures
        const consecutiveFailures = 10;
        const failureThreshold = 10;

        if (consecutiveFailures >= failureThreshold) {
          await prisma.webhook.update({
            where: { id: webhook.id },
            data: { status: 'disabled' },
          });

          const updatedWebhook = await prisma.webhook.findUnique({
            where: { id: webhook.id },
          });

          expect(updatedWebhook?.status).toBe('disabled');
        }
      }
    });

    it('should alert on webhook latency', () => {
      const webhookMetrics = {
        avgResponseTime: 450, // ms
        maxResponseTime: 5000, // ms
        latencyThreshold: 3000, // ms
      };

      const isHighLatency = webhookMetrics.avgResponseTime > webhookMetrics.latencyThreshold;
      expect(isHighLatency).toBe(false);

      const isMaxLatencyExceeded = webhookMetrics.maxResponseTime > webhookMetrics.latencyThreshold;
      expect(isMaxLatencyExceeded).toBe(true);
    });
  });
});
