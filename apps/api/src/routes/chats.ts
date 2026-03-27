import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { requireMinRole } from '../middleware/rbac.js';
import { decryptCredentials } from '../lib/crypto.js';
import { createAdapter } from '../integrations/factory.js';
import { MessengerError } from '../integrations/base.js';
import { messageSyncQueue } from '../lib/queue.js';

// ─── Zod Schemas ───

const messengerEnum = z.enum(['telegram', 'slack', 'whatsapp', 'gmail']);

const listChatsQuerySchema = z.object({
  messenger: messengerEnum.optional(),
  status: z.enum(['active', 'read-only']).optional(),
  ownerId: z.string().uuid().optional(),
  search: z.string().min(1).max(200).optional(),
  tagId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const chatIdParamSchema = z.object({
  id: z.string().uuid(),
});

const messengerParamSchema = z.object({
  messenger: messengerEnum,
});

const updateChatBodySchema = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'read-only']).optional(),
  tags: z.array(z.string().uuid()).optional(),
});

const importChatsBodySchema = z.object({
  messenger: messengerEnum,
  chats: z.array(
    z.object({
      externalChatId: z.string().min(1).max(500),
      name: z.string().min(1).max(500),
      chatType: z.enum(['direct', 'group', 'channel']).default('direct'),
    }),
  ).min(1).max(500),
});

const bulkAssignBodySchema = z.object({
  chatIds: z.array(z.string().uuid()).min(1).max(500),
  ownerId: z.string().uuid(),
});

const bulkTagBodySchema = z.object({
  chatIds: z.array(z.string().uuid()).min(1).max(500),
  tagId: z.string().uuid(),
  action: z.enum(['add', 'remove']),
});

const bulkDeleteBodySchema = z.object({
  chatIds: z.array(z.string().uuid()).min(1).max(500),
});

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

// ─── Plugin ───

