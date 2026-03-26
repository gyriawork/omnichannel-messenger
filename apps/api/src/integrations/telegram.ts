// ─── Telegram Adapter (Stub) ───
// TODO: Full MTProto implementation requires interactive phone auth.
// This is a stub that implements the interface but does not make real connections.
// Real implementation will use the `telegram` (gramjs) package with TelegramClient.

import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

interface TelegramCredentials {
  apiId: number;
  apiHash: string;
  session?: string;
  phoneNumber?: string;
}

export class TelegramAdapter implements MessengerAdapter {
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';
  private credentials: TelegramCredentials | null = null;

  constructor(credentials: TelegramCredentials) {
    this.credentials = credentials;
  }

  async connect(_credentials?: Record<string, unknown>): Promise<void> {
    try {
      // TODO: Full MTProto implementation requires interactive phone auth.
      // Real implementation would:
      // 1. Create TelegramClient with apiId, apiHash, StringSession
      // 2. Call client.start() with phone/code callbacks
      // 3. Store the resulting session string in credentials
      //
      // Example (not functional without interactive auth):
      // import { TelegramClient } from 'telegram';
      // import { StringSession } from 'telegram/sessions';
      //
      // const session = new StringSession(this.credentials?.session ?? '');
      // this.client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
      // await this.client.start({ ... });

      if (!this.credentials?.apiId || !this.credentials?.apiHash) {
        throw new Error('apiId and apiHash are required');
      }

      // Simulate successful connection for development
      this.status = 'connected';
    } catch (err) {
      this.status = 'disconnected';
      throw new MessengerError('telegram', err, 'Failed to connect to Telegram');
    }
  }

  async disconnect(): Promise<void> {
    try {
      // TODO: Call client.disconnect() when real client is implemented
      this.status = 'disconnected';
    } catch (err) {
      throw new MessengerError('telegram', err, 'Failed to disconnect from Telegram');
    }
  }

  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    this.ensureConnected();

    try {
      // TODO: Real implementation would use:
      // const dialogs = await this.client.getDialogs({});
      // return dialogs.map(d => ({
      //   externalChatId: d.id?.toString() ?? '',
      //   name: d.title ?? d.name ?? 'Unknown',
      //   chatType: d.isGroup ? 'group' : d.isChannel ? 'channel' : 'direct',
      // }));

      // Return empty list — real data requires MTProto session
      return [];
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
      // TODO: Real implementation:
      // const result = await this.client.sendMessage(externalChatId, {
      //   message: text,
      //   replyTo: options?.replyToExternalId ? parseInt(options.replyToExternalId) : undefined,
      // });
      // return { externalMessageId: result.id.toString() };

      // Stub — return placeholder
      return { externalMessageId: `tg_stub_${Date.now()}` };
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
      // TODO: Real implementation:
      // await this.client.editMessage(externalChatId, {
      //   message: parseInt(externalMessageId),
      //   text: newText,
      // });
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
      // TODO: Real implementation:
      // await this.client.deleteMessages(externalChatId, [parseInt(externalMessageId)], { revoke: true });
    } catch (err) {
      throw new MessengerError('telegram', err, 'Failed to delete Telegram message');
    }
  }

  getStatus(): 'connected' | 'disconnected' | 'token_expired' | 'session_expired' {
    return this.status;
  }

  private ensureConnected(): void {
    if (this.status !== 'connected') {
      throw new MessengerError('telegram', null, 'Telegram adapter is not connected');
    }
  }
}
