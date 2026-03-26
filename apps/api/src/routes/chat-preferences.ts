import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';

// ─── Zod Schemas ───

const chatIdParamSchema = z.object({
  id: z.string().uuid(),
});

const updatePreferencesBodySchema = z.object({
  pinned: z.boolean().optional(),
  favorite: z.boolean().optional(),
  muted: z.boolean().optional(),
  unread: z.boolean().optional(),
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

export default async function chatPreferenceRoutes(fastify: FastifyInstance): Promise<void> {
  const authPreHandlers = [authenticate];

  // ─── GET /chats/:id/preferences ───

  fastify.get(
    '/chats/:id/preferences',
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

      // Verify chat exists and belongs to org
      const chat = await prisma.chat.findFirst({
        where: { id, organizationId },
        select: { id: true },
      });
      if (!chat) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Chat with id ${id} not found`, 404);
      }

      const preference = await prisma.chatPreference.findUnique({
        where: {
          userId_chatId: {
            userId: request.user.id,
            chatId: id,
          },
        },
      });

      return reply.send({
        pinned: preference?.pinned ?? false,
        favorite: preference?.favorite ?? false,
        muted: preference?.muted ?? false,
        unread: preference?.unread ?? false,
      });
    },
  );

  // ─── PATCH /chats/:id/preferences ───

  fastify.patch(
    '/chats/:id/preferences',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = chatIdParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid chat id', 422);
      }

      const bodyParsed = updatePreferencesBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', bodyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { id } = paramsParsed.data;
      const data = bodyParsed.data;

      if (Object.keys(data).length === 0) {
        return sendError(reply, 'VALIDATION_ERROR', 'At least one field must be provided for update', 422);
      }

      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      // Verify chat exists and belongs to org
      const chat = await prisma.chat.findFirst({
        where: { id, organizationId },
        select: { id: true },
      });
      if (!chat) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Chat with id ${id} not found`, 404);
      }

      const preference = await prisma.chatPreference.upsert({
        where: {
          userId_chatId: {
            userId: request.user.id,
            chatId: id,
          },
        },
        create: {
          userId: request.user.id,
          chatId: id,
          pinned: data.pinned ?? false,
          favorite: data.favorite ?? false,
          muted: data.muted ?? false,
          unread: data.unread ?? false,
        },
        update: data,
      });

      return reply.send({
        pinned: preference.pinned,
        favorite: preference.favorite,
        muted: preference.muted,
        unread: preference.unread,
      });
    },
  );
}
