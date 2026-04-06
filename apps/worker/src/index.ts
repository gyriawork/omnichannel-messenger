// Polyfill globalThis.crypto for Node.js 18 (required by Baileys / libsignal)
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

import { Worker, Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import prisma from './lib/prisma.js';
import { decryptCredentials } from './lib/crypto.js';
import { createAdapter } from './integrations/factory.js';
type Messenger = 'telegram' | 'slack' | 'whatsapp' | 'gmail';

const DEFAULT_ANTIBAN: Record<Messenger, {
  messagesPerBatch: number;
  delayBetweenMessages: number;
  delayBetweenBatches: number;
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
}> = {
  telegram: { messagesPerBatch: 10, delayBetweenMessages: 5, delayBetweenBatches: 180, maxMessagesPerHour: 50, maxMessagesPerDay: 300 },
  whatsapp: { messagesPerBatch: 3, delayBetweenMessages: 15, delayBetweenBatches: 600, maxMessagesPerHour: 20, maxMessagesPerDay: 80 },
  slack: { messagesPerBatch: 30, delayBetweenMessages: 1, delayBetweenBatches: 30, maxMessagesPerHour: 200, maxMessagesPerDay: 2000 },
  gmail: { messagesPerBatch: 5, delayBetweenMessages: 8, delayBetweenBatches: 180, maxMessagesPerHour: 80, maxMessagesPerDay: 400 },
};

// ─── Redis connections ───

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

// Separate connection for pub/sub notifications
const pubClient = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');

// ─── Logger ───

const log = {
  info: (msg: string, data?: Record<string, unknown>) => console.log(`[INFO] ${msg}`, data ?? ''),
  warn: (msg: string, data?: Record<string, unknown>) => console.warn(`[WARN] ${msg}`, data ?? ''),
  error: (msg: string, data?: Record<string, unknown>) => console.error(`[ERROR] ${msg}`, data ?? ''),
};

// ─── Types ───

interface BroadcastSendPayload {
  broadcastId: string;
  organizationId: string;
}

interface MessageSyncPayload {
  chatIds: string[];
  integrationId: string;
  organizationId: string;
  messenger: string;
}

interface AntibanConfig {
  messagesPerBatch: number;
  delayBetweenMessages: number;
  delayBetweenBatches: number;
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  autoRetryEnabled: boolean;
  maxRetryAttempts: number;
  retryWindowHours: number;
}

// ─── Helpers ───

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Get antiban settings for a messenger+org, falling back to defaults.
 */
async function getAntibanSettings(
  messenger: string,
  organizationId: string,
): Promise<AntibanConfig> {
  const stored = await prisma.antibanSettings.findUnique({
    where: {
      messenger_organizationId: { messenger, organizationId },
    },
  });

  if (stored) {
    return {
      messagesPerBatch: stored.messagesPerBatch,
      delayBetweenMessages: stored.delayBetweenMessages,
      delayBetweenBatches: stored.delayBetweenBatches,
      maxMessagesPerHour: stored.maxMessagesPerHour,
      maxMessagesPerDay: stored.maxMessagesPerDay,
      autoRetryEnabled: stored.autoRetryEnabled,
      maxRetryAttempts: stored.maxRetryAttempts,
      retryWindowHours: stored.retryWindowHours,
    };
  }

  const defaults = DEFAULT_ANTIBAN[messenger as Messenger];
  if (!defaults) {
    // Unknown messenger, use conservative defaults
    return {
      messagesPerBatch: 5,
      delayBetweenMessages: 10,
      delayBetweenBatches: 300,
      maxMessagesPerHour: 30,
      maxMessagesPerDay: 200,
      autoRetryEnabled: true,
      maxRetryAttempts: 3,
      retryWindowHours: 6,
    };
  }

  return {
    ...defaults,
    autoRetryEnabled: true,
    maxRetryAttempts: 3,
    retryWindowHours: 6,
  };
}

/**
 * Emit broadcast status via Redis pub/sub. The API's WebSocket server
 * subscribes to these events and pushes them to connected browsers.
 */
function emitBroadcastStatus(
  organizationId: string,
  broadcastId: string,
  status: string,
  extra?: Record<string, unknown>,
) {
  const payload = JSON.stringify({
    event: 'broadcast_status',
    room: `org:${organizationId}`,
    data: { broadcastId, status, ...extra },
  });
  pubClient.publish('ws:events', payload).catch((err) => {
    log.warn('Failed to publish broadcast status', { error: String(err) });
  });
}

/**
 * Send messages to a group of BroadcastChats for a single messenger,
 * respecting antiban rate limits.
 */
async function sendMessengerBatch(
  broadcastId: string,
  organizationId: string,
  messageText: string,
  messengerChats: Array<{ id: string; chatId: string; chat: { externalChatId: string; messenger: string }; retryCount: number }>,
  antibanConfig: AntibanConfig,
  isRetry: boolean,
  attachments?: Array<{ url: string; filename: string; mimeType: string; size: number }>,
): Promise<{ sent: number; failed: number }> {
  const messenger = messengerChats[0]?.chat.messenger;
  if (!messenger || messengerChats.length === 0) return { sent: 0, failed: 0 };

  // Find integration credentials for this messenger + org
  const integration = await prisma.integration.findFirst({
    where: {
      messenger,
      organizationId,
      status: 'connected',
    },
  });

  let adapter;
  try {
    if (integration) {
      const credentials = decryptCredentials<Record<string, unknown>>(
        integration.credentials as string,
      );
      adapter = await createAdapter(messenger, credentials);
    } else {
      throw new Error(`No connected integration found for ${messenger}`);
    }
    await adapter.connect();
  } catch (err) {
    // If adapter fails to connect, mark all chats as failed
    log.error(`Failed to connect ${messenger} adapter`, { error: String(err) });
    await prisma.broadcastChat.updateMany({
      where: { id: { in: messengerChats.map((c) => c.id) } },
      data: {
        status: 'failed',
        errorReason: `Adapter connection failed: ${err instanceof Error ? err.message : String(err)}`,
      },
    });
    return { sent: 0, failed: messengerChats.length };
  }

  let sent = 0;
  let failed = 0;
  let hourlyCount = 0;
  let dailyCount = 0;
  let batchCount = 0;

  const { messagesPerBatch, delayBetweenMessages, delayBetweenBatches, maxMessagesPerHour, maxMessagesPerDay } = antibanConfig;

  for (let i = 0; i < messengerChats.length; i++) {
    const bc = messengerChats[i]!;

    // Check hourly/daily limits
    if (hourlyCount >= maxMessagesPerHour) {
      log.info(`Hourly limit reached for ${messenger}, waiting 60 seconds`, { broadcastId });
      await sleep(60);
      hourlyCount = 0;
    }
    if (dailyCount >= maxMessagesPerDay) {
      log.warn(`Daily limit reached for ${messenger}, stopping batch`, { broadcastId });
      // Mark remaining as pending so they can be retried later
      const remainingIds = messengerChats.slice(i).map((c) => c.id);
      await prisma.broadcastChat.updateMany({
        where: { id: { in: remainingIds } },
        data: { status: 'pending', errorReason: 'Daily limit reached, will retry' },
      });
      break;
    }

    // Batch boundary
    if (batchCount >= messagesPerBatch && batchCount > 0) {
      log.info(`Batch complete (${batchCount}/${messagesPerBatch}), waiting ${delayBetweenBatches}s`, { broadcastId, messenger });
      await sleep(delayBetweenBatches);
      batchCount = 0;
    }

    // Inter-message delay
    if (batchCount > 0) {
      const delay = isRetry
        ? delayBetweenMessages * Math.pow(2, bc.retryCount)
        : delayBetweenMessages;
      await sleep(delay);
    }

    try {
      await adapter.sendMessage(bc.chat.externalChatId, messageText, {
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
      });

      await prisma.broadcastChat.update({
        where: { id: bc.id },
        data: { status: 'sent', sentAt: new Date(), errorReason: null },
      });

      sent++;
      batchCount++;
      hourlyCount++;
      dailyCount++;
    } catch (err) {
      const errorReason = err instanceof Error ? err.message : String(err);
      log.warn(`Failed to send to chat ${bc.chatId}`, { broadcastId, messenger, error: errorReason });

      await prisma.broadcastChat.update({
        where: { id: bc.id },
        data: {
          status: 'failed',
          errorReason,
          retryCount: bc.retryCount + (isRetry ? 1 : 0),
        },
      });

      failed++;
      batchCount++;
      hourlyCount++;
      dailyCount++;
    }

    // Emit progress periodically (every 10 messages)
    if ((sent + failed) % 10 === 0) {
      emitBroadcastStatus(organizationId, broadcastId, 'sending', {
        progress: { sent, failed, remaining: messengerChats.length - sent - failed },
      });
    }
  }

  // Disconnect adapter
  try {
    await adapter.disconnect();
  } catch {
    // Non-critical
  }

  return { sent, failed };
}

/**
 * Finalize broadcast: calculate delivery rate and set final status.
 */
async function finalizeBroadcast(broadcastId: string, organizationId: string): Promise<void> {
  const broadcastChats = await prisma.broadcastChat.findMany({
    where: { broadcastId },
    select: { status: true },
  });

  const total = broadcastChats.length;
  const sentCount = broadcastChats.filter((c) => c.status === 'sent').length;
  const failedCount = broadcastChats.filter((c) =>
    c.status === 'failed' || c.status === 'retry_exhausted',
  ).length;
  const pendingCount = broadcastChats.filter((c) =>
    c.status === 'pending' || c.status === 'retrying',
  ).length;

  const deliveryRate = total > 0 ? sentCount / total : 0;

  let status: string;
  if (pendingCount > 0) {
    // Some chats still pending (hit daily limit); keep as sending
    status = 'sending';
  } else if (sentCount === total) {
    status = 'sent';
  } else if (sentCount === 0) {
    status = 'failed';
  } else {
    status = 'partially_failed';
  }

  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: {
      status,
      deliveryRate,
      sentAt: status !== 'sending' ? new Date() : undefined,
    },
  });

  emitBroadcastStatus(organizationId, broadcastId, status, {
    deliveryRate,
    stats: { total, sent: sentCount, failed: failedCount, pending: pendingCount },
  });

  log.info(`Broadcast ${broadcastId} finalized`, {
    status,
    deliveryRate,
    total,
    sent: sentCount,
    failed: failedCount,
  });
}

