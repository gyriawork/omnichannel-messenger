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
import { messageSyncQueue } from '../lib/queue.js';
import { getTelegramManager } from '../services/telegram-connection-manager.js';
import { Api } from 'telegram';
import bigInt from 'big-integer';

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

  // ─── POST /admin/gmail/rehydrate ───
  // One-shot backfill: re-fetches Gmail threads with format:'full' and UPDATEs
  // existing Message rows with new email fields (htmlBody, subject, fromEmail,
  // toEmails, etc). For already-imported Gmail chats that were synced before
  // the rich-rendering update.
  //
  // Body: { organizationId: string, chatIds?: string[] }
  //   If chatIds omitted → rehydrates ALL Gmail chats in the org.
  //
  // Dispatches sync:gmail-rehydrate jobs (batched per-integration).

  fastify.post(
    '/admin/gmail/rehydrate',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const bodySchema = z.object({
        organizationId: z.string().min(1),
        chatIds: z.array(z.string()).optional(),
      });

      const parsed = bodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.errors.map((e) => e.message).join(', '), 422);
      }

      const { organizationId, chatIds } = parsed.data;

      // Find the Gmail integration for this organization. Chats don't carry
      // integrationId directly — it's resolved via (messenger, organizationId).
      const integration = await prisma.integration.findFirst({
        where: { organizationId, messenger: 'gmail', status: 'connected' },
        select: { id: true },
      });

      if (!integration) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'No connected Gmail integration for this organization', 404);
      }

      // Load Gmail chats in the org (optionally filtered by ids)
      const chats = await prisma.chat.findMany({
        where: {
          organizationId,
          messenger: 'gmail',
          ...(chatIds && chatIds.length > 0 ? { id: { in: chatIds } } : {}),
        },
        select: { id: true },
      });

      if (chats.length === 0) {
        return reply.send({ enqueued: 0, jobs: 0, message: 'No Gmail chats found' });
      }

      let totalJobs = 0;
      let totalChats = 0;

      // Chunk into batches of 20 to keep individual jobs short
      const BATCH_SIZE = 20;
      const allIds = chats.map((c) => c.id);
      for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
        const batch = allIds.slice(i, i + BATCH_SIZE);
        await messageSyncQueue.add(
          'sync:gmail-rehydrate',
          {
            chatIds: batch,
            integrationId: integration.id,
            organizationId,
          },
          { removeOnComplete: true },
        );
        totalJobs++;
        totalChats += batch.length;
      }

      await logActivity({
        category: 'settings',
        action: 'gmail_rehydrate_triggered',
        description: `Gmail rehydrate triggered for ${totalChats} chats (${totalJobs} jobs)`,
        targetType: 'Organization',
        targetId: organizationId,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
        metadata: { chatCount: totalChats, jobCount: totalJobs },
      });

      return reply.send({
        enqueued: totalChats,
        jobs: totalJobs,
      });
    },
  );

  // ─── Backfill Sender Names ───
  // Resolves "Unknown" and "User XXXXXX" sender names for Telegram messages
  // using the active connection manager client.
  fastify.post(
    '/admin/backfill-sender-names',
    { preHandler: [authenticate, requireRole('superadmin')] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Find all Telegram messages with unresolved sender names
      const badMessages = await prisma.message.findMany({
        where: {
          chat: { messenger: 'telegram' },
          isSelf: false,
          senderExternalId: { not: null },
          OR: [
            { senderName: 'Unknown' },
            { senderName: { startsWith: 'User ' } },
          ],
        },
        select: {
          id: true,
          senderExternalId: true,
          chatId: true,
          chat: {
            select: { organizationId: true },
          },
        },
      });

      if (badMessages.length === 0) {
        return reply.send({ updated: 0, resolved: 0, message: 'No messages to backfill' });
      }

      // Group unique senderExternalIds
      const uniqueSenders = new Map<string, { orgId: string; messageIds: string[] }>();
      for (const msg of badMessages) {
        const sid = msg.senderExternalId!;
        const existing = uniqueSenders.get(sid);
        if (existing) {
          existing.messageIds.push(msg.id);
        } else {
          uniqueSenders.set(sid, { orgId: msg.chat.organizationId, messageIds: [msg.id] });
        }
      }

      // Find active Telegram integrations by org
      const orgIds = [...new Set([...uniqueSenders.values()].map((v) => v.orgId))];
      const integrations = await prisma.integration.findMany({
        where: {
          messenger: 'telegram',
          status: 'connected',
          organizationId: { in: orgIds },
        },
        select: { id: true, organizationId: true },
      });

      const orgToIntegration = new Map<string, string>();
      for (const integ of integrations) {
        orgToIntegration.set(integ.organizationId, integ.id);
      }

      const manager = getTelegramManager();
      let resolved = 0;
      let updated = 0;

      for (const [senderId, data] of uniqueSenders) {
        const integrationId = orgToIntegration.get(data.orgId);
        if (!integrationId) continue;

        const client = manager.getClient(integrationId);
        if (!client) continue;

        try {
          const numId = bigInt(senderId);
          const entity = await Promise.race([
            client.getEntity(numId),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 15000)),
          ]);

          let name: string | null = null;
          if (entity instanceof Api.User) {
            name = [entity.firstName, entity.lastName].filter(Boolean).join(' ') || null;
          } else if (entity && 'title' in (entity as unknown as Record<string, unknown>)) {
            name = (entity as unknown as { title: string }).title || null;
          }

          if (name) {
            resolved++;
            const result = await prisma.message.updateMany({
              where: { id: { in: data.messageIds } },
              data: { senderName: name },
            });
            updated += result.count;

            // Also update chat name if it matches the bad pattern
            await prisma.chat.updateMany({
              where: {
                messenger: 'telegram',
                organizationId: data.orgId,
                name: { in: ['Unknown', `User ${senderId.slice(-6)}`] },
              },
              data: { name },
            });
          }
        } catch {
          // Skip this sender, continue with others
        }
      }

      return reply.send({
        totalBadMessages: badMessages.length,
        uniqueSenders: uniqueSenders.size,
        resolved,
        updated,
      });
    },
  );
}
