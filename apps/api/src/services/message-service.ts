// ─── Shared message saving service ───
// Extracted from webhooks.ts so it can be reused by the Telegram connection manager
// and webhook handlers alike.

import { v5 as uuidv5 } from 'uuid';
import prisma from '../lib/prisma.js';
import { getIO } from '../websocket/index.js';
import { cacheInvalidate, cacheKey } from '../lib/cache.js';

// Fixed namespace for generating deterministic UUIDs for external users
const EXTERNAL_USER_UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace UUID

/** Generate a deterministic UUID for an external messenger user */
export function externalUserToUuid(messenger: string, externalUserId: string): string {
  return uuidv5(`external:${messenger}:${externalUserId}`, EXTERNAL_USER_UUID_NAMESPACE);
}

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

interface IngestReactionParams {
  externalMessageId: string;
  messenger: string;
  externalUserId: string;
  emoji: string;
  action: 'add' | 'remove';
}

/**
 * Process an incoming reaction from a messenger webhook/event.
 * Saves to DB and emits WebSocket event.
 */
export async function ingestReaction(params: IngestReactionParams): Promise<void> {
  const { externalMessageId, messenger, externalUserId, emoji, action } = params;

  // Find the message by external ID
  const message = await prisma.message.findFirst({
    where: { externalMessageId },
    select: { id: true, chatId: true, chat: { select: { organizationId: true } } },
  });

  if (!message) {
    console.warn(`[ingestReaction] Message not found for externalMessageId: ${externalMessageId}`);
    return;
  }

  const userId = externalUserToUuid(messenger, externalUserId);

  if (action === 'add') {
    await prisma.reaction.upsert({
      where: { messageId_userId_emoji: { messageId: message.id, userId, emoji } },
      create: {
        messageId: message.id,
        userId,
        emoji,
        externalSynced: true,
        externalUserId,
      },
      update: {
        externalSynced: true,
      },
    });

    // Emit WebSocket event
    try {
      const io = getIO();
      io.to(`chat:${message.chatId}`).emit('new_reaction', {
        messageId: message.id,
        userId,
        emoji,
        externalUserId,
      });
    } catch { /* WebSocket not available */ }
  } else {
    // Remove reaction
    await prisma.reaction.deleteMany({
      where: { messageId: message.id, userId, emoji },
    });

    try {
      const io = getIO();
      io.to(`chat:${message.chatId}`).emit('reaction_removed', {
        messageId: message.id,
        userId,
        emoji,
      });
    } catch { /* WebSocket not available */ }
  }
}
