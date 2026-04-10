import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { requireMinRole } from '../middleware/rbac.js';
import { messageSyncQueue } from '../lib/queue.js';
import { cacheGet, cacheSet, cacheInvalidate, cacheKey } from '../lib/cache.js';

// ─── Zod Schemas ───

const messengerEnum = z.enum(['telegram', 'slack', 'whatsapp', 'gmail']);

const listChatsQuerySchema = z.object({
  messenger: messengerEnum.optional(),
  status: z.enum(['active', 'read-only']).optional(),
  ownerId: z.string().uuid().optional(),
  search: z.string().min(1).max(200).optional(),
  tagId: z.string().uuid().optional(),
  scope: z.enum(['org', 'my']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const chatIdParamSchema = z.object({
  id: z.string().uuid(),
});

const updateChatBodySchema = z.object({
  ownerId: z.string().uuid().nullable().optional(),
  status: z.enum(['active', 'read-only']).optional(),
  tags: z.array(z.string().uuid()).optional(),
  externalChatId: z.string().min(1).optional(),
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

      const { messenger, status, ownerId, search, tagId, scope, page, limit } = parsed.data;

      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const queryHash = createHash('md5')
        .update(JSON.stringify({ messenger, status, ownerId, search, tagId, page, limit, userId: request.user.id }))
        .digest('hex')
        .slice(0, 12);

      const ck = cacheKey(organizationId, 'chats', queryHash);
      const cached = await cacheGet<{ chats: unknown[]; total: number; page: number; limit: number }>(ck);
      if (cached) {
        return reply.send(cached);
      }

      const where: Record<string, unknown> = { organizationId, deletedAt: null };

      // User role: only see own imported chats; Admin with scope=my: also only own
      if (request.user.role === 'user' || scope === 'my') {
        where.importedById = request.user.id;
      }

      if (messenger) where.messenger = messenger;
      if (status) where.status = status;
      if (ownerId) where.ownerId = ownerId;
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { messages: { some: { text: { contains: search, mode: 'insensitive' } } } },
          // Match Gmail sender domain so /messenger?search=google.com works.
          { messages: { some: { fromEmail: { contains: search, mode: 'insensitive' } } } },
        ];
      }
      if (tagId) {
        where.tags = { some: { tagId } };
      }

      const [chats, total] = await Promise.all([
        prisma.chat.findMany({
          where,
          include: {
            tags: {
              select: { tag: { select: { id: true, name: true, color: true } } },
            },
            owner: {
              select: { id: true, name: true },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: { id: true, text: true, senderName: true, createdAt: true, fromEmail: true },
            },
            preferences: {
              where: { userId: request.user.id },
              take: 1,
              select: { pinned: true, favorite: true, muted: true, unread: true },
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
          ? { id: chat.owner.id, name: chat.owner.name }
          : null,
        importedById: chat.importedById,
        messageCount: chat.messageCount,
        lastActivityAt: chat.lastActivityAt,
        syncStatus: chat.syncStatus,
        hasFullHistory: chat.hasFullHistory,
        tags: chat.tags.map((ct) => ({
          id: ct.tag.id,
          name: ct.tag.name,
          color: ct.tag.color,
        })),
        // Pass-through includes fromEmail (selected above) — required by /chats Gmail grouping.
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

      const response = { chats: result, total, page, limit };
      await cacheSet(ck, response, 60);
      return reply.send(response);
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
        where: { id, organizationId, deletedAt: null },
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
        syncStatus: chat.syncStatus,
        hasFullHistory: chat.hasFullHistory,
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
      const { ownerId, status, tags, externalChatId } = bodyParsed.data;

      if (ownerId === undefined && status === undefined && tags === undefined && externalChatId === undefined) {
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
        if (externalChatId !== undefined) updateData.externalChatId = externalChatId;

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

      await cacheInvalidate(cacheKey(organizationId, 'chats', '*'));

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

      const existing = await prisma.chat.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Chat with id ${id} not found`, 404);
      }

      // Hard delete: remove messages, tags, preferences, then the chat itself
      await prisma.message.deleteMany({ where: { chatId: id } });
      await prisma.chatTag.deleteMany({ where: { chatId: id } });
      await prisma.chatPreference.deleteMany({ where: { chatId: id } });
      await prisma.chatParticipant.deleteMany({ where: { chatId: id } });
      await prisma.chat.delete({ where: { id } });

      await cacheInvalidate(cacheKey(organizationId, 'chats', '*'));

      return reply.status(204).send();
    },
  );

  // ─── POST /chats/import ───
  // Import selected chats from a connected messenger.

  const importBodySchema = z.object({
    messenger: z.enum(['telegram', 'slack', 'whatsapp', 'gmail']),
    externalChatIds: z.array(z.string()).min(1).max(500),
  });

  fastify.post(
    '/chats/import',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = importBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { messenger, externalChatIds } = parsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const imported: Array<{ id: string; name: string; externalChatId: string }> = [];

      for (const externalChatId of externalChatIds) {
        // Skip if already imported
        const existing = await prisma.chat.findFirst({
          where: { externalChatId, organizationId, messenger, deletedAt: null },
        });
        if (existing) {
          imported.push({ id: existing.id, name: existing.name, externalChatId });
          continue;
        }

        const chat = await prisma.chat.create({
          data: {
            name: externalChatId, // Will be updated by sync worker
            messenger,
            externalChatId,
            chatType: 'direct',
            organizationId,
            importedById: request.user.id,
            ownerId: request.user.id,
          },
        });
        imported.push({ id: chat.id, name: chat.name, externalChatId });
      }

      await cacheInvalidate(cacheKey(organizationId, 'chats', '*'));

      return reply.send({ imported, count: imported.length });
    },
  );

  // ─── POST /chats/:id/load-full-history ───
  // Queues a background job to pull the full message history for a single chat.
  // Used by the "Load full history" button in the chat header (lazy-history model).

  fastify.post(
    '/chats/:id/load-full-history',
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
        where: { id, organizationId, deletedAt: null },
        select: { id: true, messenger: true, syncStatus: true, hasFullHistory: true },
      });

      if (!chat) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Chat with id ${id} not found`, 404);
      }

      if (chat.hasFullHistory) {
        return reply.send({ queued: false, reason: 'already_fetched' });
      }

      if (chat.syncStatus === 'syncing') {
        return reply.send({ queued: false, reason: 'already_syncing' });
      }

      const integration = await prisma.integration.findFirst({
        where: { messenger: chat.messenger, organizationId, status: 'connected' },
        select: { id: true },
      });

      if (!integration) {
        return sendError(
          reply,
          'MESSENGER_API_ERROR',
          `No connected ${chat.messenger} integration found`,
          502,
        );
      }

      // Mark the chat as pending so the existing sync-history processor picks it up.
      await prisma.chat.update({
        where: { id },
        data: { syncStatus: 'pending' },
      });

      await messageSyncQueue.add(
        'sync:chat-history',
        {
          chatIds: [id],
          integrationId: integration.id,
          organizationId,
          messenger: chat.messenger,
        },
        { jobId: `load-full-history-${id}-${Date.now()}` },
      );

      return reply.send({ queued: true });
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

      await cacheInvalidate(cacheKey(organizationId, 'chats', '*'));

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

      await cacheInvalidate(cacheKey(organizationId, 'chats', '*'));

      return reply.send({ updated: validChatIds.length });
    },
  );

  // ─── PATCH /chats/:id/read ───

  fastify.patch(
    '/chats/:id/read',
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

      const existing = await prisma.chat.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Chat with id ${id} not found`, 404);
      }

      await prisma.chatPreference.upsert({
        where: { userId_chatId: { chatId: id, userId: request.user.id } },
        create: { chatId: id, userId: request.user.id, unread: false },
        update: { unread: false },
      });

      return reply.send({ success: true });
    },
  );

  // ─── DELETE /chats/bulk ───

  fastify.delete(
    '/chats/bulk',
    { preHandler: authPreHandlers },
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

      // Hard delete: remove related data, then chats
      await prisma.message.deleteMany({ where: { chatId: { in: chatIds } } });
      await prisma.chatTag.deleteMany({ where: { chatId: { in: chatIds } } });
      await prisma.chatPreference.deleteMany({ where: { chatId: { in: chatIds } } });
      await prisma.chatParticipant.deleteMany({ where: { chatId: { in: chatIds } } });
      const result = await prisma.chat.deleteMany({
        where: {
          id: { in: chatIds },
          organizationId,
        },
      });

      await cacheInvalidate(cacheKey(organizationId, 'chats', '*'));

      return reply.send({ deleted: result.count });
    },
  );
}
