import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { getIO } from '../websocket/index.js';
import { decryptCredentials } from '../lib/crypto.js';
import { createAdapter } from '../integrations/factory.js';

// ─── Zod Schemas ───

const listMessagesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const sendMessageBodySchema = z.object({
  text: z.string().max(10000).default(''),
  replyToMessageId: z.string().uuid().optional(),
  attachments: z
    .array(
      z.object({
        url: z.string().url(),
        filename: z.string().min(1).max(500),
        mimeType: z.string().min(1).max(200),
        size: z.number().int().min(0),
      }),
    )
    .max(20)
    .optional(),
});

const editMessageBodySchema = z.object({
  text: z.string().min(1).max(10000),
});

const pinMessageBodySchema = z.object({
  isPinned: z.boolean(),
});

const searchMessagesQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Helpers ───

function sendError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.status(statusCode).send({
    error: { code, message, statusCode },
  });
}

/**
 * Verify a chat exists and belongs to the user's organization.
 * Returns the chat or sends an error response and returns null.
 */
async function verifyChat(
  chatId: string,
  organizationId: string | null,
  reply: FastifyReply,
): Promise<{ id: string; organizationId: string; messenger: string; externalChatId: string } | null> {
  if (!organizationId) {
    sendError(reply, 'VALIDATION_ERROR', 'User is not associated with an organization', 400);
    return null;
  }

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, organizationId: true, messenger: true, externalChatId: true },
  });

  if (!chat) {
    sendError(reply, 'RESOURCE_NOT_FOUND', `Chat with id ${chatId} not found`, 404);
    return null;
  }

  if (chat.organizationId !== organizationId) {
    sendError(reply, 'AUTH_INSUFFICIENT_PERMISSIONS', 'You do not have access to this chat', 403);
    return null;
  }

  return chat;
}

// ─── Plugin ───

