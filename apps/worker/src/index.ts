import { Worker, type Job } from 'bullmq';
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
      adapter = createAdapter(messenger, credentials);
    } else {
      // No integration found; use stub adapter for development/testing
      adapter = createAdapter(messenger, {});
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
      await adapter.sendMessage(bc.chat.externalChatId, messageText);

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
      );
    }
  }

  // Finalize
  await finalizeBroadcast(broadcastId, organizationId);
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

// ─── Graceful Shutdown ───

async function shutdown(signal: string) {
  log.info(`Received ${signal}, shutting down gracefully`);

  // Close worker first (waits for active jobs to finish, up to 30s)
  await worker.close();
  log.info('Worker closed');

  // Disconnect from databases
  await prisma.$disconnect();
  await pubClient.quit();
  await connection.quit();

  log.info('All connections closed');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
