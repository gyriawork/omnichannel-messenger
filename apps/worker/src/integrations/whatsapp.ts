// ─── WhatsApp Adapter for Worker (WAHA) ───
// Worker-side adapter using WAHA REST API. Includes getMessages()
// for background history sync jobs. No pairing functions — those
// live in the API adapter only.

import { WahaClient, WahaApiError } from '../lib/waha-client.js';
import type { MessengerAdapter, GetMessagesResult, HistoryMessage } from './base.js';
import { MessengerError } from './base.js';

// ─── Types ───

interface WhatsAppWahaCredentials {
  /** WAHA session name — unique per integration */
  wahaSessionName: string;
  /** Phone number associated with the WhatsApp account */
  phoneNumber?: string;
}

// ─── WhatsApp Adapter ───

export class WhatsAppAdapter implements MessengerAdapter {
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';
  private credentials: WhatsAppWahaCredentials;
  private client: WahaClient;

  constructor(credentials: Record<string, unknown>) {
    this.credentials = credentials as unknown as WhatsAppWahaCredentials;
    this.client = new WahaClient();
  }

  private get sessionName(): string {
    return this.credentials.wahaSessionName;
  }

  /**
   * Verify the WAHA session is alive and in WORKING status.
   * If the session is stopped, attempt to start it.
   */
  async connect(): Promise<void> {
    try {
      const info = await this.client.getSession(this.sessionName);

      if (info.status === 'WORKING') {
        this.status = 'connected';
        return;
      }

      if (info.status === 'STOPPED') {
        await this.client.startSession(this.sessionName);
        this.status = 'connected';
        return;
      }

      if (info.status === 'FAILED') {
        this.status = 'session_expired';
        throw new MessengerError('whatsapp', null, 'WhatsApp session failed. Please re-pair via QR code.');
      }

      // STARTING or SCAN_QR_CODE — not fully connected yet
      this.status = 'disconnected';
      throw new MessengerError('whatsapp', null, `WhatsApp session is in ${info.status} state. Complete pairing first.`);
    } catch (err) {
      if (err instanceof MessengerError) throw err;

      if (err instanceof WahaApiError && err.statusCode === 404) {
        this.status = 'session_expired';
        throw new MessengerError('whatsapp', err, 'WhatsApp session not found. Please re-pair via QR code.');
      }

      this.status = 'disconnected';
      throw new MessengerError('whatsapp', err, 'Failed to connect to WhatsApp');
    }
  }

  /**
   * Stop the WAHA session gracefully.
   */
  async disconnect(): Promise<void> {
    try {
      await this.client.stopSession(this.sessionName);
      this.status = 'disconnected';
    } catch (err) {
      if (err instanceof WahaApiError && err.statusCode === 404) {
        this.status = 'disconnected';
        return;
      }
      throw new MessengerError('whatsapp', err, 'Failed to disconnect from WhatsApp');
    }
  }

  /**
   * List all chats from the WhatsApp account.
   * Resolves contact names via WAHA contacts API. Falls back to formatted
   * phone number for @c.us IDs. Filters out broadcast lists (@lid) and
   * status@broadcast.
   */
  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    this.ensureConnected();