// ─── Job Processors ───

async function processBroadcastSend(job: Job<BroadcastSendPayload>): Promise<void> {
  const { broadcastId, organizationId } = job.data;
  log.info(`Processing broadcast:send`, { broadcastId, organizationId });

  // Load broadcast (idempotency: check it's still in sending or scheduled state)
  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId, organizationId },
  });

  if (!broadcast) {
    log.warn('Broadcast not found, skipping', { broadcastId });
    return;
  }

  // If scheduled, update to sending now
  if (broadcast.status === 'scheduled' || broadcast.status === 'draft') {
    await prisma.broadcast.update({
      where: { id: broadcastId },
      data: { status: 'sending', sentAt: new Date() },
    });
  } else if (broadcast.status !== 'sending') {
    log.warn(`Broadcast is in unexpected status "${broadcast.status}", skipping`, { broadcastId });
    return;
  }

  // Load pending BroadcastChats with chat info
  const pendingChats = await prisma.broadcastChat.findMany({
    where: { broadcastId, status: 'pending' },
    include: {
      chat: {
        select: { id: true, externalChatId: true, messenger: true },
      },
    },
  });

  if (pendingChats.length === 0) {
    log.info('No pending chats to process', { broadcastId });
    await finalizeBroadcast(broadcastId, organizationId);
    return;
  }

  // Group by messenger
  const byMessenger = new Map<string, typeof pendingChats>();
  for (const bc of pendingChats) {
    const m = bc.chat.messenger;
    const arr = byMessenger.get(m) ?? [];
    arr.push(bc);
    byMessenger.set(m, arr);
  }

  // Process each messenger group
  for (const [messenger, chats] of byMessenger) {
    const antibanConfig = await getAntibanSettings(messenger, organizationId);
    log.info(`Sending ${chats.length} messages via ${messenger}`, { broadcastId });

    // Parse attachments from broadcast JSON field
    const broadcastAttachments = Array.isArray(broadcast.attachments)
      ? (broadcast.attachments as Array<{ url: string; filename?: string; originalName?: string; mimeType: string; size: number }>).map(a => ({
          url: a.url,
          filename: a.filename || a.originalName || 'attachment',
          mimeType: a.mimeType,
          size: a.size,
        }))
      : undefined;

    await sendMessengerBatch(
      broadcastId,
      organizationId,
      broadcast.messageText,
      chats.map((c) => ({
        id: c.id,
        chatId: c.chatId,
        chat: { externalChatId: c.chat.externalChatId, messenger: c.chat.messenger },
        retryCount: c.retryCount,
      })),
      antibanConfig,
      false,
      broadcastAttachments,
    );
  }

  // Finalize
  await finalizeBroadcast(broadcastId, organizationId);
}

