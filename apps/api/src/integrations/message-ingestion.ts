import prisma from '../lib/prisma.js';
import { getIO } from '../websocket/index.js';

export interface IncomingMessageParams {
  externalChatId: string;
  messenger: string;
  externalMessageId: string;
  senderName: string;
  senderExternalId: string;
  text: string;
  createdAt?: Date;
  isSelf?: boolean;
}

/**
 * Unified incoming message handler used by all messenger webhook handlers.
 * Handles deduplication, DB persistence, chat updates, and WebSocket notification.
 *
 * Returns the created message or null if the chat isn't imported or message is a duplicate.
 */
export async function ingestIncomingMessage(params: IncomingMessageParams) {
  const chat = await prisma.chat.findFirst({
    where: { externalChatId: params.externalChatId, messenger: params.messenger },
    select: { id: true, organizationId: true },
  });

  if (!chat) return null; // Chat not imported, ignore

  // Dedup check
  if (params.externalMessageId) {
    const existing = await prisma.message.findFirst({
      where: { chatId: chat.id, externalMessageId: params.externalMessageId },
    });
    if (existing) return null;
  }

  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      externalMessageId: params.externalMessageId,
      senderName: params.senderName,
      senderExternalId: params.senderExternalId,
      isSelf: params.isSelf ?? false,
      text: params.text,
      deliveryStatus: 'delivered',
      createdAt: params.createdAt ?? new Date(),
    },
  });

  await prisma.chat.update({
    where: { id: chat.id },
    data: { messageCount: { increment: 1 }, lastActivityAt: new Date() },
  });

  try {
    getIO().to(`chat:${chat.id}`).emit('new_message', { chatId: chat.id, message });
    getIO().to(`org:${chat.organizationId}`).emit('chat_updated', { chatId: chat.id });
  } catch {}

  return message;
}