export default async function messageRoutes(fastify: FastifyInstance): Promise<void> {
  // ── GET /chats/:chatId/messages — List messages (cursor-based pagination) ──

  fastify.get(
    '/chats/:chatId/messages',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { chatId } = request.params as { chatId: string };

      const parsed = listMessagesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid query', 422);
      }

      const { cursor, limit } = parsed.data;

      const chat = await verifyChat(chatId, request.user.organizationId, reply);
      if (!chat) return;

      // Build cursor-based query
      const where: Record<string, unknown> = { chatId };

      if (cursor) {
        const cursorMessage = await prisma.message.findUnique({
          where: { id: cursor },
          select: { createdAt: true },
        });

        if (cursorMessage) {
          where.createdAt = { lt: cursorMessage.createdAt };
        }
      }

      const messages = await prisma.message.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit + 1, // fetch one extra to determine nextCursor
        include: {
          replyToMessage: {
            select: {
              id: true,
              senderName: true,
              text: true,
            },
          },
        },
      });

      let nextCursor: string | null = null;

      if (messages.length > limit) {
        const lastMessage = messages.pop()!;
        nextCursor = lastMessage.id;
      }

      // Truncate reply preview text
      const formatted = messages.map((msg) => ({
        ...msg,
        replyToMessage: msg.replyToMessage
          ? {
              id: msg.replyToMessage.id,
              senderName: msg.replyToMessage.senderName,
              text:
                msg.replyToMessage.text.length > 100
                  ? msg.replyToMessage.text.slice(0, 100) + '...'
                  : msg.replyToMessage.text,
            }
          : null,
      }));

      return reply.status(200).send({ messages: formatted, nextCursor });
    },
  );

  // ── POST /chats/:chatId/messages — Send a message ──

  fastify.post(
    '/chats/:chatId/messages',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { chatId } = request.params as { chatId: string };

      const parsed = sendMessageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input', 422);
      }

      const { text, replyToMessageId, attachments } = parsed.data;

      const chat = await verifyChat(chatId, request.user.organizationId, reply);
      if (!chat) return;

      // Verify replyToMessageId exists in this chat
      if (replyToMessageId) {
        const replyTarget = await prisma.message.findFirst({
          where: { id: replyToMessageId, chatId },
          select: { id: true },
        });

        if (!replyTarget) {
          return sendError(reply, 'RESOURCE_NOT_FOUND', 'Reply target message not found in this chat', 404);
        }
      }

      // Create message + update chat in a transaction
      const [message] = await prisma.$transaction([
        prisma.message.create({
          data: {
            chatId,
            senderName: request.user.name,
            senderExternalId: request.user.id,
            isSelf: true,
            text,
            replyToMessageId: replyToMessageId ?? null,
            attachmentsLegacy: attachments ?? undefined,
            deliveryStatus: 'sent',
          },
          include: {
            replyToMessage: {
              select: { id: true, senderName: true, text: true },
            },
          },
        }),
        prisma.chat.update({
          where: { id: chatId },
          data: {
            messageCount: { increment: 1 },
            lastActivityAt: new Date(),
          },
        }),
      ]);

      // ── Send message to real messenger ──
      let deliveryStatus = 'sent';
      let externalMessageId: string | null = null;
      try {
        const integration = await prisma.integration.findFirst({
          where: {
            messenger: chat.messenger,
            organizationId: request.user.organizationId!,
            status: 'connected',
          },
        });

        if (integration && integration.credentials) {
          const creds = decryptCredentials(integration.credentials as string);
          const adapter = await createAdapter(chat.messenger, creds);
          await adapter.connect();

          // Find reply-to external ID if replying
          let replyToExternalId: string | undefined;
          if (replyToMessageId) {
            const replyMsg = await prisma.message.findUnique({
              where: { id: replyToMessageId },
              select: { externalMessageId: true },
            });
            replyToExternalId = replyMsg?.externalMessageId ?? undefined;
          }

          const savedAttachments = await prisma.attachment.findMany({
            where: { messageId: message.id },
            select: { url: true, filename: true, mimeType: true },
          });

          const result = await adapter.sendMessage(
            chat.externalChatId,
            text,
            {
              replyToExternalId,
              attachments: savedAttachments.length > 0 ? savedAttachments : undefined,
            },
          );
          externalMessageId = result.externalMessageId;
          deliveryStatus = 'delivered';
        }
      } catch (err) {
        console.error(`Failed to send message to ${chat.messenger}:`, err);
        deliveryStatus = 'failed';
      }

      // Update message with delivery result
      if (deliveryStatus !== 'sent' || externalMessageId) {
        await prisma.message.update({
          where: { id: message.id },
          data: {
            deliveryStatus,
            ...(externalMessageId ? { externalMessageId } : {}),
          },
        });
        (message as Record<string, unknown>).deliveryStatus = deliveryStatus;
        if (externalMessageId) {
          (message as Record<string, unknown>).externalMessageId = externalMessageId;
        }
      }

      // Emit WebSocket event
      try {
        getIO().to(`chat:${chatId}`).emit('new_message', { chatId, message });
      } catch {
        // WebSocket not initialized yet — non-fatal
      }

      return reply.status(201).send(message);
    },
  );

  // ── PATCH /messages/:id — Edit message ──

  fastify.patch(
    '/messages/:id',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parsed = editMessageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input', 422);
      }

      const { text } = parsed.data;

      const message = await prisma.message.findUnique({
        where: { id },
        include: { chat: { select: { organizationId: true } } },
      });

      if (!message) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Message with id ${id} not found`, 404);
      }

      // Verify organization access
      if (message.chat.organizationId !== request.user.organizationId) {
        return sendError(reply, 'AUTH_INSUFFICIENT_PERMISSIONS', 'You do not have access to this message', 403);
      }

      // Only own messages can be edited
      if (!message.isSelf || (message.senderExternalId !== request.user.id && message.senderName !== request.user.name)) {
        return sendError(reply, 'AUTH_INSUFFICIENT_PERMISSIONS', 'You can only edit your own messages', 403);
      }

      const updated = await prisma.message.update({
        where: { id },
        data: { text, editedAt: new Date() },
      });

      // Edit message in real messenger (best-effort)
      if (message.externalMessageId) {
        try {
          const chat = await prisma.chat.findUnique({
            where: { id: message.chatId },
            select: { messenger: true, externalChatId: true, organizationId: true },
          });
          if (chat) {
            const integration = await prisma.integration.findFirst({
              where: { messenger: chat.messenger, organizationId: chat.organizationId, status: 'connected' },
            });
            if (integration?.credentials) {
              const creds = decryptCredentials(integration.credentials as string);
              const adapter = await createAdapter(chat.messenger, creds);
              await adapter.connect();
              await adapter.editMessage(chat.externalChatId, message.externalMessageId, text).catch(() => {});
            }
          }
        } catch { /* best-effort */ }
      }

      // Emit WebSocket event
      try {
        getIO().to(`chat:${message.chatId}`).emit('message_updated', {
          chatId: message.chatId,
          messageId: updated.id,
          text: updated.text,
          editedAt: updated.editedAt,
        });
      } catch {
        // WebSocket not initialized yet — non-fatal
      }

      return reply.status(200).send(updated);
    },
  );

  // ── DELETE /messages/:id — Delete message ──

  fastify.delete(
    '/messages/:id',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const message = await prisma.message.findUnique({
        where: { id },
        include: { chat: { select: { organizationId: true } } },
      });

      if (!message) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Message with id ${id} not found`, 404);
      }

      // Verify organization access
      if (message.chat.organizationId !== request.user.organizationId) {
        return sendError(reply, 'AUTH_INSUFFICIENT_PERMISSIONS', 'You do not have access to this message', 403);
      }

      // Only own messages can be deleted
      if (!message.isSelf || (message.senderExternalId !== request.user.id && message.senderName !== request.user.name)) {
        return sendError(reply, 'AUTH_INSUFFICIENT_PERMISSIONS', 'You can only delete your own messages', 403);
      }

      // Delete message in real messenger (best-effort)
      if (message.externalMessageId) {
        try {
          const chat = await prisma.chat.findUnique({
            where: { id: message.chatId },
            select: { messenger: true, externalChatId: true, organizationId: true },
          });
          if (chat) {
            const integration = await prisma.integration.findFirst({
              where: { messenger: chat.messenger, organizationId: chat.organizationId, status: 'connected' },
            });
            if (integration?.credentials) {
              const creds = decryptCredentials(integration.credentials as string);
              const adapter = await createAdapter(chat.messenger, creds);
              await adapter.connect();
              await adapter.deleteMessage(chat.externalChatId, message.externalMessageId).catch(() => {});
            }
          }
        } catch { /* best-effort */ }
      }

      await prisma.message.delete({ where: { id } });

      // Emit WebSocket event
      try {
        getIO().to(`chat:${message.chatId}`).emit('message_deleted', {
          chatId: message.chatId,
          messageId: id,
        });
      } catch {
        // WebSocket not initialized yet — non-fatal
      }

      return reply.status(200).send({ success: true });
    },
  );

  // ── PATCH /messages/:id/pin — Pin/unpin message ──

  fastify.patch(
    '/messages/:id/pin',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const parsed = pinMessageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input', 422);
      }

      const { isPinned } = parsed.data;

      const message = await prisma.message.findUnique({
        where: { id },
        include: { chat: { select: { organizationId: true } } },
      });

      if (!message) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Message with id ${id} not found`, 404);
      }

      // Verify organization access
      if (message.chat.organizationId !== request.user.organizationId) {
        return sendError(reply, 'AUTH_INSUFFICIENT_PERMISSIONS', 'You do not have access to this message', 403);
      }

      const updated = await prisma.message.update({
        where: { id },
        data: { isPinned },
      });

      return reply.status(200).send(updated);
    },
  );

  // ── GET /chats/:chatId/messages/search — Search messages ──

  fastify.get(
    '/chats/:chatId/messages/search',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { chatId } = request.params as { chatId: string };

      const parsed = searchMessagesQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid query', 422);
      }

      const { q, limit } = parsed.data;

      const chat = await verifyChat(chatId, request.user.organizationId, reply);
      if (!chat) return;

      const messages = await prisma.message.findMany({
        where: {
          chatId,
          text: { contains: q, mode: 'insensitive' },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          replyToMessage: {
            select: { id: true, senderName: true, text: true },
          },
        },
      });

      return reply.status(200).send({ messages });
    },
  );
}