async function processBroadcastRetry(job: Job<BroadcastSendPayload>): Promise<void> {
  const { broadcastId, organizationId } = job.data;
  log.info('Processing broadcast:retry', { broadcastId, organizationId });

  const broadcast = await prisma.broadcast.findFirst({
    where: { id: broadcastId, organizationId },
  });

  if (!broadcast) {
    log.warn('Broadcast not found, skipping retry', { broadcastId });
    return;
  }

  // Load retrying BroadcastChats
  const retryingChats = await prisma.broadcastChat.findMany({
    where: { broadcastId, status: 'retrying' },
    include: {
      chat: {
        select: { id: true, externalChatId: true, messenger: true },
      },
    },
  });

  if (retryingChats.length === 0) {
    log.info('No retrying chats to process', { broadcastId });
    await finalizeBroadcast(broadcastId, organizationId);
    return;
  }

  // Group by messenger
  const byMessenger = new Map<string, typeof retryingChats>();
  for (const bc of retryingChats) {
    const m = bc.chat.messenger;
    const arr = byMessenger.get(m) ?? [];
    arr.push(bc);
    byMessenger.set(m, arr);
  }

  for (const [messenger, chats] of byMessenger) {
    const antibanConfig = await getAntibanSettings(messenger, organizationId);

    // Filter out chats that have exceeded max retry attempts
    const retriable: typeof chats = [];
    const exhausted: typeof chats = [];

    for (const bc of chats) {
      if (bc.retryCount >= antibanConfig.maxRetryAttempts) {
        exhausted.push(bc);
      } else {
        retriable.push(bc);
      }
    }

    // Mark exhausted chats
    if (exhausted.length > 0) {
      await prisma.broadcastChat.updateMany({
        where: { id: { in: exhausted.map((c) => c.id) } },
        data: { status: 'retry_exhausted' },
      });
      log.info(`${exhausted.length} chats exhausted retries for ${messenger}`, { broadcastId });
    }

    if (retriable.length > 0) {
      log.info(`Retrying ${retriable.length} messages via ${messenger}`, { broadcastId });

      const retryAttachments = Array.isArray(broadcast.attachments)
        ? (broadcast.attachments as Array<{ url: string; filename?: string; originalName?: string; mimeType: string; size: number }>).map(a => ({
            url: a.url,
            filename: a.filename || a.originalName || 'attachment',
            mimeType: a.mimeType,
            size: a.size,
          }))
        : undefined;

      await sendMessengerBatch(
        broadcastId,
        organizationId,
        broadcast.messageText,
        retriable.map((c) => ({
          id: c.id,
          chatId: c.chatId,
          chat: { externalChatId: c.chat.externalChatId, messenger: c.chat.messenger },
          retryCount: c.retryCount,
        })),
        antibanConfig,
        true,
        retryAttachments,
      );
    }
  }

  // Finalize
  await finalizeBroadcast(broadcastId, organizationId);
}

