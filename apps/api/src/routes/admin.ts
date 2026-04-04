// ─── Admin Routes — Platform Config ───
// Superadmin-only endpoints for managing global platform credentials.

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { encryptCredentials } from '../lib/crypto.js';
import { getPlatformCredentials, invalidatePlatformCache } from '../lib/platform-credentials.js';
import { logActivity } from '../lib/activity-logger.js';
import { MESSENGERS, MESSENGER_PLATFORM_FIELDS, MESSENGER_ENV_VARS } from '../lib/platform-constants.js';
import type { Messenger } from '../lib/platform-constants.js';

// ─── Schemas ───

const messengerParamSchema = z.object({
  messenger: z.enum(['telegram', 'slack', 'gmail', 'whatsapp']),
});

const telegramCredsSchema = z.object({
  apiId: z.coerce.number().int().positive(),
  apiHash: z.string().min(1),
});

const oauthCredsSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

const credentialSchemas: Record<string, z.ZodType> = {
  telegram: telegramCredsSchema,
  slack: oauthCredsSchema,
  gmail: oauthCredsSchema,
};

// ─── Helpers ───

function sendError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.status(statusCode).send({
    error: { code, message, statusCode },
  });
}

/** Extract a hint (last 4 chars) from the first secret field of a messenger's credentials. */
function getCredentialHint(messenger: Messenger, creds: Record<string, string>): string | undefined {
  const fields = MESSENGER_PLATFORM_FIELDS[messenger];
  const secretField = fields.find((f) => f.type === 'password') ?? fields[0];
  if (!secretField) return undefined;
  const val = creds[secretField.key];
  if (!val || val.length < 4) return val;
  return `...${val.slice(-4)}`;
}

// ─── Plugin ───

export default async function adminRoutes(fastify: FastifyInstance) {
  const authPreHandlers = [authenticate, requireRole('superadmin')];

  // ─── GET /admin/platform-config ───
  // Returns status for all messengers (never raw credentials).

  fastify.get(
    '/admin/platform-config',
    { preHandler: authPreHandlers },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const results = await Promise.all(
        MESSENGERS.map(async (messenger) => {
          const result = await getPlatformCredentials(messenger);

          let hint: string | undefined;
          if (result.credentials && result.source === 'database') {
            hint = getCredentialHint(messenger, result.credentials);
          } else if (result.credentials && result.source === 'env') {
            hint = getCredentialHint(messenger, result.credentials);
          }

          // Check enabled flag for DB entries
          let enabled = true;
          if (result.source === 'database') {
            const config = await prisma.platformConfig.findUnique({ where: { messenger } });
            enabled = config?.enabled ?? true;
          }

          return {
            messenger,
            configured: result.source === 'none_required' || result.credentials !== null,
            source: result.source,
            enabled: result.source === 'none_required' ? true : enabled,
            hint,
          };
        }),
      );

      return reply.send(results);
    },
  );

  // ─── PUT /admin/platform-config/:messenger ───
  // Create or update platform credentials for a messenger.

  fastify.put(
    '/admin/platform-config/:messenger',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = messengerParamSchema.safeParse(request.params);
      if (!params.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid messenger', 400);
      }

      const { messenger } = params.data;

      if (messenger === 'whatsapp') {
        return sendError(reply, 'VALIDATION_ERROR', 'WhatsApp does not require platform credentials', 400);
      }

      const schema = credentialSchemas[messenger];
      if (!schema) {
        return sendError(reply, 'VALIDATION_ERROR', `No credential schema for ${messenger}`, 400);
      }

      const body = schema.safeParse(request.body);
      if (!body.success) {
        return sendError(reply, 'VALIDATION_ERROR', body.error.errors.map((e) => e.message).join(', '), 422);
      }

      // Convert apiId to string for consistent storage
      const creds: Record<string, string> = {};
      for (const [key, val] of Object.entries(body.data as Record<string, unknown>)) {
        creds[key] = String(val);
      }

      const encrypted = encryptCredentials(creds);

      await prisma.platformConfig.upsert({
        where: { messenger },
        create: {
          messenger,
          credentials: encrypted,
          enabled: true,
          updatedBy: request.user.id,
        },
        update: {
          credentials: encrypted,
          enabled: true,
          updatedBy: request.user.id,
        },
      });

      invalidatePlatformCache(messenger);

      // Log activity
      await logActivity({
        category: 'settings',
        action: 'platform_config_updated',
        description: `Platform credentials updated for ${messenger}`,
        targetType: 'PlatformConfig',
        targetId: messenger,
        userId: request.user.id,
        userName: request.user.name,
        organizationId: request.user.organizationId ?? 'global',
        metadata: { messenger, source: 'database' },
      });

      return reply.send({
        messenger,
        configured: true,
        source: 'database',
        enabled: true,
        hint: getCredentialHint(messenger as Messenger, creds),
      });
    },
  );

  // ─── DELETE /admin/platform-config/:messenger ───
  // Remove DB credentials. Falls back to env vars if present.

  fastify.delete(
    '/admin/platform-config/:messenger',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = messengerParamSchema.safeParse(request.params);
      if (!params.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid messenger', 400);
      }

      const { messenger } = params.data;

      // Check if env fallback exists
      const envMap = MESSENGER_ENV_VARS[messenger];
      const hasEnvFallback =
        Object.keys(envMap).length > 0 &&
        Object.values(envMap).every((envVar) => !!process.env[envVar]);

      if (!hasEnvFallback) {
        const query = request.query as Record<string, string>;
        if (query.confirm !== 'true') {
          return reply.status(400).send({
            error: {
              code: 'CONFIRMATION_REQUIRED',
              message: `No environment variable fallback for ${messenger}. This will make it unavailable for users. Add ?confirm=true to proceed.`,
              statusCode: 400,
            },
            fallback: null,
          });
        }
      }

      await prisma.platformConfig.deleteMany({ where: { messenger } });
      invalidatePlatformCache(messenger);

      await logActivity({
        category: 'settings',
        action: 'platform_config_deleted',
        description: `Platform credentials removed for ${messenger}`,
        targetType: 'PlatformConfig',
        targetId: messenger,
        userId: request.user.id,
        userName: request.user.name,
        organizationId: request.user.organizationId ?? 'global',
        metadata: { messenger },
      });

      return reply.send({
        messenger,
        configured: hasEnvFallback,
        fallback: hasEnvFallback ? 'env' : null,
      });
    },
  );
}
