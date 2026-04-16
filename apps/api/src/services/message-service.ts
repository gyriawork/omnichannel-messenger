// ─── Shared message saving service ───
// Extracted from webhooks.ts so it can be reused by the Telegram connection manager
// and webhook handlers alike.

import { v5 as uuidv5 } from 'uuid';
import prisma from '../lib/prisma.js';
import { getIO } from '../websocket/index.js';
import { cacheInvalidate, cacheKey } from '../lib/cache.js';
import { ensureChat, type MessengerType } from './chat-service.js';

// Fixed namespace for generating deterministic UUIDs for external users
const EXTERNAL_USER_UUID_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace UUID

/** Generate a deterministic UUID for an external messenger user */
export function externalUserToUuid(messenger: string, externalUserId: string): string {
  return uuidv5(`external:${messenger}:${externalUserId}`, EXTERNAL_USER_UUID_NAMESPACE);
}

export interface StructuredAttachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface SaveIncomingMessageParams {
  externalChatId: string;
  messenger: string;
  organizationId: string;
  /** User who "owns" auto-created chats (importer). Required for auto-upsert of unknown chats. */
  importedById: string;
  senderName: string;
  senderExternalId: string;
  text?: string;
  /**
   * Structured attachments to persist as Attachment rows AND mirror into the
   * legacy JSON column for backward compatibility. If you pass raw unknown
   * JSON, it's only stored in the legacy column.
   */
  attachments?: StructuredAttachment[] | unknown;
  externalMessageId?: string;
  isSelf?: boolean;
  createdAt?: Date;
  /** Display name for the chat if it needs to be auto-created. Falls back to senderName. */
  chatName?: string;
  /** Chat type for auto-created chats. Defaults to 'direct'. */
  chatType?: 'direct' | 'group' | 'channel';
}

/** Type guard — is this value a well-formed StructuredAttachment[]? */
function isStructuredAttachments(value: unknown): value is StructuredAttachment[] {
  return (
    Array.isArray(value) &&
    value.every(
      (a) =>
        a != null &&
        typeof a === 'object' &&
        typeof (a as { url?: unknown }).url === 'string' &&
        typeof (a as { filename?: unknown }).filename === 'string' &&
        typeof (a as { mimeType?: unknown }).mimeType === 'string' &&
        typeof (a as { size?: unknown }).size === 'number',
    )
  );
}

export async function saveIncomingMessage(params: SaveIncomingMessageParams) {
  // Auto-upsert the chat — unknown chats from webhooks/real-time listeners are
  // created on the fly instead of dropped. This mirrors the Gmail pattern and
  // is the foundation of the "full messenger mirror" model.
  const chat = await ensureChat({
    organizationId: params.organizationId,
    importedById: params.importedById,
    messenger: params.messenger as MessengerType,
    externalChatId: params.externalChatId,
    name: params.chatName || params.senderName,
    chatType: params.chatType ?? 'direct',
    lastActivityAt: params.createdAt ?? new Date(),
  });

  const structuredAttachments = isStructuredAttachments(params.attachments)
    ? params.attachments
    : null;

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

  // Persist attachments as proper relation rows (separate from the legacy JSON
  // column) so we can render them cleanly in the UI. Done outside the tx so a
  // Prisma engine disconnect here can't invalidate the message insert.
  let createdAttachments: Array<{
    id: string;
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  }> = [];
  if (structuredAttachments && structuredAttachments.length > 0) {
    try {
      const rows = await prisma.$transaction(
        structuredAttachments.map((a) =>
          prisma.attachment.create({
            data: {
              messageId: message.id,
              url: a.url,
              filename: a.filename,
              mimeType: a.mimeType,
              size: a.size,
            },
            select: {
              id: true,
              url: true,
              filename: true,
              mimeType: true,
              size: true,
            },
          }),
        ),
      );
      createdAttachments = rows;
    } catch (err) {
      console.error('[saveIncomingMessage] Failed to persist attachment rows:', err);
    }
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
        attachments: createdAttachments,
      },
    });
  } catch {
    // WebSocket might not be initialized in tests
  }

  // Mark chat as unread for all org users (skip if the message is from ourselves)
  // Also skip users who are currently viewing this chat (in the socket.io room)
  if (!params.isSelf) {
    try {
      // Determine which users are currently viewing this chat
      let activeUserIds = new Set<string>();
      try {
        const io = getIO();
        const roomSockets = await io.in(`chat:${chat.id}`).fetchSockets();
        activeUserIds = new Set(
          roomSockets
            .map((s) => (s.data as { user?: { id: string } })?.user?.id)
            .filter((id): id is string => !!id),
        );
      } catch { /* WebSocket may not be initialized */ }

      // Get all users in the organization
      const orgUsers = await prisma.user.findMany({
        where: { organizationId: params.organizationId },
        select: { id: true },
      });

      // Upsert preferences: set unread=true for each user not currently viewing
      await Promise.all(
        orgUsers
          .filter((u) => !activeUserIds.has(u.id))
          .map((u) =>
            prisma.chatPreference.upsert({
              where: { userId_chatId: { userId: u.id, chatId: chat.id } },
              create: { userId: u.id, chatId: chat.id, unread: true },
              update: { unread: true },
            }),
          ),
      );
    } catch { /* best-effort */ }
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
