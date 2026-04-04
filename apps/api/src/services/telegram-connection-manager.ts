// ─── Telegram Connection Manager ───
// Maintains persistent gramjs client connections for all connected Telegram
// integrations. Registers NewMessage event handlers so incoming messages
// are saved and pushed to the frontend in real time.

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, type NewMessageEvent, Raw } from 'telegram/events/index.js';
import prisma from '../lib/prisma.js';
import { decryptCredentials } from '../lib/crypto.js';
import { saveIncomingMessage, ingestReaction } from './message-service.js';

interface ActiveClient {
  client: TelegramClient;
  integrationId: string;
  organizationId: string;
  userId: string;
  selfId: string; // stored as string for safe comparison
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAYS = [5_000, 10_000, 30_000, 60_000, 60_000];

// ─── Singleton ───

let manager: TelegramConnectionManager | null = null;

export function getTelegramManager(): TelegramConnectionManager {
  if (!manager) {
    manager = new TelegramConnectionManager();
  }
  return manager;
}

// ─── Helper: extract chat ID from peerId ───

function extractChatId(peerId: Api.TypePeer): string {
  if (peerId instanceof Api.PeerUser) {
    return peerId.userId.toString();
  }
  if (peerId instanceof Api.PeerChat) {
    return (-Number(peerId.chatId)).toString();
  }
  if (peerId instanceof Api.PeerChannel) {
    // Channels use -100 prefix convention
    return `-100${peerId.channelId.toString()}`;
  }
  return '';
}

// ─── Manager ───

export class TelegramConnectionManager {
  private clients = new Map<string, ActiveClient>();
  private senderNameCache = new Map<string, { name: string; expiry: number }>();

  /**
   * On API startup, connect all Telegram integrations that are marked as connected.
   */
  async startAll(): Promise<void> {
    const integrations = await prisma.integration.findMany({
      where: { messenger: 'telegram', status: 'connected' },
      select: { id: true },
    });

    console.log(`[TelegramManager] Starting listeners for ${integrations.length} integration(s)`);

    for (const integration of integrations) {
      try {
        await this.startListening(integration.id);
      } catch (err) {
        console.error(`[TelegramManager] Failed to start listener for integration ${integration.id}:`, err);
      }
    }
  }

  /**
   * Start listening for messages on a specific integration.
   */
  async startListening(integrationId: string): Promise<void> {
    // Already listening?
    if (this.clients.has(integrationId)) {
      return;
    }

    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { id: true, credentials: true, organizationId: true, userId: true, messenger: true },
    });

    if (!integration || integration.messenger !== 'telegram') {
      return;
    }

    let credentials: { apiId: number; apiHash: string; session?: string };
    try {
      credentials = decryptCredentials(integration.credentials as string);
    } catch (err) {
      console.error(`[TelegramManager] Failed to decrypt credentials for ${integrationId}:`, err);
      return;
    }

    if (!credentials.apiId || !credentials.apiHash || !credentials.session) {
      console.warn(`[TelegramManager] Incomplete credentials for ${integrationId}, skipping`);
      return;
    }

    const session = new StringSession(credentials.session);
    const client = new TelegramClient(session, credentials.apiId, credentials.apiHash, {
      connectionRetries: 5,
    });

