// ─── Slack Adapter ───
// Uses @slack/web-api WebClient for real Slack API interactions.
// Requires a bot or user OAuth token with appropriate scopes.

import { WebClient } from '@slack/web-api';
import type { MessengerAdapter, GetMessagesResult, HistoryMessage } from './base.js';
import { MessengerError } from './base.js';

interface SlackCredentials {
  token: string;
}

export class SlackAdapter implements MessengerAdapter {
  private client: WebClient | null = null;
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';
  private token: string;
  private userId: string = '';

  constructor(credentials: SlackCredentials) {
    this.token = credentials.token;
  }

  async connect(_credentials?: Record<string, unknown>): Promise<void> {
    try {
      this.client = new WebClient(this.token);

      // Verify the token by calling auth.test
      const result = await this.client.auth.test();
      if (!result.ok) {
        throw new Error('Slack auth.test failed');
      }

      this.userId = result.user_id ?? '';
      this.status = 'connected';
    } catch (err) {
      this.status = 'disconnected';

      // Check for token expiry/revocation
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('token_revoked') || errMsg.includes('token_expired') || errMsg.includes('invalid_auth')) {
        this.status = 'token_expired';
        throw new MessengerError('slack', err, 'Slack token is expired or revoked');
      }

      throw new MessengerError('slack', err, 'Failed to connect to Slack');
    }
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.status = 'disconnected';
  }

  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    this.ensureConnected();

    try {
      const chats: Array<{ externalChatId: string; name: string; chatType: string }> = [];
      let cursor: string | undefined;

      // Paginate through all conversations
      do {
        const result = await this.client!.conversations.list({
          types: 'public_channel,private_channel,mpim,im',
          limit: 200,
          cursor,
        });

        if (result.channels) {
          for (const channel of result.channels) {
            if (!channel.id) continue;

            let chatType: string;
            if (channel.is_im) {
              chatType = 'direct';
            } else if (channel.is_mpim) {
              chatType = 'group';
            } else {
              chatType = 'channel';
            }

            chats.push({
              externalChatId: channel.id,
              name: channel.name ?? channel.id,
              chatType,
            });
          }
        }

        cursor = result.response_metadata?.next_cursor || undefined;
      } while (cursor);

      return chats;
    } catch (err) {
      this.handleSlackError(err);
      throw new MessengerError('slack', err, 'Failed to list Slack conversations');
    }
  }

  async sendMessage(
    externalChatId: string,
    text: string,
    options?: {
      replyToExternalId?: string;
      attachments?: Array<{ url: string; filename: string; mimeType: string; size: number }>;
    },
  ): Promise<{ externalMessageId: string }> {
    this.ensureConnected();

    try {
      // Upload attachments first (if any)
      if (options?.attachments && options.attachments.length > 0) {
        for (const attachment of options.attachments) {
          try {
            const fileUrl = attachment.url.startsWith('http')
              ? attachment.url
              : `${process.env.API_URL || process.env.APP_URL || 'http://localhost:3000'}${attachment.url}`;
            const response = await fetch(fileUrl);
            if (!response.ok) throw new Error(`Failed to download attachment: ${response.status}`);
            const buffer = Buffer.from(await response.arrayBuffer());
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const uploadArgs: any = {
              channel_id: externalChatId,
              file: buffer,
              filename: attachment.filename,
            };
            if (options?.replyToExternalId) {
              uploadArgs.thread_ts = options.replyToExternalId;
            }
            await this.client!.filesUploadV2(uploadArgs);
          } catch (fileErr) {
            console.warn(`Failed to upload Slack attachment ${attachment.filename}:`, fileErr);
          }
        }
      }

      const result = await this.client!.chat.postMessage({
        channel: externalChatId,
        text,
        thread_ts: options?.replyToExternalId,
      });

      if (!result.ok || !result.ts) {
        throw new Error('Slack postMessage failed');
      }

      return { externalMessageId: result.ts };
    } catch (err) {
      this.handleSlackError(err);
      throw new MessengerError('slack', err, 'Failed to send Slack message');
    }
  }

  async editMessage(
    externalChatId: string,
    externalMessageId: string,
    newText: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      const result = await this.client!.chat.update({
        channel: externalChatId,
        ts: externalMessageId,
        text: newText,
      });

      if (!result.ok) {
        throw new Error('Slack chat.update failed');
      }
    } catch (err) {
      this.handleSlackError(err);
      throw new MessengerError('slack', err, 'Failed to edit Slack message');
    }
  }

  async deleteMessage(
    externalChatId: string,
    externalMessageId: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      const result = await this.client!.chat.delete({
        channel: externalChatId,
        ts: externalMessageId,
      });

      if (!result.ok) {
        throw new Error('Slack chat.delete failed');
      }
    } catch (err) {
      this.handleSlackError(err);
      throw new MessengerError('slack', err, 'Failed to delete Slack message');
    }
  }

  async getMessages(
    externalChatId: string,
    limit = 200,
    cursor?: string,
  ): Promise<GetMessagesResult> {
    this.ensureConnected();

    try {
      const params: Record<string, unknown> = {
        channel: externalChatId,
        limit,
      };
      if (cursor) {
        params.cursor = cursor;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await this.client!.conversations.history(params as any);

      const messages: HistoryMessage[] = (result.messages ?? [])
        .filter((m) => m.ts && m.type === 'message')
        .map((m) => ({
          id: m.ts!,
          text: m.text ?? '',
          senderId: m.user ?? m.bot_id ?? '',
          date: new Date(parseFloat(m.ts!) * 1000),
          isSelf: (m.user ?? '') === this.userId,
        }))
        .reverse(); // oldest first

      const nextCursor = result.response_metadata?.next_cursor || undefined;

      return {
        messages,
        nextCursor: nextCursor && nextCursor.length > 0 ? nextCursor : undefined,
        hasMore: result.has_more ?? false,
      };
    } catch (err) {
      this.handleSlackError(err);
      throw new MessengerError('slack', err, 'Failed to get Slack messages');
    }
  }

  getStatus(): 'connected' | 'disconnected' | 'token_expired' | 'session_expired' {
    return this.status;
  }

  private ensureConnected(): void {
    if (this.status !== 'connected' || !this.client) {
      throw new MessengerError('slack', null, 'Slack adapter is not connected');
    }
  }

  /** Detect token-related errors and update status accordingly. */
  private handleSlackError(err: unknown): void {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (
      errMsg.includes('token_revoked') ||
      errMsg.includes('token_expired') ||
      errMsg.includes('invalid_auth') ||
      errMsg.includes('account_inactive')
    ) {
      this.status = 'token_expired';
    }
  }
}