    try {
      const [chats, contacts] = await Promise.all([
        this.client.listChats(this.sessionName),
        this.client.getContacts(this.sessionName).catch(() => [] as Array<{ id: string; name?: string; pushname?: string }>),
      ]);

      // Build contact name lookup: id → best available name
      const contactNames = new Map<string, string>();
      for (const c of contacts) {
        const name = c.name || c.pushname;
        if (name) contactNames.set(c.id, name);
      }

      const result: Array<{ externalChatId: string; name: string; chatType: string }> = [];

      for (const chat of chats) {
        const chatId = typeof chat.id === 'object' && chat.id !== null
          ? (chat.id as Record<string, unknown>)._serialized as string ?? JSON.stringify(chat.id)
          : String(chat.id);

        // Filter out broadcast lists and status broadcast
        if (chatId === 'status@broadcast' || chatId.endsWith('@lid')) continue;

        // Resolve name: WAHA chat name → contact lookup → formatted phone → raw ID
        let name = chat.name || contactNames.get(chatId) || '';
        if (!name && chatId.endsWith('@c.us')) {
          const phone = chatId.replace('@c.us', '');
          name = `+${phone}`;
        }
        if (!name) name = chatId;

        result.push({
          externalChatId: chatId,
          name,
          chatType: chat.isGroup ? 'group' : 'direct',
        });
      }

      return result;
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to list WhatsApp chats');
    }
  }

  /**
   * Send a message to a chat. Supports text and attachments.
   *
   * If attachments are provided:
   * - First attachment is sent with the text as caption
   * - Remaining attachments are sent without caption
   * - Returns the message ID of the first sent message
   */
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
      const attachments = options?.attachments ?? [];

      if (attachments.length > 0) {
        let firstMessageId: string | undefined;

        for (let i = 0; i < attachments.length; i++) {
          const attachment = attachments[i];
          const caption = i === 0 ? text : undefined;
          const isImage = attachment.mimeType.startsWith('image/');

          const result = isImage
            ? await this.client.sendImage(this.sessionName, externalChatId, attachment.url, caption)
            : await this.client.sendFile(this.sessionName, externalChatId, attachment.url, attachment.filename, caption);

          if (i === 0) {
            firstMessageId = result.id;
          }
        }

        return { externalMessageId: firstMessageId ?? `wa_${Date.now()}` };
      }

      const result = await this.client.sendText(this.sessionName, externalChatId, text);
      return { externalMessageId: result.id };
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to send WhatsApp message');
    }
  }

  /**
   * WhatsApp does not support message editing.
   */
  async editMessage(
    _externalChatId: string,
    _externalMessageId: string,
    _newText: string,
  ): Promise<void> {
    throw new MessengerError('whatsapp', null, 'WhatsApp does not support message editing');
  }

  /**
   * Delete a message from a chat.
   */
  async deleteMessage(
    externalChatId: string,
    externalMessageId: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      await this.client.deleteMessage(this.sessionName, externalChatId, externalMessageId);
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to delete WhatsApp message');
    }
  }

  /**
   * Fetch message history from a chat for background sync.
   * Returns messages oldest-first with an opaque cursor for pagination.
   *
   * WAHA's getMessages endpoint returns newest-first, so we reverse.
   * The cursor is the ID of the oldest message in the current batch;
   * subsequent calls fetch older messages.
   */
  async getMessages(
    externalChatId: string,
    limit: number = 50,
    cursor?: string,
  ): Promise<GetMessagesResult> {
    this.ensureConnected();

    try {
      // WAHA returns messages newest-first
      const rawMessages = await this.client.getMessages(
        this.sessionName,
        externalChatId,
        // Fetch extra to detect if there are more pages
        limit + 1,
        false,
      );

      if (!rawMessages || rawMessages.length === 0) {
        return { messages: [], hasMore: false };
      }

      // If we got more than `limit`, there are more messages
      const hasMore = rawMessages.length > limit;
      const batch = hasMore ? rawMessages.slice(0, limit) : rawMessages;

      // If a cursor was provided, filter out messages up to and including the cursor.
      // This is a simple client-side approach since WAHA doesn't support cursor params.
      let filtered = batch;
      if (cursor) {
        const cursorIdx = filtered.findIndex((m) => m.id === cursor);
        if (cursorIdx >= 0) {
          filtered = filtered.slice(cursorIdx + 1);
        }
      }

      const messages: HistoryMessage[] = filtered.map((m) => ({
        id: m.id,
        text: m.body ?? '',
        fromMe: m.fromMe,
        timestamp: m.timestamp,
        senderName: m._data?.notifyName,
        senderId: m.from,
        date: new Date(m.timestamp * 1000),
        isSelf: m.fromMe,
      }));

      // Reverse to oldest-first
      messages.reverse();

      // Next cursor is the oldest message ID in the current batch
      const nextCursor = hasMore && filtered.length > 0
        ? filtered[filtered.length - 1].id
        : undefined;

      return {
        messages,
        nextCursor,
        hasMore,
      };
    } catch (err) {
      // Treat "not found" as empty — chat may not exist yet
      if (err instanceof WahaApiError && err.statusCode === 404) {
        return { messages: [], hasMore: false };
      }
      throw new MessengerError('whatsapp', err, 'Failed to get WhatsApp messages');
    }
  }

  getStatus(): 'connected' | 'disconnected' | 'token_expired' | 'session_expired' {
    return this.status;
  }

  private ensureConnected(): void {
    if (this.status !== 'connected') {
      throw new MessengerError('whatsapp', null, 'WhatsApp adapter is not connected');
    }
  }
}
