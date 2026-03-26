// ─── Telegram Adapter (gramjs / MTProto) ───
// Real implementation using the `telegram` (gramjs) package with TelegramClient.
// Supports multi-step interactive auth: sendCode → signIn → optional 2FA.

import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

// ─── Types ───

export interface TelegramCredentials {
  apiId: number;
  apiHash: string;
  session?: string;
  phoneNumber?: string;
}

// ─── Temporary client store for multi-step auth ───
// Key = `${userId}:${phoneNumber}`, value = { client, phoneNumber, createdAt }

interface PendingAuth {
  client: TelegramClient;
  phoneNumber: string;
  apiId: number;
  apiHash: string;
  createdAt: number;
}

const pendingAuths = new Map<string, PendingAuth>();

const PENDING_AUTH_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Periodic cleanup of expired pending auth entries. */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of pendingAuths) {
    if (now - entry.createdAt > PENDING_AUTH_TTL_MS) {
      entry.client.disconnect().catch(() => {});
      pendingAuths.delete(key);
    }
  }
}, 60_000); // sweep every 60s

/**
 * Store a temporary TelegramClient during multi-step auth.
 */
export function storePendingAuth(
  userId: string,
  phoneNumber: string,
  client: TelegramClient,
  apiId: number,
  apiHash: string,
): void {
  const key = `${userId}:${phoneNumber}`;
  // Clean up any previous entry
  const prev = pendingAuths.get(key);
  if (prev) {
    prev.client.disconnect().catch(() => {});
  }
  pendingAuths.set(key, {
    client,
    phoneNumber,
    apiId,
    apiHash,
    createdAt: Date.now(),
  });
}

/**
 * Retrieve and remove a pending auth client.
 */
export function getPendingAuth(userId: string, phoneNumber: string): PendingAuth | undefined {
  const key = `${userId}:${phoneNumber}`;
  return pendingAuths.get(key);
}

/**
 * Remove a pending auth entry (on success or explicit cancel).
 */
export function removePendingAuth(userId: string, phoneNumber: string): void {
  const key = `${userId}:${phoneNumber}`;
  const entry = pendingAuths.get(key);
  if (entry) {
    // Don't disconnect — caller owns the client now
    pendingAuths.delete(key);
  }
}

// ─── Adapter ───

export class TelegramAdapter implements MessengerAdapter {
  private client: TelegramClient | null = null;
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';
  private credentials: TelegramCredentials;

  constructor(credentials: TelegramCredentials) {
    this.credentials = credentials;
  }

  async connect(): Promise<void> {
    try {
      if (!this.credentials.apiId || !this.credentials.apiHash) {
        throw new Error('apiId and apiHash are required');
      }

      const session = new StringSession(this.credentials.session ?? '');
      this.client = new TelegramClient(session, this.credentials.apiId, this.credentials.apiHash, {
        connectionRetries: 5,
      });

      await this.client.connect();

      // Verify we are authorized (have a valid session)
      const authorized = await this.client.isUserAuthorized();
      if (!authorized) {
        this.status = 'session_expired';
        throw new Error('Telegram session is not authorized. Please re-authenticate.');
      }

      this.status = 'connected';
    } catch (err) {
      if (this.status !== 'session_expired') {
        this.status = 'disconnected';
      }
      throw new MessengerError(
        'telegram',
        err,
        err instanceof Error ? err.message : 'Failed to connect to Telegram',
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.disconnect();
        this.client = null;
      }
      this.status = 'disconnected';
    } catch (err) {
      throw new MessengerError('telegram', err, 'Failed to disconnect from Telegram');
    }
  }

  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    this.ensureConnected();

    try {
      const dialogs = await this.client!.getDialogs({ limit: 500 });

      return dialogs.map((d) => {
        let chatType = 'direct';
        if (d.isGroup) chatType = 'group';
        else if (d.isChannel) chatType = 'channel';

        return {
          externalChatId: d.id?.toString() ?? '',
          name: d.title ?? d.name ?? 'Unknown',
          chatType,
        };
      });
    } catch (err) {
      throw new MessengerError('telegram', err, 'Failed to list Telegram chats');
    }
  }

  async sendMessage(
    externalChatId: string,
    text: string,
    options?: { replyToExternalId?: string },
  ): Promise<{ externalMessageId: string }> {
    this.ensureConnected();

    try {
      const peer = await this.resolvePeer(externalChatId);
      const result = await this.client!.sendMessage(peer, {
        message: text,
        replyTo: options?.replyToExternalId ? parseInt(options.replyToExternalId, 10) : undefined,
      });

      return { externalMessageId: result.id.toString() };
    } catch (err) {
      throw new MessengerError('telegram', err, 'Failed to send Telegram message');
    }
  }

  async editMessage(
    externalChatId: string,
    externalMessageId: string,
    newText: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      const peer = await this.resolvePeer(externalChatId);
      await this.client!.editMessage(peer, {
        message: parseInt(externalMessageId, 10),
        text: newText,
      });
    } catch (err) {
      throw new MessengerError('telegram', err, 'Failed to edit Telegram message');
    }
  }

  async deleteMessage(
    externalChatId: string,
    externalMessageId: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      const peer = await this.resolvePeer(externalChatId);
      await this.client!.deleteMessages(peer, [parseInt(externalMessageId, 10)], {
        revoke: true,
      });
    } catch (err) {
      throw new MessengerError('telegram', err, 'Failed to delete Telegram message');
    }
  }

  getStatus(): 'connected' | 'disconnected' | 'token_expired' | 'session_expired' {
    return this.status;
  }

  /** Get the underlying TelegramClient (for advanced operations). */
  getClient(): TelegramClient | null {
    return this.client;
  }

  private ensureConnected(): void {
    if (this.status !== 'connected' || !this.client) {
      throw new MessengerError('telegram', null, 'Telegram adapter is not connected');
    }
  }

  /**
   * Resolve a chat ID to a Telegram peer entity.
   * Handles numeric IDs (users, groups, channels).
   */
  private async resolvePeer(externalChatId: string): Promise<Api.TypeEntityLike> {
    const numId = parseInt(externalChatId, 10);
    if (!isNaN(numId)) {
      return numId;
    }
    // If it's a username or other string format, try to resolve it
    return externalChatId;
  }
}

// ─── Helper: create a fresh TelegramClient for auth flow ───

export function createAuthClient(apiId: number, apiHash: string): TelegramClient {
  const session = new StringSession('');
  return new TelegramClient(session, apiId, apiHash, {
    connectionRetries: 5,
  });
}
