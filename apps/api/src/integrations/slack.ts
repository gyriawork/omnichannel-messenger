// ─── Slack Adapter ───
// Uses @slack/web-api WebClient for real Slack API interactions.
// Requires a bot or user OAuth token with appropriate scopes.

import { WebClient } from '@slack/web-api';
import * as nodeEmoji from 'node-emoji';
import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

/** Convert Unicode emoji to Slack shortcode name. E.g. '👍' → 'thumbsup' */
export function emojiToSlackName(emoji: string): string {
  const result = nodeEmoji.find(emoji);
  if (result?.key) return result.key;
  // Fallback: return as-is (Slack may accept some Unicode directly)
  return emoji;
}

/** Convert Slack shortcode name to Unicode emoji. E.g. 'thumbsup' → '👍' */
export function slackNameToEmoji(name: string): string {
  const emoji = nodeEmoji.get(name);
  return emoji ?? name;
}

interface SlackCredentials {
  token: string;
}

export class SlackAdapter implements MessengerAdapter {
  private client: WebClient | null = null;
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';
  private token: string;

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
      // ── Step 1: Fetch all workspace members in bulk ──
      // This avoids per-DM users.info calls that hit Slack rate limits
      const userNameMap = new Map<string, string>();
      try {
        let usersCursor: string | undefined;
        do {
          const usersResult = await this.client!.users.list({
            limit: 200,
            cursor: usersCursor,
          });
          if (usersResult.members) {
            for (const member of usersResult.members) {
              if (!member.id || member.is_bot || member.id === 'USLACKBOT') continue;
              const displayName =
                member.real_name
                || member.profile?.display_name
                || member.name
                || member.id;
              userNameMap.set(member.id, displayName);
            }
          }
          usersCursor = usersResult.response_metadata?.next_cursor || undefined;
        } while (usersCursor);
      } catch (err) {
        console.warn('[Slack] Failed to bulk-fetch users, DMs will show raw IDs:', err);
      }

      // ── Step 2: Fetch all conversations ──
      const chats: Array<{ externalChatId: string; name: string; chatType: string }> = [];
      let cursor: string | undefined;

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

            let name = channel.name ?? channel.id;

            // Resolve human-readable name for DM channels using pre-fetched user map
            if (channel.is_im) {
              const userId = (channel as Record<string, unknown>).user as string | undefined;
              if (userId && userNameMap.has(userId)) {
                name = userNameMap.get(userId)!;
              } else if (userId) {
                // Fallback: try individual lookup for users not in the bulk list
                try {
                  const userInfo = await this.client!.users.info({ user: userId });
                  name = userInfo.user?.real_name
                    || userInfo.user?.profile?.display_name
                    || userInfo.user?.name
                    || channel.id!;
                } catch {
                  name = channel.id!;
                }
              }
            }

            chats.push({
              externalChatId: channel.id,
              name,
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
      attachments?: Array<{ url: string; filename: string; mimeType: string }>;
    },
  ): Promise<{ externalMessageId: string }> {
    this.ensureConnected();

    try {
      if (options?.attachments && options.attachments.length > 0) {
        // Post text message first if text is provided
        let textMessageId: string | undefined;
        if (text) {
          const textResult = await this.client!.chat.postMessage({
            channel: externalChatId,
            text,
            thread_ts: options?.replyToExternalId,
          });
          if (textResult.ok && textResult.ts) {
            textMessageId = textResult.ts;
          }
        }

        // Upload each attachment
        for (const attachment of options.attachments) {
          try {
            const arrayBuffer = await fetch(attachment.url).then((r) => r.arrayBuffer());
            const fileBuffer = Buffer.from(arrayBuffer);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const filesUploadV2 = this.client!.filesUploadV2.bind(this.client!) as (args: any) => Promise<any>;
            await filesUploadV2({
              channel_id: externalChatId,
              filename: attachment.filename,
              file: fileBuffer,
              ...(options?.replyToExternalId ? { thread_ts: options.replyToExternalId } : {}),
            });
          } catch {
            // If attachment upload fails, continue with remaining attachments
          }
        }

        // Return the text message ID if available, otherwise a fallback
        return { externalMessageId: textMessageId ?? `slack_${Date.now()}` };
      }

      // Text-only path (original behavior)
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

  async addReaction(
    externalChatId: string,
    externalMessageId: string,
    emoji: string,
  ): Promise<void> {
    try {
      await this.client!.reactions.add({
        channel: externalChatId,
        timestamp: externalMessageId,
        name: emojiToSlackName(emoji),
      });
    } catch (err) {
      throw new MessengerError('slack', err, 'Failed to add reaction in Slack');
    }
  }

  async removeReaction(
    externalChatId: string,
    externalMessageId: string,
    emoji: string,
  ): Promise<void> {
    try {
      await this.client!.reactions.remove({
        channel: externalChatId,
        timestamp: externalMessageId,
        name: emojiToSlackName(emoji),
      });
    } catch (err) {
      throw new MessengerError('slack', err, 'Failed to remove reaction in Slack');
    }
  }

  /**
   * Fetch message history from a Slack channel. Returns messages oldest-first.
   */
  async getMessages(
    externalChatId: string,
    limit = 50,
  ): Promise<Array<{
    id: string;
    text: string;
    senderId: string;
    date: Date;
    out: boolean;
  }>> {
    this.ensureConnected();

    try {
      const result = await this.client!.conversations.history({
        channel: externalChatId,
        limit,
      });

      // Get our own user ID for `out` flag
      let selfUserId = '';
      try {
        const auth = await this.client!.auth.test();
        selfUserId = auth.user_id ?? '';
      } catch { /* ignore */ }

      return (result.messages ?? [])
        .filter((m) => m.ts && m.type === 'message')
        .map((m) => ({
          id: m.ts!,
          text: m.text ?? '',
          senderId: m.user ?? m.bot_id ?? '',
          date: new Date(parseFloat(m.ts!) * 1000),
          out: (m.user ?? '') === selfUserId,
        }))
        .reverse(); // oldest first
    } catch (err) {
      this.handleSlackError(err);
      throw new MessengerError('slack', err, 'Failed to get Slack messages');
    }
  }

  /**
   * Resolve a Slack user ID to a display name.
   */
  async getSenderName(senderId: string): Promise<string> {
    this.ensureConnected();
    try {
      const userInfo = await this.client!.users.info({ user: senderId });
      return userInfo.user?.real_name
        || userInfo.user?.profile?.display_name
        || userInfo.user?.name
        || senderId;
    } catch {
      return senderId;
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