// ─── Chat History Sync Processor ───

async function processChatHistorySync(job: Job<MessageSyncPayload>): Promise<void> {
  const { chatIds, integrationId, organizationId, messenger } = job.data;
  log.info('Processing sync:chat-history', { integrationId, chatCount: chatIds.length });

  // Load integration credentials
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { credentials: true, messenger: true },
  });

  if (!integration) {
    log.warn('Integration not found, skipping history sync', { integrationId });
    return;
  }

  const credentials = decryptCredentials<Record<string, unknown>>(integration.credentials as string);
  const adapter = await createAdapter(messenger, credentials);

  try {
    await adapter.connect();
  } catch (err) {
    log.error('Failed to connect adapter for history sync', { error: String(err) });
    // Mark all chats as failed
    await prisma.chat.updateMany({
      where: { id: { in: chatIds } },
      data: { syncStatus: 'failed' },
    });
    return;
  }

  // Check if adapter supports getMessages
  if (!adapter.getMessages) {
    log.info(`Adapter for ${messenger} does not support history fetch, marking as synced`);
    await prisma.chat.updateMany({
      where: { id: { in: chatIds } },
      data: { syncStatus: 'synced' },
    });
    try { await adapter.disconnect(); } catch {}
    return;
  }

  // Resolve sender names for Telegram (has getSenderName method)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hasSenderNameResolver = 'getSenderName' in adapter && typeof (adapter as any).getSenderName === 'function';

  for (const chatId of chatIds) {
    try {
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { id: true, externalChatId: true, syncCursor: true, syncStatus: true },
      });

      if (!chat) continue;

      // Skip already synced chats
      if (chat.syncStatus === 'synced') continue;

      // Mark as syncing
      await prisma.chat.update({
        where: { id: chat.id },
        data: { syncStatus: 'syncing' },
      });

      log.info(`Syncing full history for chat ${chat.externalChatId}`, { chatId });

      let cursor = chat.syncCursor ?? undefined;
      let totalSynced = 0;
      let batchNumber = 0;
      const senderNameCache = new Map<string, string>();

      // Pagination loop — fetch all history
      while (true) {
        batchNumber++;
        let result;

        try {
          result = await adapter.getMessages!(chat.externalChatId, 100, cursor);
        } catch (err) {
          const errMsg = String(err);
          if (errMsg.includes('FloodWait') || errMsg.includes('FLOOD_WAIT')) {
            const waitMatch = errMsg.match(/(\d+)/);
            const waitSeconds = waitMatch ? parseInt(waitMatch[1]!, 10) : 30;
            log.warn(`FloodWait: waiting ${waitSeconds}s`, { chatId, batch: batchNumber });
            await sleep(Math.min(waitSeconds, 120));
            continue; // retry same cursor
          }
          log.error(`Failed to fetch batch ${batchNumber} for chat ${chatId}`, { error: errMsg });
          break; // stop pagination for this chat
        }

        if (result.messages.length === 0) {
          log.info(`No more messages in batch ${batchNumber}`, { chatId });
          break;
        }

        // Resolve sender names if supported (e.g. Telegram)
        if (hasSenderNameResolver) {
          for (const msg of result.messages) {
            if (msg.senderId && !msg.senderName && !senderNameCache.has(msg.senderId)) {
              try {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const name = await (adapter as any).getSenderName(msg.senderId);
                senderNameCache.set(msg.senderId, name);
              } catch {
                senderNameCache.set(msg.senderId, 'Unknown');
              }
            }
          }
        }

        // Bulk insert with deduplication
        await prisma.message.createMany({
          data: result.messages.map((m) => ({
            chatId: chat.id,
            externalMessageId: m.id,
            senderName: m.senderName ?? senderNameCache.get(m.senderId) ?? 'Unknown',
            senderExternalId: m.senderId,
            isSelf: m.isSelf,
            text: m.text,
            createdAt: m.date,
          })),
          skipDuplicates: true,
        });

        totalSynced += result.messages.length;

        // Save cursor for resume capability
        await prisma.chat.update({
          where: { id: chat.id },
          data: { syncCursor: result.nextCursor ?? null },
        });

        // Notify frontend every batch
        pubClient.publish('ws:events', JSON.stringify({
          event: 'chat_updated',
          room: `org:${organizationId}`,
          data: { chatId: chat.id },
        })).catch(() => {});

        log.info(`Batch ${batchNumber}: synced ${result.messages.length} messages (total: ${totalSynced})`, { chatId });

        // Check if we've exhausted history
        if (!result.hasMore || !result.nextCursor) {
          break;
        }

        cursor = result.nextCursor;

        // Small delay between batches to avoid rate limiting
        await sleep(1);
      }

      // Update chat metadata
      const totalMessages = await prisma.message.count({ where: { chatId: chat.id } });
      const latestMessage = await prisma.message.findFirst({
        where: { chatId: chat.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      await prisma.chat.update({
        where: { id: chat.id },
        data: {
          syncStatus: 'synced',
          syncCursor: null,
          messageCount: totalMessages,
          lastActivityAt: latestMessage?.createdAt ?? new Date(),
        },
      });

      // Final frontend notification
      pubClient.publish('ws:events', JSON.stringify({
        event: 'chat_updated',
        room: `org:${organizationId}`,
        data: { chatId: chat.id },
      })).catch(() => {});

      log.info(`History sync complete for chat ${chatId}: ${totalSynced} messages synced`);
    } catch (err) {
      log.error(`Error syncing chat ${chatId}`, { error: String(err) });
      await prisma.chat.update({
        where: { id: chatId },
        data: { syncStatus: 'failed' },
      }).catch(() => {});
    }
  }

  // Disconnect adapter
  try {
    await adapter.disconnect();
  } catch {}

  log.info('Chat history sync job complete', { chatCount: chatIds.length });
}

