// ─── Telegram Connection Manager ───
// Maintains persistent gramjs client connections for all connected Telegram
// integrations. Registers NewMessage event handlers so incoming messages
// are saved and pushed to the frontend in real time.

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, type NewMessageEvent, Raw } from 'telegram/events/index.js';
import prisma from '../lib/prisma.js';
import { decryptCredentials } from '../lib/crypto.js';
import { getPlatformCredentials } from '../lib/platform-credentials.js';
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
    // If a client is already registered for this integration (e.g. credentials
    // were just rotated by a connect/reconnect flow), stop it first so the new
    // session can take over. Otherwise messages from the old session keep
    // flowing because the old TelegramClient is still connected.
    if (this.clients.has(integrationId)) {
      await this.stopListening(integrationId);
    }

    const integration = await prisma.integration.findUnique({
      where: { id: integrationId },
      select: { id: true, credentials: true, organizationId: true, userId: true, messenger: true },
    });

    if (!integration || integration.messenger !== 'telegram') {
      return;
    }

    // User-level credentials: session + phone. apiId/apiHash live in
    // PlatformConfig (or env fallback) so they can be rotated centrally.
    let credentials: { session?: string; phoneNumber?: string };
    try {
      credentials = decryptCredentials(integration.credentials as string);
    } catch (err) {
      console.error(`[TelegramManager] Failed to decrypt credentials for ${integrationId}:`, err);
      return;
    }

    if (!credentials.session) {
      console.warn(`[TelegramManager] Missing session for ${integrationId}, skipping`);
      return;
    }

    const platform = await getPlatformCredentials('telegram');
    const apiIdRaw = platform.credentials?.apiId;
    const apiHash = platform.credentials?.apiHash;
    if (!apiIdRaw || !apiHash) {
      console.warn(
        `[TelegramManager] Platform apiId/apiHash not configured — cannot start ${integrationId}`,
      );
      return;
    }
    const apiId = Number(apiIdRaw);
    if (!Number.isFinite(apiId) || apiId <= 0) {
      console.warn(`[TelegramManager] Invalid platform apiId for ${integrationId}`);
      return;
    }

    const session = new StringSession(credentials.session);
    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: 10,
      retryDelay: 2000,
      autoReconnect: true,
      timeout: 30,
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

      // Monitor disconnections — log for diagnostics
      client.addEventHandler((update: Api.TypeUpdate) => {
        const name = (update as unknown as { className?: string }).className;
        if (name && name.includes('ConnectionState')) {
          console.warn(`[TelegramManager] Connection state change for ${integrationId}:`, name);
        }
      });

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

  /**
   * Get the active TelegramClient for an integration (if connected).
   * Used by the messages route to send messages via the persistent connection
   * instead of creating a conflicting second session.
   */
  getClient(integrationId: string): TelegramClient | null {
    const active = this.clients.get(integrationId);
    return active?.client ?? null;
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

      // Detect media type for preview text when message has no text
      let text = msg.text || '';
      if (!text && msg.media) {
        if (msg.media instanceof Api.MessageMediaPhoto) {
          text = '📷 Photo';
        } else if (msg.media instanceof Api.MessageMediaDocument) {
          const doc = msg.media.document;
          if (doc && doc instanceof Api.Document) {
            const attrs = doc.attributes || [];
            const isSticker = attrs.some((a: Api.TypeDocumentAttribute) => a instanceof Api.DocumentAttributeSticker);
            const isAnimated = attrs.some((a: Api.TypeDocumentAttribute) => a instanceof Api.DocumentAttributeAnimated);
            const isVideo = attrs.some((a: Api.TypeDocumentAttribute) => a instanceof Api.DocumentAttributeVideo);
            const isAudio = attrs.some((a: Api.TypeDocumentAttribute) => a instanceof Api.DocumentAttributeAudio);
            if (isSticker) {
              text = '🏷 Sticker';
            } else if (isAnimated || doc.mimeType === 'image/gif') {
              text = 'GIF';
            } else if (isVideo) {
              const isRound = attrs.some((a: Api.TypeDocumentAttribute) => a instanceof Api.DocumentAttributeVideo && a.roundMessage);
              text = isRound ? '🎥 Video message' : '🎬 Video';
            } else if (isAudio) {
              const isVoice = attrs.some((a: Api.TypeDocumentAttribute) => a instanceof Api.DocumentAttributeAudio && a.voice);
              text = isVoice ? '🎤 Voice message' : '🎵 Audio';
            } else {
              text = '📎 File';
            }
          }
        } else if (msg.media instanceof Api.MessageMediaGeo || msg.media instanceof Api.MessageMediaGeoLive) {
          text = '📍 Location';
        } else if (msg.media instanceof Api.MessageMediaContact) {
          text = '👤 Contact';
        } else if (msg.media instanceof Api.MessageMediaPoll) {
          text = '📊 Poll';
        } else {
          text = '📎 Attachment';
        }
      }

      // Resolve sender name — multiple strategies, ordered by cost/reliability
      let senderName = 'Unknown';
      if (msg.senderId) {
        const cached = this.senderNameCache.get(senderId);
        if (cached && cached.expiry > Date.now()) {
          senderName = cached.name;
        } else {
          // Strategy 1: Use _sender from the update payload (no network call)
          const inlineSender = (msg as unknown as { _sender?: Api.TypeUser | { title?: string } })._sender;
          if (inlineSender) {
            if (inlineSender instanceof Api.User) {
              senderName = [inlineSender.firstName, inlineSender.lastName].filter(Boolean).join(' ') || 'Unknown';
            } else if ('title' in inlineSender && inlineSender.title) {
              senderName = inlineSender.title;
            }
          }

          // Strategy 2: If _sender didn't resolve, try getSender() then getEntity()
          if (senderName === 'Unknown') {
            try {
              let entity: Api.TypeUser | { title?: string } | undefined;
              // getSender() uses GramJS internal cache first, then network
              try {
                entity = await Promise.race([
                  (msg as unknown as { getSender: () => Promise<Api.TypeUser | undefined> }).getSender(),
                  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
                ]) as Api.TypeUser | { title?: string } | undefined;
              } catch {
                // Fall through to getEntity
              }
              // If getSender didn't work, try getEntity with longer timeout
              if (!entity) {
                entity = await Promise.race([
                  active.client.getEntity(msg.senderId),
                  new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000)),
                ]) as Api.TypeUser | { title?: string } | undefined;
              }
              if (entity) {
                if (entity instanceof Api.User) {
                  senderName = [entity.firstName, entity.lastName].filter(Boolean).join(' ') || 'Unknown';
                } else if ('title' in entity && entity.title) {
                  senderName = entity.title;
                }
              }
            } catch {
              // Use stale cache if available
              if (cached) {
                senderName = cached.name;
              }
            }
          }

          // Cache resolved name (10 min for real names, skip caching Unknown)
          if (senderName !== 'Unknown') {
            this.senderNameCache.set(senderId, { name: senderName, expiry: Date.now() + 600_000 });
          } else if (cached) {
            // Keep using stale cache rather than "Unknown"
            senderName = cached.name;
          }
        }
      }

      // Resolve chat display name — prefer the chat entity's title for groups/channels.
      let chatName = senderName;
      let chatType: 'direct' | 'group' | 'channel' = 'direct';
      if (msg.peerId instanceof Api.PeerChat || msg.peerId instanceof Api.PeerChannel) {
        chatType = msg.peerId instanceof Api.PeerChannel ? 'channel' : 'group';
        try {
          const chatEntity = await Promise.race([
            active.client.getEntity(msg.peerId),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
          ]);
          if (chatEntity && 'title' in (chatEntity as unknown as Record<string, unknown>)) {
            chatName = (chatEntity as unknown as { title: string }).title || senderName;
          }
        } catch {
          // Use senderName as fallback
        }
      }

      // Auto-upsert chat and save — this client is bound to a single (org, user),
      // so multi-tenancy is satisfied by construction.
      await saveIncomingMessage({
        externalChatId,
        messenger: 'telegram',
        organizationId: active.organizationId,
        importedById: active.userId,
        senderName,
        senderExternalId: senderId,
        text,
        externalMessageId,
        isSelf,
        chatName,
        chatType,
      });
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
