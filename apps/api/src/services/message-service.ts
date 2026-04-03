// ─── Shared message saving service ───
// Extracted from webhooks.ts so it can be reused by the Telegram connection manager
// and webhook handlers alike.

import prisma from '../lib/prisma.js';
import { getIO } from '../websocket/index.js';
import { cacheInvalidate, cacheKey } from '../lib/cache.js';

export interface SaveIncomingMessageParams {
  externalChatId: string;
  messenger: string;
  organizationId: string;
  senderName: string;
  senderExternalId: string;
  text?: string;
  attachments?: unknown;
  externalMessageId?: string;
  isSelf?: boolean;
  createdAt?: Date;
}

export async function saveIncomingMessage(params: SaveIncomingMessageParams) {
  // Find the chat this message belongs to
  const chat = await prisma.chat.findFirst({
    where: {
      externalChatId: params.externalChatId,
      messenger: params.messenger,
      organizationId: params.organizationId,
    },
  });

  if (!chat) return null;

  const messageData = {
    chatId: chat.id,
    senderName: params.senderName,
    senderExternalId: params.senderExternalId,
    isSelf: params.isSelf ?? false,
    text: params.text || '',
    externalMessageId: params.externalMessageId,
    attachmentsLegacy: params.attachments ? JSON.parse(JSON.stringify(params.attachments)) : undefined,
    ...(params.createdAt ? { createdAt: params.createdAt } : {}),
  };

  let message;

  if (params.externalMessageId) {
    // Use create-and-catch-unique-violation to avoid TOCTOU race condition.
    // The @@unique([chatId, externalMessageId]) constraint guarantees dedup.
    try {
      [message] = await prisma.$transaction([
        prisma.message.create({ data: messageData }),
        prisma.chat.update({
          where: { id: chat.id },
          data: {
            lastActivityAt: new Date(),
            messageCount: { increment: 1 },
          },
        }),
      ]);
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') {
        // Duplicate external message — already saved, skip silently
        return null;
      }
      throw error;
    }
  } else {
    // No externalMessageId — no dedup needed, just create
    [message] = await prisma.$transaction([
      prisma.message.create({ data: messageData }),
      prisma.chat.update({
        where: { id: chat.id },
        data: {
          lastActivityAt: new Date(),
          messageCount: { increment: 1 },
        },
      }),
    ]);
  }

  // Emit real-time event via WebSocket
  try {
    const io = getIO();
    io.to(`org:${params.organizationId}`).emit('chat_updated', {
      chatId: chat.id,
    });
    io.to(`chat:${chat.id}`).emit('new_message', {
      chatId: chat.id,
      message: {
        id: message.id,
        chatId: chat.id,
        senderName: message.senderName,
        isSelf: message.isSelf,
        text: message.text,
        editedAt: message.editedAt ?? null,
        isPinned: message.isPinned,
        deliveryStatus: message.deliveryStatus ?? null,
        createdAt: message.createdAt,
        replyToMessage: null,
        attachments: [],
      },
    });
  } catch {
    // WebSocket might not be initialized in tests
  }

  // Invalidate chat list cache since lastActivityAt / messageCount changed
  await cacheInvalidate(cacheKey(params.organizationId, 'chats', '*'));

  return message;
}