// ─── Worker Setup ───

log.info('Worker service starting...');

const worker = new Worker<BroadcastSendPayload>(
  'broadcast',
  async (job) => {
    switch (job.name) {
      case 'broadcast:send':
        await processBroadcastSend(job);
        break;
      case 'broadcast:retry':
        await processBroadcastRetry(job);
        break;
      default:
        log.warn(`Unknown job name: ${job.name}`, { jobId: job.id });
    }
  },
  {
    connection,
    concurrency: 3,
    limiter: {
      max: 5,
      duration: 1000,
    },
  },
);

// ─── Message Sync Worker ───

const messageSyncWorker = new Worker<MessageSyncPayload>(
  'message-sync',
  async (job) => {
    if (job.name === 'sync:chat-history') {
      await processChatHistorySync(job);
    } else {
      log.warn(`Unknown message-sync job name: ${job.name}`, { jobId: job.id });
    }
  },
  {
    connection,
    concurrency: 2,
  },
);

messageSyncWorker.on('completed', (job) => {
  log.info(`Message sync job ${job.id} completed`);
});

messageSyncWorker.on('failed', (job, err) => {
  log.error(`Message sync job ${job?.id} failed`, { error: err.message });
});

messageSyncWorker.on('error', (err) => {
  log.error('Message sync worker error', { error: err.message });
});

