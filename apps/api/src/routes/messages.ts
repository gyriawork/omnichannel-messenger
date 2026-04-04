import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { getIO } from '../websocket/index.js';
import { decryptCredentials } from '../lib/crypto.js';
import { createAdapter } from '../integrations/factory.js';
import { logActivity } from '../lib/activity-logger.js';

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

const forwardMessageBodySchema = z.object({
  targetChatId: z.string().uuid(),
});

const searchMessagesQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const addReactionBodySchema = z.object({
  emoji: z.string().min(1).max(20), // Emoji can be 1-20 UTF-16 chars (skin tones, flags, compound)
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
): Promise<{ id: string; organizationId: string; messenger: string; externalChatId: string; name: string } | null> {
  if (!organizationId) {
    sendError(reply, 'VALIDATION_ERROR', 'User is not associated with an organization', 400);
    return null;
  }

  const chat = await prisma.chat.findUnique({
    where: { id: chatId },
    select: { id: true, organizationId: true, messenger: true, externalChatId: true, name: true },
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
          reactions: {
            select: {
              id: true,
              emoji: true,
              userId: true,
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
          try {
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
          } finally {
            try { await adapter.disconnect(); } catch (e) { request.log.warn(e, 'adapter disconnect error'); }
          }
        }
      } catch (err) {
        // Extract the real Slack/messenger API error from MessengerError wrapper
        const originalErr = (err as { originalError?: unknown }).originalError;
        const realError = originalErr instanceof Error ? originalErr.message : originalErr ? String(originalErr) : null;
        const errMsg = err instanceof Error ? err.message : String(err);
        const fullError = realError ? `${errMsg}: ${realError}` : errMsg;
        console.error(`Failed to send message to ${chat.messenger}:`, fullError, err);
        deliveryStatus = 'failed';
        (message as Record<string, unknown>).deliveryError = fullError;
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

      // Log to activity feed
      logActivity({
        category: 'messages',
        action: 'message_sent',
        description: `sent a message in ${chat.name}`,
        targetType: 'message',
        targetId: message.id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId: request.user.organizationId!,
        metadata: { chatId, chatName: chat.name, messageLength: text.length },
      }).catch(() => {});

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
              try {
                await adapter.connect();
                await adapter.editMessage(chat.externalChatId, message.externalMessageId, text).catch(() => {});
              } finally {
                try { await adapter.disconnect(); } catch (e) { request.log.warn(e, 'adapter disconnect error'); }
              }
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

      logActivity({
        category: 'messages',
        action: 'message_edited',
        description: 'edited a message',
        targetType: 'message',
        targetId: id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId: message.chat.organizationId,
      }).catch(() => {});

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
              try {
                await adapter.connect();
                await adapter.deleteMessage(chat.externalChatId, message.externalMessageId).catch(() => {});
              } finally {
                try { await adapter.disconnect(); } catch (e) { request.log.warn(e, 'adapter disconnect error'); }
              }
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

      logActivity({
        category: 'messages',
        action: 'message_deleted',
        description: 'deleted a message',
        targetType: 'message',
        targetId: id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId: message.chat.organizationId,
      }).catch(() => {});

      return reply.status(200).send({ success: true });
    },
  );

  // ── POST /messages/:id/forward — Forward message to another chat ──

  fastify.post(
    '/messages/:id/forward',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const parsed = forwardMessageBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid input', 422);
      }

      const { targetChatId } = parsed.data;

      // Verify source message
      const sourceMessage = await prisma.message.findUnique({
        where: { id },
        include: { chat: { select: { organizationId: true, name: true } } },
      });

      if (!sourceMessage || sourceMessage.chat.organizationId !== request.user.organizationId) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Message not found', 404);
      }

      // Verify target chat
      const targetChat = await verifyChat(targetChatId, request.user.organizationId, reply);
      if (!targetChat) return;

      // Create forwarded message in target chat
      const forwardedText = `[Forwarded from ${sourceMessage.chat.name}]\n${sourceMessage.text}`;

      const [newMessage] = await prisma.$transaction([
        prisma.message.create({
          data: {
            chatId: targetChatId,
            senderName: request.user.name,
            senderExternalId: request.user.id,
            isSelf: true,
            text: forwardedText,
            deliveryStatus: 'sent',
          },
        }),
        prisma.chat.update({
          where: { id: targetChatId },
          data: { messageCount: { increment: 1 }, lastActivityAt: new Date() },
        }),
      ]);

      // Emit WebSocket event to target chat
      try {
        getIO().to(`chat:${targetChatId}`).emit('new_message', { chatId: targetChatId, message: newMessage });
      } catch {
        // WebSocket not initialized yet — non-fatal
      }

      logActivity({
        category: 'messages',
        action: 'message_forwarded',
        description: `forwarded a message to ${targetChat.name}`,
        targetType: 'message',
        targetId: newMessage.id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId: request.user.organizationId!,
        metadata: { sourceChatName: sourceMessage.chat.name, targetChatId },
      }).catch(() => {});

      return reply.status(201).send(newMessage);
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

  // ── POST /chats/:chatId/messages/:messageId/reactions — Add emoji reaction ──

  fastify.post(
    '/chats/:chatId/messages/:messageId/reactions',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { chatId, messageId } = request.params as { chatId: string; messageId: string };

      const parsed = addReactionBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.errors[0]?.message ?? 'Invalid input', 422);
      }

      const { emoji } = parsed.data;

      // Verify chat access
      const chat = await verifyChat(chatId, request.user.organizationId, reply);
      if (!chat) return;

      // Verify message exists in this chat
      const message = await prisma.message.findFirst({
        where: { id: messageId, chatId },
        select: { id: true },
      });

      if (!message) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Message not found in this chat', 404);
      }

      // Upsert reaction (create new or reset createdAt if re-adding same emoji)
      const reaction = await prisma.reaction.upsert({
        where: {
          messageId_userId_emoji: {
            messageId,
            userId: request.user.id,
            emoji,
          },
        },
        update: {
          createdAt: new Date(), // Reset timestamp on re-add
        },
        create: {
          messageId,
          userId: request.user.id,
          emoji,
        },
      });

      // Emit WebSocket event
      try {
        getIO().to(`chat:${chatId}`).emit('reaction_added', {
          chatId,
          messageId,
          reaction: {
            emoji: reaction.emoji,
            userId: reaction.userId,
            createdAt: reaction.createdAt,
          },
        });
      } catch {
        // WebSocket not initialized yet — non-fatal
      }

      return reply.status(201).send(reaction);
    },
  );

  // ── GET /chats/:chatId/messages/:messageId/reactions — Get reactions grouped by emoji ──

  fastify.get(
    '/chats/:chatId/messages/:messageId/reactions',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { chatId, messageId } = request.params as { chatId: string; messageId: string };

      // Verify chat access
      const chat = await verifyChat(chatId, request.user.organizationId, reply);
      if (!chat) return;

      // Verify message exists in this chat
      const message = await prisma.message.findFirst({
        where: { id: messageId, chatId },
        select: { id: true },
      });

      if (!message) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Message not found in this chat', 404);
      }

      // Aggregate reactions on the database side
      const reactions = await prisma.reaction.groupBy({
        by: ['emoji'],
        where: { messageId },
        _count: { emoji: true },
      });

      const userReactions = await prisma.reaction.findMany({
        where: { messageId, userId: request.user.id },
        select: { emoji: true },
      });
      const userEmojiSet = new Set(userReactions.map((r) => r.emoji));

      const grouped = reactions.map((r) => ({
        emoji: r.emoji,
        count: r._count.emoji,
        userReacted: userEmojiSet.has(r.emoji),
      }));

      return reply.status(200).send({ reactions: grouped });
    },
  );

  // ── DELETE /chats/:chatId/messages/:messageId/reactions/:emoji — Remove emoji reaction ──

  fastify.delete(
    '/chats/:chatId/messages/:messageId/reactions/:emoji',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { chatId, messageId, emoji } = request.params as { chatId: string; messageId: string; emoji: string };

      // Verify chat access
      const chat = await verifyChat(chatId, request.user.organizationId, reply);
      if (!chat) return;

      // Verify message exists in this chat
      const message = await prisma.message.findFirst({
        where: { id: messageId, chatId },
        select: { id: true },
      });

      if (!message) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Message not found in this chat', 404);
      }

      // Delete reaction (only own reactions)
      const deleted = await prisma.reaction.deleteMany({
        where: {
          messageId,
          emoji,
          userId: request.user.id,
        },
      });

      if (deleted.count === 0) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Reaction not found', 404);
      }

      // Emit WebSocket event
      try {
        getIO().to(`chat:${chatId}`).emit('reaction_removed', {
          chatId,
          messageId,
          emoji,
          userId: request.user.id,
        });
      } catch {
        // WebSocket not initialized yet — non-fatal
      }

      return reply.status(204).send();
    },
  );
}