export default async function chatRoutes(fastify: FastifyInstance): Promise<void> {
  const authPreHandlers = [authenticate];
  const adminPreHandlers = [authenticate, requireMinRole('admin')];

  // ─── GET /chats ───

  fastify.get(
    '/chats',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listChatsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '), 422);
      }

      const { messenger, status, ownerId, search, tagId, page, limit } = parsed.data;

      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const where: Record<string, unknown> = { organizationId };

      if (messenger) where.messenger = messenger;
      if (status) where.status = status;
      if (ownerId) where.ownerId = ownerId;
      if (search) {
        where.name = { contains: search, mode: 'insensitive' };
      }
      if (tagId) {
        where.tags = { some: { tagId } };
      }

      const [chats, total] = await Promise.all([
        prisma.chat.findMany({
          where,
          include: {
            tags: {
              include: { tag: true },
            },
            owner: {
              select: { id: true, name: true, email: true },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: { id: true, text: true, senderName: true, createdAt: true },
            },
            preferences: {
              where: { userId: request.user.id },
              take: 1,
            },
          },
          orderBy: { lastActivityAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.chat.count({ where }),
      ]);

      const result = chats.map((chat) => ({
        id: chat.id,
        name: chat.name,
        messenger: chat.messenger,
        externalChatId: chat.externalChatId,
        chatType: chat.chatType,
        status: chat.status,
        organizationId: chat.organizationId,
        ownerId: chat.ownerId,
        owner: chat.owner
          ? { id: chat.owner.id, name: chat.owner.name, email: chat.owner.email }
          : null,
        importedById: chat.importedById,
        messageCount: chat.messageCount,
        lastActivityAt: chat.lastActivityAt,
        tags: chat.tags.map((ct) => ({
          id: ct.tag.id,
          name: ct.tag.name,
          color: ct.tag.color,
        })),
        lastMessage: chat.messages[0] ?? null,
        preferences: chat.preferences[0]
          ? {
              pinned: chat.preferences[0].pinned,
              favorite: chat.preferences[0].favorite,
              muted: chat.preferences[0].muted,
              unread: chat.preferences[0].unread,
            }
          : { pinned: false, favorite: false, muted: false, unread: false },
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      }));

      return reply.send({ chats: result, total, page, limit });
    },
  );

  // ─── GET /chats/available/:messenger ───
  // Must be registered before /chats/:id to avoid route collision

  fastify.get(
    '/chats/available/:messenger',
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

      // Look up active integration for this messenger + org
      const integration = await prisma.integration.findFirst({
        where: {
          messenger,
          organizationId,
          status: 'connected',
        },
      });

      if (integration) {
        // Try to list chats via the adapter
        try {
          const credentials = decryptCredentials(integration.credentials as string);
          const adapter = await createAdapter(messenger, credentials);
          await adapter.connect();
          const rawChats = await adapter.listChats();
          const chats = rawChats.map((c: Record<string, unknown>) => ({
            externalId: c.externalChatId ?? c.externalId,
            name: c.name,
            chatType: c.chatType ?? 'direct',
            memberCount: c.memberCount,
          }));
          return reply.send({ chats });
        } catch (err) {
          // If adapter fails, log and fall through to mock data
          fastify.log.warn(
            { messenger, error: err instanceof MessengerError ? err.message : String(err) },
            'Adapter listChats failed, falling back to mock data',
          );
        }
      }

      // Fallback: mock data when no integration is connected or adapter fails
      const mockChats: Record<string, Array<{ externalChatId: string; name: string; chatType: string }>> = {
        telegram: [
          { externalChatId: 'tg_001', name: 'Telegram Support Group', chatType: 'group' },
          { externalChatId: 'tg_002', name: 'John Doe', chatType: 'direct' },
          { externalChatId: 'tg_003', name: 'Announcements Channel', chatType: 'channel' },
        ],
        slack: [
          { externalChatId: 'sl_001', name: '#general', chatType: 'channel' },
          { externalChatId: 'sl_002', name: '#support', chatType: 'channel' },
          { externalChatId: 'sl_003', name: 'Jane Smith', chatType: 'direct' },
        ],
        whatsapp: [
          { externalChatId: 'wa_001', name: 'Family Group', chatType: 'group' },
          { externalChatId: 'wa_002', name: '+1 555-0100', chatType: 'direct' },
        ],
        gmail: [
          { externalChatId: 'gm_001', name: 'support@example.com', chatType: 'direct' },
          { externalChatId: 'gm_002', name: 'team@example.com', chatType: 'direct' },
        ],
      };

      return reply.send({ chats: mockChats[messenger] ?? [] });
    },
  );

  // ─── GET /chats/:id ───

  fastify.get(
    '/chats/:id',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = chatIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid chat id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const chat = await prisma.chat.findFirst({
        where: { id, organizationId },
        include: {
          tags: {
            include: { tag: true },
          },
          owner: {
            select: { id: true, name: true, email: true },
          },
          participants: {
            select: { id: true, externalUserId: true, displayName: true, role: true },
          },
          preferences: {
            where: { userId: request.user.id },
            take: 1,
          },
        },
      });

      if (!chat) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Chat with id ${id} not found`, 404);
      }

      return reply.send({
        id: chat.id,
        name: chat.name,
        messenger: chat.messenger,
        externalChatId: chat.externalChatId,
        chatType: chat.chatType,
        status: chat.status,
        organizationId: chat.organizationId,
        ownerId: chat.ownerId,
        owner: chat.owner
          ? { id: chat.owner.id, name: chat.owner.name, email: chat.owner.email }
          : null,
        importedById: chat.importedById,
        messageCount: chat.messageCount,
        lastActivityAt: chat.lastActivityAt,
        tags: chat.tags.map((ct) => ({
          id: ct.tag.id,
          name: ct.tag.name,
          color: ct.tag.color,
        })),
        participants: chat.participants,
        preferences: chat.preferences[0]
          ? {
              pinned: chat.preferences[0].pinned,
              favorite: chat.preferences[0].favorite,
              muted: chat.preferences[0].muted,
              unread: chat.preferences[0].unread,
            }
          : { pinned: false, favorite: false, muted: false, unread: false },
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
      });
    },
  );

  // ─── PATCH /chats/:id ───

  fastify.patch(
    '/chats/:id',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = chatIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid chat id', 422);
      }

      const bodyParsed = updateChatBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', bodyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { id } = paramsParsed.data;
      const { ownerId, status, tags } = bodyParsed.data;

      if (ownerId === undefined && status === undefined && tags === undefined) {
        return sendError(reply, 'VALIDATION_ERROR', 'At least one field must be provided for update', 422);
      }

      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.chat.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Chat with id ${id} not found`, 404);
      }

      // If ownerId is provided, validate it belongs to the same org
      if (ownerId !== undefined && ownerId !== null) {
        const ownerUser = await prisma.user.findFirst({
          where: { id: ownerId, organizationId },
        });
        if (!ownerUser) {
          return sendError(reply, 'VALIDATION_ERROR', `User with id ${ownerId} not found in organization`, 422);
        }
      }

      // If tags are provided, validate they belong to the same org
      if (tags !== undefined && tags.length > 0) {
        const existingTags = await prisma.tag.findMany({
          where: { id: { in: tags }, organizationId },
        });
        if (existingTags.length !== tags.length) {
          return sendError(reply, 'VALIDATION_ERROR', 'One or more tag IDs are invalid or do not belong to this organization', 422);
        }
      }

      const updated = await prisma.$transaction(async (tx) => {
        // Update chat fields
        const updateData: Record<string, unknown> = {};
        if (ownerId !== undefined) updateData.ownerId = ownerId;
        if (status !== undefined) updateData.status = status;

        const chat = await tx.chat.update({
          where: { id },
          data: updateData,
        });

        // Replace tags if provided
        if (tags !== undefined) {
          await tx.chatTag.deleteMany({ where: { chatId: id } });

          if (tags.length > 0) {
            await tx.chatTag.createMany({
              data: tags.map((tagId) => ({ chatId: id, tagId })),
            });
          }
        }

        return chat;
      });

      // Fetch full updated chat with relations
      const fullChat = await prisma.chat.findFirst({
        where: { id },
        include: {
          tags: { include: { tag: true } },
          owner: { select: { id: true, name: true, email: true } },
        },
      });

      return reply.send({
        id: updated.id,
        name: updated.name,
        messenger: updated.messenger,
        externalChatId: updated.externalChatId,
        chatType: updated.chatType,
        status: updated.status,
        organizationId: updated.organizationId,
        ownerId: updated.ownerId,
        owner: fullChat?.owner ?? null,
        importedById: updated.importedById,
        messageCount: updated.messageCount,
        lastActivityAt: updated.lastActivityAt,
        tags: fullChat?.tags.map((ct) => ({
          id: ct.tag.id,
          name: ct.tag.name,
          color: ct.tag.color,
        })) ?? [],
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      });
    },
  );

  // ─── DELETE /chats/:id ───

  fastify.delete(
    '/chats/:id',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = chatIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid chat id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.chat.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Chat with id ${id} not found`, 404);
      }

      // Cascade deletes are handled by Prisma schema (onDelete: Cascade) for:
      // messages, tags (ChatTag), preferences, participants, broadcastChats
      await prisma.chat.delete({ where: { id } });

      return reply.status(204).send();
    },
  );

  // ─── POST /chats/import ───

  fastify.post(
    '/chats/import',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = importChatsBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { messenger, chats: chatsToImport } = parsed.data;

      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      // Find existing chats to skip duplicates
      const externalIds = chatsToImport.map((c) => c.externalChatId);
      const existingChats = await prisma.chat.findMany({
        where: {
          organizationId,
          messenger,
          externalChatId: { in: externalIds },
        },
        select: { externalChatId: true },
      });

      const existingSet = new Set(existingChats.map((c) => c.externalChatId));
      const newChats = chatsToImport.filter((c) => !existingSet.has(c.externalChatId));

      let imported: Awaited<ReturnType<typeof prisma.chat.findMany>> = [];

      if (newChats.length > 0) {
        await prisma.chat.createMany({
          data: newChats.map((c) => ({
            name: c.name,
            messenger,
            externalChatId: c.externalChatId,
            chatType: c.chatType,
            organizationId,
            importedById: request.user.id,
          })),
        });

        // Fetch the newly created chats
        imported = await prisma.chat.findMany({
          where: {
            organizationId,
            messenger,
            externalChatId: { in: newChats.map((c) => c.externalChatId) },
          },
        });
      }

      // Queue background history sync for imported chats
      if (imported.length > 0) {
        const integration = await prisma.integration.findFirst({
          where: { messenger, organizationId, status: 'connected' },
          select: { id: true },
        });

        if (integration) {
          messageSyncQueue.add('sync:chat-history', {
            chatIds: imported.map((c) => c.id),
            integrationId: integration.id,
            organizationId,
            messenger,
          }).catch((err) => {
            fastify.log.warn({ err }, 'Failed to queue chat history sync');
          });
        }
      }

      return reply.status(201).send({
        imported: newChats.length,
        skipped: chatsToImport.length - newChats.length,
        chats: imported,
      });
    },
  );

  // ─── POST /chats/bulk/assign ───

  fastify.post(
    '/chats/bulk/assign',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = bulkAssignBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { chatIds, ownerId } = parsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      // Validate owner belongs to org
      const ownerUser = await prisma.user.findFirst({
        where: { id: ownerId, organizationId },
      });
      if (!ownerUser) {
        return sendError(reply, 'VALIDATION_ERROR', `User with id ${ownerId} not found in organization`, 422);
      }

      const result = await prisma.chat.updateMany({
        where: {
          id: { in: chatIds },
          organizationId,
        },
        data: { ownerId },
      });

      return reply.send({ updated: result.count });
    },
  );

  // ─── POST /chats/bulk/tag ───

  fastify.post(
    '/chats/bulk/tag',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = bulkTagBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { chatIds, tagId, action } = parsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      // Validate tag belongs to org
      const tag = await prisma.tag.findFirst({
        where: { id: tagId, organizationId },
      });
      if (!tag) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Tag with id ${tagId} not found`, 404);
      }

      // Validate all chats belong to org
      const validChats = await prisma.chat.findMany({
        where: { id: { in: chatIds }, organizationId },
        select: { id: true },
      });
      const validChatIds = validChats.map((c) => c.id);

      if (action === 'add') {
        // Use skipDuplicates to handle already-tagged chats
        await prisma.chatTag.createMany({
          data: validChatIds.map((chatId) => ({ chatId, tagId })),
          skipDuplicates: true,
        });
      } else {
        await prisma.chatTag.deleteMany({
          where: {
            chatId: { in: validChatIds },
            tagId,
          },
        });
      }

      return reply.send({ updated: validChatIds.length });
    },
  );

  // ─── DELETE /chats/bulk ───

  fastify.delete(
    '/chats/bulk',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = bulkDeleteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { chatIds } = parsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const result = await prisma.chat.deleteMany({
        where: {
          id: { in: chatIds },
          organizationId,
        },
      });

      return reply.send({ deleted: result.count });
    },
  );
}