log.info('Message sync worker ready, listening for jobs');

// ─── Worker Events ───

worker.on('completed', (job) => {
  log.info(`Job ${job.id} (${job.name}) completed`, {
    broadcastId: job.data.broadcastId,
  });
});

worker.on('failed', (job, err) => {
  log.error(`Job ${job?.id} (${job?.name}) failed`, {
    broadcastId: job?.data.broadcastId,
    error: err.message,
  });

  // If the job itself failed (not individual messages), update broadcast status
  if (job?.data.broadcastId) {
    prisma.broadcast.update({
      where: { id: job.data.broadcastId },
      data: { status: 'failed' },
    }).catch((updateErr) => {
      log.error('Failed to update broadcast status after job failure', {
        error: String(updateErr),
      });
    });

    emitBroadcastStatus(
      job.data.organizationId,
      job.data.broadcastId,
      'failed',
    );
  }
});

worker.on('error', (err) => {
  log.error('Worker error', { error: err.message });
});

log.info('Broadcast worker ready, listening for jobs');

// ─── Startup Recovery ───
// On startup, find any overdue scheduled broadcasts and enqueue them.
// This handles the case where the worker was down when a scheduled time arrived.

async function recoverOverdueScheduledBroadcasts(): Promise<void> {
  try {
    const broadcastQueue = new Queue('broadcast', { connection });

    const overdue = await prisma.broadcast.findMany({
      where: {
        status: 'scheduled',
        scheduledAt: { lte: new Date() },
      },
      select: { id: true, organizationId: true },
    });

    if (overdue.length === 0) return;

    log.info(`Recovering ${overdue.length} overdue scheduled broadcast(s)`);

    for (const b of overdue) {
      const jobId = `broadcast-recovery-${b.id}-${Date.now()}`;
      await broadcastQueue.add(
        'broadcast:send',
        { broadcastId: b.id, organizationId: b.organizationId },
        { jobId },
      );
      log.info(`Queued overdue broadcast ${b.id}`);
    }

    await broadcastQueue.close();
  } catch (err) {
    log.error('Failed to recover overdue broadcasts', { error: String(err) });
  }
}