    try {
      await client.connect();

      const authorized = await client.isUserAuthorized();
      if (!authorized) {
        console.warn(`[TelegramManager] Session expired for ${integrationId}`);
        await prisma.integration.update({
          where: { id: integrationId },
          data: { status: 'session_expired' },
        });
        await client.disconnect().catch(() => {});
        return;
      }

      // Get self user ID to distinguish own messages
      const me = await client.getMe() as Api.User;
      const selfId = me.id.toString();

      const activeClient: ActiveClient = {
        client,
        integrationId,
        organizationId: integration.organizationId,
        userId: integration.userId,
        selfId,
        reconnectAttempts: 0,
        reconnectTimer: null,
      };

      // Register NewMessage event handler
      client.addEventHandler(
        (event: NewMessageEvent) => this.handleNewMessage(event, activeClient),
        new NewMessage({}),
      );

      // Register UpdateMessageReactions event handler for incoming reactions
      client.addEventHandler(
        (update: Api.TypeUpdate) => this.handleReactionUpdate(update, activeClient),
        new Raw({ types: [Api.UpdateMessageReactions] }),
      );

      this.clients.set(integrationId, activeClient);
      console.log(`[TelegramManager] Listening on integration ${integrationId} (selfId: ${selfId})`);
    } catch (err) {
      console.error(`[TelegramManager] Failed to connect for ${integrationId}:`, err);
      await client.disconnect().catch(() => {});
    }
  }

  /**
   * Stop listening for messages on a specific integration.
   */
  async stopListening(integrationId: string): Promise<void> {
    const active = this.clients.get(integrationId);
    if (!active) return;

    if (active.reconnectTimer) {
      clearTimeout(active.reconnectTimer);
    }

    try {
      await active.client.disconnect();
    } catch {
      // Non-critical
    }

    this.clients.delete(integrationId);
    console.log(`[TelegramManager] Stopped listening on integration ${integrationId}`);
  }

  /**
   * Shutdown all connections (for graceful server stop).
   */
  async shutdown(): Promise<void> {
    console.log(`[TelegramManager] Shutting down ${this.clients.size} connection(s)`);
    const promises: Promise<void>[] = [];
    for (const [id] of this.clients) {
      promises.push(this.stopListening(id));
    }
    await Promise.allSettled(promises);
  }

  // ─── Event handler ───

  private async handleNewMessage(event: NewMessageEvent, active: ActiveClient): Promise<void> {
    try {
      const msg = event.message;
      if (!msg || !msg.peerId) return;

      const externalChatId = extractChatId(msg.peerId);
      if (!externalChatId) return;

      const externalMessageId = msg.id.toString();
      const senderId = msg.senderId ? msg.senderId.toString() : '';
      const isSelf = senderId === active.selfId;
      const text = msg.text || '';

      // Resolve sender name with caching and timeout
      let senderName = 'Unknown';
      if (msg.senderId) {
        const cached = this.senderNameCache.get(senderId);
        if (cached && cached.expiry > Date.now()) {
          senderName = cached.name;
        } else {
          try {
            const entityPromise = active.client.getEntity(msg.senderId);
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('timeout')), 3000),
            );
            const entity = await Promise.race([entityPromise, timeoutPromise]);
            if (entity instanceof Api.User) {
              senderName = [entity.firstName, entity.lastName].filter(Boolean).join(' ') || 'Unknown';
            } else if (entity && 'title' in (entity as unknown as Record<string, unknown>)) {
              senderName = (entity as unknown as { title: string }).title || 'Unknown';
            }
            this.senderNameCache.set(senderId, { name: senderName, expiry: Date.now() + 600_000 });
          } catch {
            // Use stale cache or 'Unknown' — don't block message delivery
            if (cached) senderName = cached.name;
          }
        }
      }

      // Find all orgs that have this chat imported
      const importedChats = await prisma.chat.findMany({
        where: { externalChatId, messenger: 'telegram' },
        select: { organizationId: true },
      });

      // Save to all orgs in parallel
      await Promise.allSettled(
        importedChats.map((ic) =>
          saveIncomingMessage({
            externalChatId,
            messenger: 'telegram',
            organizationId: ic.organizationId,
            senderName,
            senderExternalId: senderId,
            text,
            externalMessageId,
            isSelf,
          }),
        ),
      );
    } catch (err) {
      console.error('[TelegramManager] Error handling incoming message:', err);
    }
  }

  private async handleReactionUpdate(update: Api.TypeUpdate, active: ActiveClient): Promise<void> {
    try {
      if (!(update instanceof Api.UpdateMessageReactions)) return;

      const msgId = update.msgId.toString();
      const peerId = update.peer;
      const externalChatId = extractChatId(peerId);
      if (!externalChatId) return;

      const reactions = update.reactions;
      if (!reactions) return;

      // Telegram sends current state, not diffs. Diff against DB to detect adds and removes.
      const recentReactions = reactions.recentReactions ?? [];

      // Build set of current reactions from the update
      const incomingReactions = new Map<string, string[]>(); // senderId -> emoji[]
      for (const recent of recentReactions) {
        if (!(recent.reaction instanceof Api.ReactionEmoji)) continue;
        const senderId = recent.peerId instanceof Api.PeerUser
          ? recent.peerId.userId.toString()
          : '';
        if (!senderId || senderId === active.selfId) continue;

        if (!incomingReactions.has(senderId)) incomingReactions.set(senderId, []);
        incomingReactions.get(senderId)!.push(recent.reaction.emoticon);
      }

      // For each external user in the update, diff against DB
      for (const [senderId, emojis] of incomingReactions) {
        const existing = await prisma.reaction.findMany({
          where: {
            message: { externalMessageId: msgId },
            externalUserId: senderId,
          },
          select: { emoji: true },
        });
        const existingEmojis = new Set(existing.map((r) => r.emoji));
        const incomingEmojis = new Set(emojis);

        // Add new reactions
        for (const emoji of incomingEmojis) {
          if (!existingEmojis.has(emoji)) {
            await ingestReaction({
              externalMessageId: msgId,
              messenger: 'telegram',
              externalUserId: senderId,
              emoji,
              action: 'add',
            });
          }
        }

        // Remove reactions no longer present
        for (const emoji of existingEmojis) {
          if (!incomingEmojis.has(emoji)) {
            await ingestReaction({
              externalMessageId: msgId,
              messenger: 'telegram',
              externalUserId: senderId,
              emoji,
              action: 'remove',
            });
          }
        }
      }
    } catch (err) {
      console.error('[TelegramManager] Error handling reaction update:', err);
    }
  }

  // ─── Reconnection (can be called if disconnect detected) ───

  private scheduleReconnect(integrationId: string): void {
    const active = this.clients.get(integrationId);
    if (!active) return;

    if (active.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[TelegramManager] Max reconnect attempts reached for ${integrationId}, marking disconnected`);
      this.clients.delete(integrationId);
      prisma.integration.update({
        where: { id: integrationId },
        data: { status: 'disconnected' },
      }).catch(() => {});
      return;
    }

    const delay = RECONNECT_DELAYS[active.reconnectAttempts] ?? 60_000;
    active.reconnectAttempts++;

    console.log(`[TelegramManager] Reconnecting ${integrationId} in ${delay}ms (attempt ${active.reconnectAttempts})`);

    active.reconnectTimer = setTimeout(async () => {
      this.clients.delete(integrationId);
      try {
        await this.startListening(integrationId);
      } catch (err) {
        console.error(`[TelegramManager] Reconnect failed for ${integrationId}:`, err);
        this.scheduleReconnect(integrationId);
      }
    }, delay);
  }
}
