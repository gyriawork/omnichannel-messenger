import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { encryptCredentials, decryptCredentials } from '../lib/crypto.js';
import { authenticate } from '../middleware/auth.js';
import { createAdapter } from '../integrations/factory.js';
import { MessengerError } from '../integrations/base.js';
// These imports may fail on some environments if native deps are missing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let createAuthClient: any, storePendingAuth: any, getPendingAuth: any, removePendingAuth: any, TelegramAdapter: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let StringSession: any, Api: any, computeCheck: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let startWhatsAppPairing: any, cancelPairing: any;

import { getIO } from '../websocket/index.js';
import { getTelegramManager } from '../services/telegram-connection-manager.js';
import { cacheGet, cacheSet, cacheInvalidate, cacheKey } from '../lib/cache.js';

// ─── Zod Schemas ───

const messengerParamSchema = z.object({
  messenger: z.enum(['telegram', 'slack', 'whatsapp', 'gmail']),
});

const connectTelegramSchema = z.object({
  apiId: z.coerce.number().int().positive(),
  apiHash: z.string().min(1),
  session: z.string().optional(),
  phoneNumber: z.string().optional(),
});

const connectSlackSchema = z.object({
  token: z.string().min(1),
});

const connectWhatsAppSchema = z.object({
  authState: z.string().optional(),
  phoneNumber: z.string().optional(),
});

const connectGmailSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  refreshToken: z.string().min(1),
});

const updateSettingsSchema = z.object({
  settings: z.record(z.unknown()),
});

// ─── Telegram multi-step auth schemas ───

const telegramSendCodeSchema = z.object({
  apiId: z.coerce.number().int().positive(),
  apiHash: z.string().min(1),
  phoneNumber: z.string().min(1, 'Phone number is required'),
});

const telegramVerifyCodeSchema = z.object({
  phoneNumber: z.string().min(1),
  phoneCodeHash: z.string().min(1),
  code: z.string().min(1, 'Verification code is required'),
  password: z.string().optional(),
});

// Map messenger to its credential schema
const credentialSchemas: Record<string, z.ZodType> = {
  telegram: connectTelegramSchema,
  slack: connectSlackSchema,
  whatsapp: connectWhatsAppSchema,
  gmail: connectGmailSchema,
};

// ─── Helpers ───

function sendError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.status(statusCode).send({
    error: { code, message, statusCode },
  });
}

function getOrgId(request: FastifyRequest): string | null {
  if (request.user.role === 'superadmin') {
    const query = request.query as Record<string, string>;
    return query.organizationId ?? request.user.organizationId;
  }
  return request.user.organizationId;
}

/** Return a safe integration object without raw credentials. */
function sanitizeIntegration(integration: {
  id: string;
  messenger: string;
  status: string;
  settings: unknown;
  organizationId: string;
  userId: string;
  connectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: integration.id,
    messenger: integration.messenger,
    status: integration.status,
    settings: integration.settings,
    organizationId: integration.organizationId,
    userId: integration.userId,
    connectedAt: integration.connectedAt,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt,
  };
}

// ─── Plugin ───

