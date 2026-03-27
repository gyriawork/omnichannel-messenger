// ─── Gmail Adapter ───
// Uses googleapis package for real Gmail API interactions.
// Requires OAuth2 credentials (clientId, clientSecret, refreshToken).

import { google } from 'googleapis';
import type { gmail_v1 } from 'googleapis';
import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export class GmailAdapter implements MessengerAdapter {
  private gmail: gmail_v1.Gmail | null = null;
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';
  private credentials: GmailCredentials;
  private userEmail: string = '';

  constructor(credentials: GmailCredentials) {
    this.credentials = credentials;
  }

  async connect(_credentials?: Record<string, unknown>): Promise<void> {
    try {
      const oauth2Client = new google.auth.OAuth2(
        this.credentials.clientId,
        this.credentials.clientSecret,
      );

      oauth2Client.setCredentials({
        refresh_token: this.credentials.refreshToken,
      });

      // Force token refresh to verify credentials are valid
      const { token } = await oauth2Client.getAccessToken();
      if (!token) {
        throw new Error('Failed to obtain Gmail access token');
      }

      this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Get the user's email address
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      this.userEmail = profile.data.emailAddress ?? '';

      this.status = 'connected';
    } catch (err) {
      this.status = 'disconnected';

      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('invalid_grant') || errMsg.includes('Token has been expired or revoked')) {
        this.status = 'token_expired';
        throw new MessengerError('gmail', err, 'Gmail token is expired or revoked');
      }

      throw new MessengerError('gmail', err, 'Failed to connect to Gmail');
    }
  }

  async disconnect(): Promise<void> {
    this.gmail = null;
    this.status = 'disconnected';
  }

  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    this.ensureConnected();

    try {
      // List recent threads as "chats"
      const threadsResult = await this.gmail!.users.threads.list({
        userId: 'me',
        maxResults: 100,
        q: 'in:inbox',
      });

      const threads = threadsResult.data.threads ?? [];
      const chats: Array<{ externalChatId: string; name: string; chatType: string }> = [];

      // Fetch thread details to get subject/participant info
      // Process in batches to avoid rate limiting
      const batchSize = 20;
      for (let i = 0; i < threads.length; i += batchSize) {
        const batch = threads.slice(i, i + batchSize);
        const details = await Promise.all(
          batch.map((thread) =>
            this.gmail!.users.threads.get({
              userId: 'me',
              id: thread.id!,
              format: 'metadata',
              metadataHeaders: ['Subject', 'From', 'To'],
            }),
          ),
        );

        for (const detail of details) {
          const headers = detail.data.messages?.[0]?.payload?.headers ?? [];
          const subject = headers.find((h) => h.name === 'Subject')?.value ?? '(no subject)';
          const from = headers.find((h) => h.name === 'From')?.value ?? '';

          // Extract email address from "Name <email@example.com>" format
          const emailMatch = from.match(/<(.+?)>/);
          const senderEmail = emailMatch ? emailMatch[1] : from;
          const displayName = senderEmail === this.userEmail ? subject : `${from} — ${subject}`;

          chats.push({
            externalChatId: detail.data.id ?? '',
            name: displayName,
            chatType: 'direct',
          });
        }
      }

      return chats;
    } catch (err) {
      this.handleGmailError(err);
      throw new MessengerError('gmail', err, 'Failed to list Gmail threads');
    }
  }

  async sendMessage(
    externalChatId: string,
    text: string,
    options?: { replyToExternalId?: string },
  ): Promise<{ externalMessageId: string }> {
    this.ensureConnected();

    try {
      let threadId: string | undefined;
      let subject = '';
      let to = '';
      let references = '';
      let inReplyTo = '';

      // If replying to a thread, get the thread details
      if (externalChatId) {
        const thread = await this.gmail!.users.threads.get({
          userId: 'me',
          id: externalChatId,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'To', 'Message-ID'],
        });

        threadId = thread.data.id ?? undefined;
        const lastMessage = thread.data.messages?.[thread.data.messages.length - 1];
        const headers = lastMessage?.payload?.headers ?? [];

        subject = headers.find((h) => h.name === 'Subject')?.value ?? '';
        if (!subject.startsWith('Re: ')) {
          subject = `Re: ${subject}`;
        }

        // Reply to the sender
        const from = headers.find((h) => h.name === 'From')?.value ?? '';
        const originalTo = headers.find((h) => h.name === 'To')?.value ?? '';
        to = from.includes(this.userEmail) ? originalTo : from;

        const messageId = headers.find((h) => h.name === 'Message-ID')?.value ?? '';
        references = messageId;
        inReplyTo = messageId;
      }

      // Build the raw email message
      const messageParts = [
        `To: ${to}`,
        `Subject: ${subject}`,
        `Content-Type: text/plain; charset=utf-8`,
      ];

      if (inReplyTo) {
        messageParts.push(`In-Reply-To: ${inReplyTo}`);
        messageParts.push(`References: ${references}`);
      }

      messageParts.push('', text);

      const raw = Buffer.from(messageParts.join('\r\n'))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const result = await this.gmail!.users.messages.send({
        userId: 'me',
        requestBody: {
          raw,
          threadId,
        },
      });

      return { externalMessageId: result.data.id ?? '' };
    } catch (err) {
      this.handleGmailError(err);
      throw new MessengerError('gmail', err, 'Failed to send Gmail message');
    }
  }

  async editMessage(
    _externalChatId: string,
    _externalMessageId: string,
    _newText: string,
  ): Promise<void> {
    // Email does not support editing sent messages
    throw new MessengerError(
      'gmail',
      null,
      'Gmail does not support editing sent messages',
    );
  }

  async deleteMessage(
    _externalChatId: string,
    externalMessageId: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      // Move to trash rather than permanent delete
      await this.gmail!.users.messages.trash({
        userId: 'me',
        id: externalMessageId,
      });
    } catch (err) {
      this.handleGmailError(err);
      throw new MessengerError('gmail', err, 'Failed to delete Gmail message');
    }
  }

  getStatus(): 'connected' | 'disconnected' | 'token_expired' | 'session_expired' {
    return this.status;
  }

  private ensureConnected(): void {
    if (this.status !== 'connected' || !this.gmail) {
      throw new MessengerError('gmail', null, 'Gmail adapter is not connected');
    }
  }

  /** Detect token-related errors and update status accordingly. */
  private handleGmailError(err: unknown): void {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes('invalid_grant') || errMsg.includes('Token has been expired or revoked')) {
      this.status = 'token_expired';
    }
  }
}
