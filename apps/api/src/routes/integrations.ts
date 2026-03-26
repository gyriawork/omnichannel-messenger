import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { encryptCredentials, decryptCredentials } from '../lib/crypto.js';
import { authenticate } from '../middleware/auth.js';
import { createAdapter } from '../integrations/factory.js';
import { MessengerError } from '../integrations/base.js';

// ─── Zod Schemas ───

const messengerParamSchema = z.object({
  messenger: z.enum(['telegram', 'slack', 'whatsapp', 'gmail']),
});

const connectTelegramSchema = z.object({
  apiId: z.number().int().positive(),
  apiHash: z.string().min(1),
  session: z.string().optional(),
  phoneNumber: z.string().optional(),
});

const connectSlackSchema = z.object({
  token: z.string().min(1),
});

const connectWhatsAppSchema = z.object({
  session: z.string().optional(),
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

      const integrations = await prisma.integration.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });

      return reply.send({
        integrations: integrations.map(sanitizeIntegration),
      });
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
      const adapter = createAdapter(messenger, credentials);
      try {
        await adapter.connect();
      } catch (err) {
        const message =
          err instanceof MessengerError
            ? err.message
            : `Failed to connect to ${messenger}`;
        return sendError(reply, 'MESSENGER_API_ERROR', message, 502);
      }

      // Encrypt credentials before storing
      const encryptedCredentials = encryptCredentials(credentials);

      let integration;

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

      // Attempt graceful disconnect via adapter
      try {
        const credentials = decryptCredentials(integration.credentials as string);
        const adapter = createAdapter(messenger, credentials);
        await adapter.connect();
        await adapter.disconnect();
      } catch {
        // Disconnect failures are not critical — we still mark as disconnected
      }

      const updated = await prisma.integration.update({
        where: { id: integration.id },
        data: { status: 'disconnected' },
      });

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
      const adapter = createAdapter(messenger, credentials);
      try {
        await adapter.connect();
      } catch (err) {
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

      const updated = await prisma.integration.update({
        where: { id: integration.id },
        data: {
          status: 'connected',
          connectedAt: new Date(),
        },
      });

      return reply.send({
        integration: sanitizeIntegration(updated),
      });
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
}