export default async function integrationRoutes(fastify: FastifyInstance): Promise<void> {
  // Load telegram/whatsapp inside plugin (not at module level) to avoid crashing if native deps fail
  try {
    const tgMod = await import('../integrations/telegram.js');
    createAuthClient = tgMod.createAuthClient;
    storePendingAuth = tgMod.storePendingAuth;
    getPendingAuth = tgMod.getPendingAuth;
    removePendingAuth = tgMod.removePendingAuth;
    TelegramAdapter = tgMod.TelegramAdapter;

    const sessions = await import('telegram/sessions/index.js');
    StringSession = sessions.StringSession;
    const apiMod = await import('telegram');
    Api = apiMod.Api;
    const pwMod = await import('telegram/Password.js');
    computeCheck = pwMod.computeCheck;
  } catch (e) {
    console.warn('Telegram integration unavailable:', (e as Error).message);
  }

  try {
    const waMod = await import('../integrations/whatsapp.js');
    startWhatsAppPairing = waMod.startWhatsAppPairing;
    cancelPairing = waMod.cancelPairing;
  } catch (e) {
    console.warn('WhatsApp integration unavailable:', (e as Error).message);
  }

  const authPreHandlers = [authenticate];

  // ─── GET /integrations ───
  // List all integrations for the current organization.

  fastify.get(
    '/integrations',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const ck = cacheKey(organizationId, 'integrations');
      const cached = await cacheGet(ck);
      if (cached) {
        return reply.send(cached);
      }

      const integrations = await prisma.integration.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });

      const response = {
        integrations: integrations.map(sanitizeIntegration),
      };
      await cacheSet(ck, response, 300);

      return reply.send(response);
    },
  );

  // ─── POST /integrations/:messenger/connect ───
  // Connect a new messenger integration.

  fastify.post(
    '/integrations/:messenger/connect',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = messengerParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid messenger type', 422);
      }

      const { messenger } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      // Validate credentials based on messenger type
      const credentialSchema = credentialSchemas[messenger];
      if (!credentialSchema) {
        return sendError(reply, 'VALIDATION_ERROR', `Unknown messenger: ${messenger}`, 422);
      }

      const bodyParsed = credentialSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        const issues = (bodyParsed as { success: false; error: z.ZodError }).error.issues;
        return sendError(
          reply,
          'VALIDATION_ERROR',
          issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          422,
        );
      }

      const credentials = bodyParsed.data as Record<string, unknown>;

      // Check if integration already exists for this messenger + org + user
      const existing = await prisma.integration.findUnique({
        where: {
          messenger_organizationId_userId: {
            messenger,
            organizationId,
            userId: request.user.id,
          },
        },
      });

      // Try to connect using the adapter to verify credentials
      const adapter = await createAdapter(messenger, credentials);
      try {
        await adapter.connect();
      } catch (err) {
        try { await adapter.disconnect(); } catch (e) { request.log.warn(e, 'adapter disconnect error'); }
        const message =
          err instanceof MessengerError
            ? err.message
            : `Failed to connect to ${messenger}`;
        return sendError(reply, 'MESSENGER_API_ERROR', message, 502);
      }

      // Encrypt credentials before storing
      const encryptedCredentials = encryptCredentials(credentials);

      let integration;

      try {
        if (existing) {
          // Update existing integration
          integration = await prisma.integration.update({
            where: { id: existing.id },
            data: {
              credentials: encryptedCredentials,
              status: 'connected',
              connectedAt: new Date(),
            },
          });
        } else {
          // Create new integration
          integration = await prisma.integration.create({
            data: {
              messenger,
              status: 'connected',
              credentials: encryptedCredentials,
              organizationId,
              userId: request.user.id,
              connectedAt: new Date(),
            },
          });
        }
      } catch (err) {
        try { await adapter.disconnect(); } catch (e) { request.log.warn(e, 'adapter disconnect error'); }
        throw err;
      }

      // Adapter verification is done; disconnect it (persistent listeners use their own connections)
      try { await adapter.disconnect(); } catch (e) { request.log.warn(e, 'adapter disconnect error'); }

      await cacheInvalidate(cacheKey(organizationId, 'integrations'));

      // Start persistent listener for Telegram
      if (messenger === 'telegram') {
        getTelegramManager().startListening(integration.id).catch((err) => {
          fastify.log.warn({ err }, 'Failed to start Telegram listener after connect');
        });
      }

      return reply.status(201).send({
        integration: sanitizeIntegration(integration),
      });
    },
  );

  // ─── POST /integrations/:messenger/disconnect ───
  // Disconnect a messenger integration.

  fastify.post(
    '/integrations/:messenger/disconnect',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = messengerParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid messenger type', 422);
      }

      const { messenger } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const integration = await prisma.integration.findFirst({
        where: { messenger, organizationId, userId: request.user.id },
      });

      if (!integration) {
        return sendError(
          reply,
          'RESOURCE_NOT_FOUND',
          `No ${messenger} integration found for this user`,
          404,
        );
      }

      // Graceful disconnect is best-effort — don't block on adapter failures
      try {
        const credentials = decryptCredentials(integration.credentials as string);
        const adapter = await createAdapter(messenger, credentials);
        await adapter.disconnect().catch(() => {});
      } catch {
        // Disconnect failures are not critical — we still mark as disconnected
      }

      // Stop persistent listener for Telegram
      if (messenger === 'telegram') {
        getTelegramManager().stopListening(integration.id).catch(() => {});
      }

      const updated = await prisma.integration.update({
        where: { id: integration.id },
        data: { status: 'disconnected' },
      });

      await cacheInvalidate(cacheKey(organizationId, 'integrations'));

      return reply.send({
        integration: sanitizeIntegration(updated),
      });
    },
  );

  // ─── POST /integrations/:messenger/reconnect ───
  // Reconnect using existing stored credentials.

  fastify.post(
    '/integrations/:messenger/reconnect',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = messengerParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid messenger type', 422);
      }

      const { messenger } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const integration = await prisma.integration.findFirst({
        where: { messenger, organizationId, userId: request.user.id },
      });

      if (!integration) {
        return sendError(
          reply,
          'RESOURCE_NOT_FOUND',
          `No ${messenger} integration found for this user`,
          404,
        );
      }

      // Decrypt stored credentials
      let credentials: Record<string, unknown>;
      try {
        credentials = decryptCredentials(integration.credentials as string);
      } catch {
        return sendError(
          reply,
          'INTERNAL_ERROR',
          'Failed to decrypt stored credentials. Please reconnect with new credentials.',
          500,
        );
      }

      // Attempt reconnection
      const adapter = await createAdapter(messenger, credentials);
      try {
        await adapter.connect();
      } catch (err) {
        try { await adapter.disconnect(); } catch (e) { request.log.warn(e, 'adapter disconnect error'); }
        const status = adapter.getStatus();

        // Update status to reflect the failure reason
        await prisma.integration.update({
          where: { id: integration.id },
          data: { status },
        });

        const message =
          err instanceof MessengerError
            ? err.message
            : `Failed to reconnect to ${messenger}`;
        return sendError(reply, 'MESSENGER_API_ERROR', message, 502);
      }

      let updated;
      try {
        updated = await prisma.integration.update({
          where: { id: integration.id },
          data: {
            status: 'connected',
            connectedAt: new Date(),
          },
        });
      } catch (err) {
        try { await adapter.disconnect(); } catch (e) { request.log.warn(e, 'adapter disconnect error'); }
        throw err;
      }

      // Adapter verification is done; disconnect it (persistent listeners use their own connections)
      try { await adapter.disconnect(); } catch (e) { request.log.warn(e, 'adapter disconnect error'); }

      await cacheInvalidate(cacheKey(organizationId, 'integrations'));

      // Start persistent listener for Telegram
      if (messenger === 'telegram') {
        getTelegramManager().startListening(updated.id).catch((err) => {
          fastify.log.warn({ err }, 'Failed to start Telegram listener after reconnect');
        });
      }

      return reply.send({
        integration: sanitizeIntegration(updated),
      });
    },
  );

  // ─── POST /integrations/telegram/send-code ───
  // Step 1 of Telegram auth: send verification code to phone.

  fastify.post(
    '/integrations/telegram/send-code',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bodyParsed = telegramSendCodeSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        const issues = bodyParsed.error.issues;
        return sendError(
          reply,
          'VALIDATION_ERROR',
          issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          422,
        );
      }

      const { apiId, apiHash, phoneNumber } = bodyParsed.data;

      let client;
      try {
        client = createAuthClient(apiId, apiHash);
        await client.connect();
      } catch (err) {
        return sendError(
          reply,
          'MESSENGER_API_ERROR',
          err instanceof Error ? err.message : 'Failed to connect to Telegram servers',
          502,
        );
      }

      try {
        const sendResult = await client.sendCode(
          { apiId, apiHash },
          phoneNumber,
        );

        // Store the client for step 2
        await storePendingAuth(request.user.id, phoneNumber, client, apiId, apiHash);

        return reply.send({
          phoneCodeHash: sendResult.phoneCodeHash,
          phoneNumber,
        });
      } catch (err) {
        await client.disconnect().catch(() => {});
        return sendError(
          reply,
          'MESSENGER_API_ERROR',
          err instanceof Error ? err.message : 'Failed to send verification code',
          502,
        );
      }
    },
  );

  // ─── POST /integrations/telegram/verify-code ───
  // Step 2 of Telegram auth: verify code (and optional 2FA password).

  fastify.post(
    '/integrations/telegram/verify-code',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bodyParsed = telegramVerifyCodeSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        const issues = bodyParsed.error.issues;
        return sendError(
          reply,
          'VALIDATION_ERROR',
          issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          422,
        );
      }

      const { phoneNumber, phoneCodeHash, code, password } = bodyParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const pending = await getPendingAuth(request.user.id, phoneNumber);
      if (!pending) {
        return sendError(
          reply,
          'VALIDATION_ERROR',
          'No pending Telegram auth session found. Please start over by sending a new code.',
          422,
        );
      }

      const { client, apiId, apiHash } = pending;

      try {
        // Try to sign in with the code using low-level API
        try {
          await client.invoke(
            new Api.auth.SignIn({
              phoneNumber,
              phoneCodeHash,
              phoneCode: code,
            }),
          );
        } catch (signInErr: unknown) {
          // Check if 2FA is required
          const errMessage = signInErr instanceof Error ? signInErr.message : String(signInErr);
          if (errMessage.includes('SESSION_PASSWORD_NEEDED')) {
            if (!password) {
              return reply.status(400).send({
                error: {
                  code: 'TELEGRAM_2FA_REQUIRED',
                  message: 'Two-factor authentication password is required',
                  statusCode: 400,
                },
              });
            }
            // Get the SRP password parameters and compute the check
            const srpPassword = await client.invoke(new Api.account.GetPassword());
            const srpResult = await computeCheck(srpPassword, password);
            await client.invoke(new Api.auth.CheckPassword({ password: srpResult }));
          } else {
            throw signInErr;
          }
        }

        // Auth succeeded — extract session string
        const sessionString = (client.session as typeof StringSession.prototype).save();

        // Clean up pending auth
        await removePendingAuth(request.user.id, phoneNumber);

        // Store credentials encrypted in DB
        const credentials = {
          apiId,
          apiHash,
          session: sessionString,
          phoneNumber,
        };
        const encryptedCredentials = encryptCredentials(credentials);

        // Upsert integration
        const existing = await prisma.integration.findUnique({
          where: {
            messenger_organizationId_userId: {
              messenger: 'telegram',
              organizationId,
              userId: request.user.id,
            },
          },
        });

        let integration;
        if (existing) {
          integration = await prisma.integration.update({
            where: { id: existing.id },
            data: {
              credentials: encryptedCredentials,
              status: 'connected',
              connectedAt: new Date(),
            },
          });
        } else {
          integration = await prisma.integration.create({
            data: {
              messenger: 'telegram',
              status: 'connected',
              credentials: encryptedCredentials,
              organizationId,
              userId: request.user.id,
              connectedAt: new Date(),
            },
          });
        }

        // Disconnect the auth client (a new one will be created when needed)
        await client.disconnect().catch(() => {});

        // Start persistent listener for incoming messages
        getTelegramManager().startListening(integration.id).catch((err) => {
          fastify.log.warn({ err }, 'Failed to start Telegram listener after verify-code');
        });

        return reply.status(201).send({
          integration: sanitizeIntegration(integration),
        });
      } catch (err) {
        return sendError(
          reply,
          'MESSENGER_API_ERROR',
          err instanceof Error ? err.message : 'Failed to verify Telegram code',
          502,
        );
      }
    },
  );

  // ─── POST /integrations/telegram/check-session ───
  // Check if the stored Telegram session is still valid.

  fastify.post(
    '/integrations/telegram/check-session',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const integration = await prisma.integration.findFirst({
        where: {
          messenger: 'telegram',
          organizationId,
          userId: request.user.id,
        },
      });

      if (!integration) {
        return reply.send({ valid: false, reason: 'No Telegram integration found' });
      }

      let credentials;
      try {
        credentials = decryptCredentials(integration.credentials as string);
      } catch {
        return reply.send({ valid: false, reason: 'Failed to decrypt credentials' });
      }

      const adapter = new TelegramAdapter(
        credentials as { apiId: number; apiHash: string; session?: string },
      );

      try {
        await adapter.connect();
        await adapter.disconnect();

        // Update status to connected if it was different
        if (integration.status !== 'connected') {
          await prisma.integration.update({
            where: { id: integration.id },
            data: { status: 'connected' },
          });
        }

        return reply.send({ valid: true });
      } catch {
        // Update status
        await prisma.integration.update({
          where: { id: integration.id },
          data: { status: 'session_expired' },
        });

        return reply.send({ valid: false, reason: 'Session is no longer valid' });
      }
    },
  );

  // ─── PATCH /integrations/:messenger/settings ───
  // Update per-integration settings (e.g., Slack channels, notification prefs).

  fastify.patch(
    '/integrations/:messenger/settings',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = messengerParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid messenger type', 422);
      }

      const bodyParsed = updateSettingsSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return sendError(
          reply,
          'VALIDATION_ERROR',
          bodyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          422,
        );
      }

      const { messenger } = paramsParsed.data;
      const { settings } = bodyParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const integration = await prisma.integration.findFirst({
        where: { messenger, organizationId, userId: request.user.id },
      });

      if (!integration) {
        return sendError(
          reply,
          'RESOURCE_NOT_FOUND',
          `No ${messenger} integration found for this user`,
          404,
        );
      }

      const updated = await prisma.integration.update({
        where: { id: integration.id },
        data: { settings: settings as Prisma.InputJsonValue },
      });

      return reply.send({
        integration: sanitizeIntegration(updated),
      });
    },
  );

  // ─── POST /integrations/whatsapp/start-pairing ───
  // Start the WhatsApp QR code pairing flow.
  // QR codes are emitted to the user via WebSocket.

  fastify.post(
    '/integrations/whatsapp/start-pairing',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const userId = request.user.id;
      const sessionKey = `whatsapp:${organizationId}:${userId}`;

      try {
        const emitter = await startWhatsAppPairing(sessionKey);

        const io = getIO();

        // Emit QR codes to the specific user via WebSocket
        emitter.on('qr', (qr: string) => {
          io.to(`user:${userId}`).emit('whatsapp:qr', { qr });
        });

        emitter.on('status', (message: string) => {
          io.to(`user:${userId}`).emit('whatsapp:status', { message });
        });

        emitter.on('connected', async (credentials: { authState?: string; phoneNumber?: string }) => {
          try {
            // Encrypt and store credentials
            const encryptedCredentials = encryptCredentials(credentials as Record<string, unknown>);

            // Upsert integration
            const existing = await prisma.integration.findUnique({
              where: {
                messenger_organizationId_userId: {
                  messenger: 'whatsapp',
                  organizationId,
                  userId,
                },
              },
            });

            let integration;
            if (existing) {
              integration = await prisma.integration.update({
                where: { id: existing.id },
                data: {
                  credentials: encryptedCredentials,
                  status: 'connected',
                  connectedAt: new Date(),
                },
              });
            } else {
              integration = await prisma.integration.create({
                data: {
                  messenger: 'whatsapp',
                  status: 'connected',
                  credentials: encryptedCredentials,
                  organizationId,
                  userId,
                  connectedAt: new Date(),
                },
              });
            }

            io.to(`user:${userId}`).emit('whatsapp:connected', {
              integration: sanitizeIntegration(integration),
            });
          } catch (err) {
            io.to(`user:${userId}`).emit('whatsapp:error', {
              message: err instanceof Error ? err.message : 'Failed to save WhatsApp credentials',
            });
          }
        });

        emitter.on('error', (error: Error) => {
          io.to(`user:${userId}`).emit('whatsapp:error', {
            message: error.message,
          });
        });

        return reply.send({
          message: 'WhatsApp pairing started. Listen for whatsapp:qr events on WebSocket.',
        });
      } catch (err) {
        return sendError(
          reply,
          'MESSENGER_API_ERROR',
          err instanceof Error ? err.message : 'Failed to start WhatsApp pairing',
          502,
        );
      }
    },
  );

  // ─── POST /integrations/whatsapp/cancel-pairing ───
  // Cancel an active WhatsApp pairing session.

  fastify.post(
    '/integrations/whatsapp/cancel-pairing',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const sessionKey = `whatsapp:${organizationId}:${request.user.id}`;
      cancelPairing(sessionKey);

      return reply.send({ message: 'WhatsApp pairing cancelled' });
    },
  );

  // ─── POST /integrations/whatsapp/list-chats ───
  // Fetch available WhatsApp chats (groups + contacts) after pairing.
  // Returns a list of chats via WebSocket event 'whatsapp:chats-available'.

  fastify.post(
    '/integrations/whatsapp/list-chats',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const userId = request.user.id;

      try {
        // Get user's WhatsApp integration
        const integration = await prisma.integration.findUnique({
          where: {
            messenger_organizationId_userId: {
              messenger: 'whatsapp',
              organizationId,
              userId,
            },
          },
        });

        if (!integration) {
          return sendError(
            reply,
            'RESOURCE_NOT_FOUND',
            'No WhatsApp integration found. Please pair via QR code first.',
            404,
          );
        }

        if (integration.status !== 'connected') {
          return sendError(
            reply,
            'VALIDATION_ERROR',
            'WhatsApp integration is not connected',
            400,
          );
        }

        // Decrypt credentials
        const decrypted = decryptCredentials<Record<string, unknown>>(integration.credentials as string);

        // Create adapter and connect
        const adapter = await createAdapter('whatsapp', decrypted);
        try {
          await adapter.connect(decrypted);

          // List available chats
          const chats = await adapter.listChats();
          console.log(`[WhatsApp] Listed ${chats.length} chats for user ${userId}`);

          // Emit chats via WebSocket
          const io = getIO();
          io.to(`user:${userId}`).emit('whatsapp:chats-available', { chats });

          return reply.send({
            message: `Found ${chats.length} available chats. Check WebSocket for whatsapp:chats-available event.`,
          });
        } finally {
          try { await adapter.disconnect(); } catch (e) { fastify.log.warn(e, 'adapter disconnect error'); }
        }
      } catch (err) {
        console.error(`[WhatsApp] Failed to list chats for user ${userId}:`, err);
        return sendError(
          reply,
          'MESSENGER_API_ERROR',
          err instanceof MessengerError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to list WhatsApp chats',
          502,
        );
      }
    },
  );
}
