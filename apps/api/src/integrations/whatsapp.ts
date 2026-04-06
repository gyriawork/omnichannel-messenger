// ─── WhatsApp Adapter (WAHA) ───
// Uses WAHA (WhatsApp HTTP API) instead of Baileys for session management
// and messaging. WAHA runs as a separate service and exposes a REST API.

import { WahaClient, WahaApiError } from '../lib/waha-client.js';
import type { WahaSessionStatus } from '../lib/waha-client.js';
import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

// ─── Types ───

export interface WhatsAppWahaCredentials {
  /** WAHA session name — unique per integration */
  wahaSessionName: string;
  /** Phone number associated with the WhatsApp account */
  phoneNumber?: string;
}

// ─── Pairing functions ───
// These are used during the integration setup flow (QR code scanning).
// WAHA Core (free) only supports session name "default".
// WAHA Plus supports multiple named sessions.

const client = new WahaClient();
const WAHA_SESSION_NAME = process.env.WAHA_SESSION_NAME ?? 'default';

/**
 * Create a WAHA session and configure webhooks for incoming messages.
 * Call this when a user starts the WhatsApp pairing flow.
 */
export async function startWhatsAppPairing(
  _sessionKey: string,
  webhookUrl: string,
): Promise<string> {
  const sessionName = WAHA_SESSION_NAME;
  try {
    // Delete any stale session with the same name
    try {
      await client.deleteSession(sessionName);
    } catch {
      // Session may not exist — that's fine
    }

    await client.createSession(sessionName, {
      webhooks: [
        {
          url: webhookUrl,
          events: ['message', 'session.status'],
        },
      ],
    });
    return sessionName;
  } catch (err) {
    throw new MessengerError(
      'whatsapp',
      err,
      `Failed to start WhatsApp pairing session: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Get the QR code for a session that is waiting for scanning.
 * Returns base64-encoded image data, or null if QR is not ready yet.
 */
export async function getQrCode(
  sessionName: string,
): Promise<{ value: string; mimetype: string } | null> {
  try {
    return await client.getQr(sessionName);
  } catch (err) {
    throw new MessengerError(
      'whatsapp',
      err,
      `Failed to get WhatsApp QR code: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Get the current pairing/session status.
 * Possible values: STARTING, SCAN_QR_CODE, WORKING, FAILED, STOPPED
 */
export async function getPairingStatus(
  sessionName: string,
): Promise<WahaSessionStatus> {
  try {
    const info = await client.getSession(sessionName);
    return info.status;
  } catch (err) {
    throw new MessengerError(
      'whatsapp',
      err,
      `Failed to get WhatsApp pairing status: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Cancel an active pairing session by deleting the WAHA session.
 */
export async function cancelPairing(sessionName: string): Promise<void> {
  try {
    await client.deleteSession(sessionName);
  } catch (err) {
    // Ignore 404 — session may have already been removed
    if (err instanceof WahaApiError && err.statusCode === 404) return;
    throw new MessengerError(
      'whatsapp',
      err,
      `Failed to cancel WhatsApp pairing: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
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

      // Session not found — credentials are stale
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
      // If session doesn't exist, consider it disconnected
      if (err instanceof WahaApiError && err.statusCode === 404) {
        this.status = 'disconnected';
        return;
      }
      throw new MessengerError('whatsapp', err, 'Failed to disconnect from WhatsApp');
    }
  }

  /**
   * List all chats from the WhatsApp account.
   */
  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    this.ensureConnected();

    try {
      const chats = await this.client.listChats(this.sessionName);
      return chats.map((chat) => ({
        externalChatId: chat.id,
        name: chat.name || chat.id,
        chatType: chat.isGroup ? 'group' : 'private',
      }));
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to list WhatsApp chats');
    }
  }

  /**
   * Send a message to a chat. Supports text and attachments.
   *
   * If attachments are provided:
   * - First attachment is sent with the text as caption (image → sendImage, other → sendFile)
   * - Remaining attachments are sent without caption
   * - Returns the message ID of the first sent message
   */
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
      const attachments = options?.attachments ?? [];

      // With attachments: send media messages
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

      // Text-only message
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

  getStatus(): 'connected' | 'disconnected' | 'token_expired' | 'session_expired' {
    return this.status;
  }

  private ensureConnected(): void {
    if (this.status !== 'connected') {
      throw new MessengerError('whatsapp', null, 'WhatsApp adapter is not connected');
    }
  }
}
