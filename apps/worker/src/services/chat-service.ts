// ─── Chat service (worker) ───
// Mirrors apps/api/src/services/chat-service.ts so the worker's initial-sync
// path uses the exact same upsert semantics as webhooks/runtime. Keeping the
// logic in one shape prevents drift between "chat auto-created from a webhook"
// and "chat auto-created during bulk import".

import type { Chat } from '@prisma/client';
import prisma from '../lib/prisma.js';

export type MessengerType = 'telegram' | 'slack' | 'whatsapp' | 'gmail';

export interface EnsureChatParams {
  organizationId: string;
  importedById: string;
  messenger: MessengerType;
  externalChatId: string;
  name: string;
  chatType?: 'direct' | 'group' | 'channel';
  lastActivityAt?: Date;
}

/**
 * Upsert a Chat row by its (externalChatId, messenger, organizationId) composite
 * key. `update: {}` means repeated calls are completely safe — existing chats
 * are never modified, so replays and reconnects cannot corrupt state.
 */
export async function ensureChat(params: EnsureChatParams): Promise<Chat> {
  const {
    organizationId,
    importedById,
    messenger,
    externalChatId,
    name,
    chatType = 'direct',
    lastActivityAt,
  } = params;

  return prisma.chat.upsert({
    where: {
      externalChatId_messenger_organizationId: {
        externalChatId,
        messenger,
        organizationId,
      },
    },
    create: {
      name,
      messenger,
      externalChatId,
      chatType,
      organizationId,
      importedById,
      syncStatus: 'pending',
      hasFullHistory: false,
      lastActivityAt: lastActivityAt ?? new Date(),
    },
    update: {},
  });
}
