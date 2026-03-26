import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { requireMinRole, getOrgId } from '../middleware/rbac.js';
import { broadcastQueue } from '../lib/queue.js';
import { getIO } from '../websocket/index.js';

// ─── Zod Schemas ───

const broadcastStatusEnum = z.enum([
  'draft', 'scheduled', 'sending', 'sent', 'partially_failed', 'failed',
]);

const listBroadcastsQuerySchema = z.object({
  status: broadcastStatusEnum.optional(),
  search: z.string().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const createBroadcastBodySchema = z.object({
  name: z.string().min(1).max(500),
  messageText: z.string().min(1).max(10000),
  chatIds: z.array(z.string().uuid()).min(1).max(10000),
  scheduledAt: z.coerce.date().optional(),
  templateId: z.string().uuid().optional(),
  attachments: z.any().optional(),
});

const updateBroadcastBodySchema = z.object({
  name: z.string().min(1).max(500).optional(),
  messageText: z.string().min(1).max(10000).optional(),
  chatIds: z.array(z.string().uuid()).min(1).max(10000).optional(),
  scheduledAt: z.coerce.date().nullable().optional(),
});

const analyticsQuerySchema = z.object({
  period: z.string().regex(/^\d+d$/).default('30d'),
  messenger: z.enum(['telegram', 'slack', 'whatsapp', 'gmail']).optional(),
});

// ─── Helpers ───

function sendError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.status(statusCode).send({
    error: { code, message, statusCode },
  });
}

// ─── Plugin ───

export default async function broadcastRoutes(fastify: FastifyInstance): Promise<void> {
  const authPreHandlers = [authenticate];
  const adminPreHandlers = [authenticate, requireMinRole('admin')];

  // ─── GET /broadcasts ───

  fastify.get(
    '/broadcasts',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listBroadcastsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '), 422);
      }

      const { status, search, page, limit } = parsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const where: Record<string, unknown> = { organizationId };
      if (status) where.status = status;
      if (search) {
        where.name = { contains: search, mode: 'insensitive' };
      }

      const [broadcasts, total] = await Promise.all([
        prisma.broadcast.findMany({
          where,
          include: {
            createdBy: { select: { id: true, name: true, email: true } },
            chats: {
              select: { status: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.broadcast.count({ where }),
      ]);

      const result = broadcasts.map((b) => {
        const chatStatuses = b.chats;
        const totalChats = chatStatuses.length;
        const sentCount = chatStatuses.filter((c) => c.status === 'sent').length;
        const failedCount = chatStatuses.filter((c) =>
          c.status === 'failed' || c.status === 'retry_exhausted',
        ).length;
        const pendingCount = chatStatuses.filter((c) =>
          c.status === 'pending' || c.status === 'retrying',
        ).length;

        return {
          id: b.id,
          name: b.name,
          messageText: b.messageText,
          attachments: b.attachments,
          status: b.status,
          scheduledAt: b.scheduledAt,
          sentAt: b.sentAt,
          deliveryRate: b.deliveryRate,
          templateId: b.templateId,
          createdBy: b.createdBy,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
          stats: {
            total: totalChats,
            sent: sentCount,
            failed: failedCount,
            pending: pendingCount,
          },
        };
      });

      return reply.send({ broadcasts: result, total, page, limit });
    },
  );

  // ─── GET /broadcasts/analytics ───
  // Must be before /broadcasts/:id to avoid route collision

  fastify.get(
    '/broadcasts/analytics',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = analyticsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '), 422);
      }

      const { period, messenger } = parsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const days = parseInt(period.replace('d', ''), 10);
      const since = new Date();
      since.setDate(since.getDate() - days);

      // Get all BroadcastChats for this org within the period
      const broadcastChatWhere: Record<string, unknown> = {
        broadcast: {
          organizationId,
          sentAt: { gte: since },
        },
      };

      if (messenger) {
        broadcastChatWhere.chat = { messenger };
      }

      const broadcastChats = await prisma.broadcastChat.findMany({
        where: broadcastChatWhere,
        select: {
          status: true,
          sentAt: true,
          chat: { select: { messenger: true } },
        },
      });

      const totalSent = broadcastChats.filter((bc) => bc.status === 'sent').length;
      const totalFailed = broadcastChats.filter((bc) =>
        bc.status === 'failed' || bc.status === 'retry_exhausted',
      ).length;
      const totalAll = broadcastChats.length;
      const deliveryRate = totalAll > 0 ? totalSent / totalAll : 0;

      // Per-messenger breakdown
      const messengerMap = new Map<string, { sent: number; failed: number; total: number }>();
      for (const bc of broadcastChats) {
        const m = bc.chat.messenger;
        const entry = messengerMap.get(m) ?? { sent: 0, failed: 0, total: 0 };
        entry.total++;
        if (bc.status === 'sent') entry.sent++;
        if (bc.status === 'failed' || bc.status === 'retry_exhausted') entry.failed++;
        messengerMap.set(m, entry);
      }

      const perMessenger: Record<string, { sent: number; failed: number; total: number; deliveryRate: number }> = {};
      for (const [m, entry] of messengerMap) {
        perMessenger[m] = {
          ...entry,
          deliveryRate: entry.total > 0 ? entry.sent / entry.total : 0,
        };
      }

      // Daily counts (based on sentAt)
      const dailyMap = new Map<string, { sent: number; failed: number }>();
      for (const bc of broadcastChats) {
        const dateStr = bc.sentAt
          ? bc.sentAt.toISOString().slice(0, 10)
          : null;
        if (!dateStr) continue;
        const entry = dailyMap.get(dateStr) ?? { sent: 0, failed: 0 };
        if (bc.status === 'sent') entry.sent++;
        if (bc.status === 'failed' || bc.status === 'retry_exhausted') entry.failed++;
        dailyMap.set(dateStr, entry);
      }

      const dailyCounts = Array.from(dailyMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, counts]) => ({ date, ...counts }));

      return reply.send({
        totalSent,
        totalFailed,
        total: totalAll,
        deliveryRate,
        perMessenger,
        dailyCounts,
      });
    },
  );

  // ─── GET /broadcasts/:id ───

  fastify.get(
    '/broadcasts/:id',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid broadcast id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const broadcast = await prisma.broadcast.findFirst({
        where: { id, organizationId },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          chats: {
            include: {
              chat: {
                select: {
                  id: true,
                  name: true,
                  messenger: true,
                  externalChatId: true,
                  chatType: true,
                },
              },
            },
          },
        },
      });

      if (!broadcast) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Broadcast with id ${id} not found`, 404);
      }

      // Group chats by status
      const chatsByStatus: Record<string, typeof broadcast.chats> = {};
      for (const bc of broadcast.chats) {
        const arr = chatsByStatus[bc.status] ?? [];
        arr.push(bc);
        chatsByStatus[bc.status] = arr;
      }

      const totalChats = broadcast.chats.length;
      const sentCount = broadcast.chats.filter((c) => c.status === 'sent').length;
      const failedCount = broadcast.chats.filter((c) =>
        c.status === 'failed' || c.status === 'retry_exhausted',
      ).length;
      const pendingCount = broadcast.chats.filter((c) =>
        c.status === 'pending' || c.status === 'retrying',
      ).length;

      return reply.send({
        id: broadcast.id,
        name: broadcast.name,
        messageText: broadcast.messageText,
        attachments: broadcast.attachments,
        status: broadcast.status,
        scheduledAt: broadcast.scheduledAt,
        sentAt: broadcast.sentAt,
        deliveryRate: broadcast.deliveryRate,
        templateId: broadcast.templateId,
        createdBy: broadcast.createdBy,
        createdAt: broadcast.createdAt,
        updatedAt: broadcast.updatedAt,
        stats: {
          total: totalChats,
          sent: sentCount,
          failed: failedCount,
          pending: pendingCount,
        },
        chatsByStatus,
      });
    },
  );

  // ─── POST /broadcasts ───

  fastify.post(
    '/broadcasts',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = createBroadcastBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { name, messageText, chatIds, scheduledAt, templateId, attachments } = parsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      // Validate all chatIds belong to this org
      const validChats = await prisma.chat.findMany({
        where: { id: { in: chatIds }, organizationId },
        select: { id: true },
      });
      const validChatIds = validChats.map((c) => c.id);

      if (validChatIds.length === 0) {
        return sendError(reply, 'VALIDATION_ERROR', 'No valid chats found in this organization', 422);
      }

      // Validate templateId if provided
      if (templateId) {
        const template = await prisma.template.findFirst({
          where: { id: templateId, organizationId },
        });
        if (!template) {
          return sendError(reply, 'RESOURCE_NOT_FOUND', `Template with id ${templateId} not found`, 404);
        }
      }

      const broadcast = await prisma.$transaction(async (tx) => {
        const b = await tx.broadcast.create({
          data: {
            name,
            messageText,
            attachments: attachments ?? undefined,
            status: scheduledAt ? 'scheduled' : 'draft',
            scheduledAt: scheduledAt ?? undefined,
            organizationId,
            createdById: request.user.id,
            templateId: templateId ?? undefined,
          },
        });

        await tx.broadcastChat.createMany({
          data: validChatIds.map((chatId) => ({
            broadcastId: b.id,
            chatId,
            status: 'pending',
          })),
        });

        return b;
      });

      // If scheduled, enqueue delayed job
      if (scheduledAt) {
        const delay = Math.max(0, scheduledAt.getTime() - Date.now());
        await broadcastQueue.add(
          'broadcast:send',
          { broadcastId: broadcast.id, organizationId },
          { delay, jobId: `broadcast-${broadcast.id}` },
        );
      }

      const full = await prisma.broadcast.findFirst({
        where: { id: broadcast.id },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          chats: { select: { id: true, chatId: true, status: true } },
        },
      });

      return reply.status(201).send(full);
    },
  );

  // ─── PATCH /broadcasts/:id ───

  fastify.patch(
    '/broadcasts/:id',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid broadcast id', 422);
      }

      const bodyParsed = updateBroadcastBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', bodyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { id } = paramsParsed.data;
      const { name, messageText, chatIds, scheduledAt } = bodyParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.broadcast.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Broadcast with id ${id} not found`, 404);
      }

      if (existing.status !== 'draft' && existing.status !== 'scheduled') {
        return sendError(reply, 'VALIDATION_ERROR', 'Only draft or scheduled broadcasts can be updated', 422);
      }

      const updated = await prisma.$transaction(async (tx) => {
        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name;
        if (messageText !== undefined) updateData.messageText = messageText;
        if (scheduledAt !== undefined) {
          updateData.scheduledAt = scheduledAt;
          updateData.status = scheduledAt ? 'scheduled' : 'draft';
        }

        const b = await tx.broadcast.update({
          where: { id },
          data: updateData,
        });

        // Replace chatIds if provided
        if (chatIds !== undefined) {
          const validChats = await tx.chat.findMany({
            where: { id: { in: chatIds }, organizationId },
            select: { id: true },
          });
          const validChatIds = validChats.map((c) => c.id);

          if (validChatIds.length === 0) {
            throw new Error('NO_VALID_CHATS');
          }

          await tx.broadcastChat.deleteMany({ where: { broadcastId: id } });
          await tx.broadcastChat.createMany({
            data: validChatIds.map((chatId) => ({
              broadcastId: id,
              chatId,
              status: 'pending',
            })),
          });
        }

        return b;
      }).catch((err) => {
        if (err instanceof Error && err.message === 'NO_VALID_CHATS') {
          return null;
        }
        throw err;
      });

      if (updated === null) {
        return sendError(reply, 'VALIDATION_ERROR', 'No valid chats found in this organization', 422);
      }

      // Update scheduled job if scheduledAt changed
      if (scheduledAt !== undefined) {
        // Remove old job
        const oldJob = await broadcastQueue.getJob(`broadcast-${id}`);
        if (oldJob) await oldJob.remove();

        // Add new job if scheduled
        if (scheduledAt) {
          const delay = Math.max(0, scheduledAt.getTime() - Date.now());
          await broadcastQueue.add(
            'broadcast:send',
            { broadcastId: id, organizationId },
            { delay, jobId: `broadcast-${id}` },
          );
        }
      }

      const full = await prisma.broadcast.findFirst({
        where: { id },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          chats: { select: { id: true, chatId: true, status: true } },
        },
      });

      return reply.send(full);
    },
  );

  // ─── DELETE /broadcasts/:id ───

  fastify.delete(
    '/broadcasts/:id',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid broadcast id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.broadcast.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Broadcast with id ${id} not found`, 404);
      }

      if (existing.status === 'sending') {
        return sendError(reply, 'VALIDATION_ERROR', 'Cannot delete a broadcast that is currently sending', 422);
      }

      // Remove scheduled job if exists
      const scheduledJob = await broadcastQueue.getJob(`broadcast-${id}`);
      if (scheduledJob) await scheduledJob.remove();

      await prisma.broadcast.delete({ where: { id } });

      return reply.status(204).send();
    },
  );

  // ─── POST /broadcasts/:id/send ───

  fastify.post(
    '/broadcasts/:id/send',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid broadcast id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const broadcast = await prisma.broadcast.findFirst({
        where: { id, organizationId },
        include: { chats: { select: { id: true } } },
      });
      if (!broadcast) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Broadcast with id ${id} not found`, 404);
      }

      if (broadcast.status !== 'draft' && broadcast.status !== 'scheduled') {
        return sendError(reply, 'VALIDATION_ERROR', `Cannot send a broadcast with status "${broadcast.status}"`, 422);
      }

      if (broadcast.chats.length === 0) {
        return sendError(reply, 'VALIDATION_ERROR', 'Broadcast has no recipient chats', 422);
      }

      // Update status to sending
      await prisma.broadcast.update({
        where: { id },
        data: { status: 'sending', sentAt: new Date() },
      });

      // Remove scheduled job if exists (in case of early manual send)
      const scheduledJob = await broadcastQueue.getJob(`broadcast-${id}`);
      if (scheduledJob) await scheduledJob.remove();

      // Enqueue broadcast job
      await broadcastQueue.add(
        'broadcast:send',
        { broadcastId: id, organizationId },
        { jobId: `broadcast-${id}-${Date.now()}` },
      );

      // Emit real-time status
      try {
        const io = getIO();
        io.to(`org:${organizationId}`).emit('broadcast_status', {
          broadcastId: id,
          status: 'sending',
        });
      } catch {
        // WebSocket might not be initialized in tests
      }

      return reply.send({ success: true });
    },
  );

  // ─── POST /broadcasts/:id/retry ───

  fastify.post(
    '/broadcasts/:id/retry',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid broadcast id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const broadcast = await prisma.broadcast.findFirst({
        where: { id, organizationId },
        include: {
          chats: {
            where: { status: { in: ['failed', 'retry_exhausted'] } },
          },
        },
      });
      if (!broadcast) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Broadcast with id ${id} not found`, 404);
      }

      if (broadcast.chats.length === 0) {
        return sendError(reply, 'VALIDATION_ERROR', 'No failed chats to retry', 422);
      }

      // Reset failed chats to pending
      await prisma.broadcastChat.updateMany({
        where: {
          broadcastId: id,
          status: { in: ['failed', 'retry_exhausted'] },
        },
        data: { status: 'retrying', errorReason: null },
      });

      // Update broadcast status
      await prisma.broadcast.update({
        where: { id },
        data: { status: 'sending' },
      });

      // Enqueue retry job
      await broadcastQueue.add(
        'broadcast:retry',
        { broadcastId: id, organizationId },
        { jobId: `broadcast-retry-${id}-${Date.now()}` },
      );

      // Emit real-time status
      try {
        const io = getIO();
        io.to(`org:${organizationId}`).emit('broadcast_status', {
          broadcastId: id,
          status: 'sending',
          retrying: true,
        });
      } catch {
        // WebSocket might not be initialized
      }

      return reply.send({ success: true });
    },
  );

  // ─── POST /broadcasts/:id/duplicate ───

  fastify.post(
    '/broadcasts/:id/duplicate',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid broadcast id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const original = await prisma.broadcast.findFirst({
        where: { id, organizationId },
        include: {
          chats: { select: { chatId: true } },
        },
      });
      if (!original) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Broadcast with id ${id} not found`, 404);
      }

      const duplicate = await prisma.$transaction(async (tx) => {
        const b = await tx.broadcast.create({
          data: {
            name: `${original.name} (copy)`,
            messageText: original.messageText,
            attachments: original.attachments ?? undefined,
            status: 'draft',
            organizationId,
            createdById: request.user.id,
            templateId: original.templateId ?? undefined,
          },
        });

        if (original.chats.length > 0) {
          await tx.broadcastChat.createMany({
            data: original.chats.map((bc) => ({
              broadcastId: b.id,
              chatId: bc.chatId,
              status: 'pending',
            })),
          });
        }

        return b;
      });

      const full = await prisma.broadcast.findFirst({
        where: { id: duplicate.id },
        include: {
          createdBy: { select: { id: true, name: true, email: true } },
          chats: { select: { id: true, chatId: true, status: true } },
        },
      });

      return reply.status(201).send(full);
    },
  );
}
