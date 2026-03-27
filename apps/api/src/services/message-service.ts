// ─── Shared message saving service ───
// Extracted from webhooks.ts so it can be reused by the Telegram connection manager
// and webhook handlers alike.

import prisma from '../lib/prisma.js';
import { getIO } from '../websocket/index.js';

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
  // Find the chat
  const chat = await prisma.chat.findFirst({
    where: {
      externalChatId: params.externalChatId,
      messenger: params.messenger,
      organizationId: params.organizationId,
    },
  });

  if (!chat) {
    // Chat not imported — ignore
    return null;
  }

  // Deduplication: skip if we already have this external message
  if (params.externalMessageId) {
    const existing = await prisma.message.findFirst({
      where: {
        chatId: chat.id,
        externalMessageId: params.externalMessageId,
      },
      select: { id: true },
    });
    if (existing) return null;
  }

  // Save message
  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      senderName: params.senderName,
      senderExternalId: params.senderExternalId,
      isSelf: params.isSelf ?? false,
      text: params.text || '',
      externalMessageId: params.externalMessageId,
      attachments: params.attachments ? JSON.parse(JSON.stringify(params.attachments)) : undefined,
      ...(params.createdAt ? { createdAt: params.createdAt } : {}),
    },
  });

  // Update chat lastActivityAt and messageCount
  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      lastActivityAt: new Date(),
      messageCount: { increment: 1 },
    },
  });

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
        text: message.text,
        isSelf: message.isSelf,
        createdAt: message.createdAt,
      },
    });
  } catch {
    // WebSocket might not be initialized in tests
  }

  return message;
}
