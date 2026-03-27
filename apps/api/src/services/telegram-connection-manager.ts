// ─── Telegram Connection Manager ───
// Maintains persistent gramjs client connections for all connected Telegram
// integrations. Registers NewMessage event handlers so incoming messages
// are saved and pushed to the frontend in real time.

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage, type NewMessageEvent } from 'telegram/events/index.js';
import prisma from '../lib/prisma.js';
import { decryptCredentials } from '../lib/crypto.js';
import { saveIncomingMessage } from './message-service.js';

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

      // Resolve sender name
      let senderName = 'Unknown';
      if (msg.senderId) {
        try {
          const entity = await active.client.getEntity(msg.senderId);
          if (entity instanceof Api.User) {
            senderName = [entity.firstName, entity.lastName].filter(Boolean).join(' ') || 'Unknown';
          } else if ('title' in entity) {
            senderName = (entity as { title: string }).title || 'Unknown';
          }
        } catch {
          // Entity resolution can fail for some users; use fallback
        }
      }

      // Find all orgs that have this chat imported
      const importedChats = await prisma.chat.findMany({
        where: { externalChatId, messenger: 'telegram' },
        select: { organizationId: true },
      });

      for (const ic of importedChats) {
        await saveIncomingMessage({
          externalChatId,
          messenger: 'telegram',
          organizationId: ic.organizationId,
          senderName,
          senderExternalId: senderId,
          text,
          externalMessageId,
          isSelf,
        });
      }
    } catch (err) {
      console.error('[TelegramManager] Error handling incoming message:', err);
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