// ─── Chat Sync Startup Recovery ───
// On startup, find chats with pending/syncing/failed sync status and queue sync jobs.

async function recoverPendingChatSyncs(): Promise<void> {
  try {
    const messageSyncQueue = new Queue('message-sync', { connection });

    // Find all chats that need syncing (grouped by org + messenger)
    const pendingChats = await prisma.chat.findMany({
      where: {
        syncStatus: { in: ['pending', 'syncing', 'failed'] },
        deletedAt: null,
      },
      select: { id: true, organizationId: true, messenger: true },
    });

    if (pendingChats.length === 0) {
      await messageSyncQueue.close();
      return;
    }

    log.info(`Recovering ${pendingChats.length} chat(s) needing history sync`);

    // Group by org + messenger to find matching integrations
    const groups = new Map<string, { orgId: string; messenger: string; chatIds: string[] }>();
    for (const chat of pendingChats) {
      const key = `${chat.organizationId}:${chat.messenger}`;
      if (!groups.has(key)) {
        groups.set(key, { orgId: chat.organizationId, messenger: chat.messenger, chatIds: [] });
      }
      groups.get(key)!.chatIds.push(chat.id);
    }

    for (const [, group] of groups) {
      // Find the connected integration for this org + messenger
      const integration = await prisma.integration.findFirst({
        where: {
          organizationId: group.orgId,
          messenger: group.messenger,
          status: 'connected',
        },
        select: { id: true },
      });

      if (!integration) {
        log.warn(`No connected integration for ${group.messenger} in org ${group.orgId}, skipping sync`);
        continue;
      }

      const jobId = `sync-recovery-${group.orgId}-${group.messenger}-${Date.now()}`;
      await messageSyncQueue.add(
        'sync:chat-history',
        {
          chatIds: group.chatIds,
          integrationId: integration.id,
          organizationId: group.orgId,
          messenger: group.messenger,
        },
        { jobId },
      );
      log.info(`Queued history sync for ${group.chatIds.length} ${group.messenger} chats in org ${group.orgId}`);
    }

    await messageSyncQueue.close();
  } catch (err) {
    log.error('Failed to recover pending chat syncs', { error: String(err) });
  }
}

// Run recovery after a short delay to ensure worker is fully ready
setTimeout(() => {
  recoverOverdueScheduledBroadcasts().catch((err) => {
    log.error('Startup recovery error', { error: String(err) });
  });
  recoverPendingChatSyncs().catch((err) => {
    log.error('Chat sync recovery error', { error: String(err) });
  });
}, 5000);

// ─── Graceful Shutdown ───

async function shutdown(signal: string) {
  log.info(`Received ${signal}, shutting down gracefully`);

  // Close workers first (waits for active jobs to finish, up to 30s)
  await Promise.allSettled([worker.close(), messageSyncWorker.close()]);
  log.info('Workers closed');

  // Disconnect from databases
  await prisma.$disconnect();
  await pubClient.quit();
  await connection.quit();

  log.info('All connections closed');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
