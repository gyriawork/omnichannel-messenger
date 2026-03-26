// ─── WhatsApp Adapter (Stub) ───
// TODO: Full Baileys implementation requires QR code pairing.
// This is a stub that implements the interface but does not make real connections.
// Real implementation will use @whiskeysockets/baileys with QR code auth flow.

import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

interface WhatsAppCredentials {
  session?: string; // Serialized Baileys auth state
  phoneNumber?: string;
}

export class WhatsAppAdapter implements MessengerAdapter {
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';
  private credentials: WhatsAppCredentials | null = null;

  constructor(credentials: WhatsAppCredentials) {
    this.credentials = credentials;
  }

  async connect(_credentials?: Record<string, unknown>): Promise<void> {
    try {
      // TODO: Full Baileys implementation requires QR code pairing.
      // Real implementation would:
      // 1. Use makeWASocket() from @whiskeysockets/baileys
      // 2. Handle 'connection.update' events for QR code display
      // 3. Store auth state (creds + keys) after successful pairing
      // 4. Use useMultiFileAuthState or custom state management
      //
      // Example (not functional without QR pairing flow):
      // import { makeWASocket, useMultiFileAuthState } from '@whiskeysockets/baileys';
      // const { state, saveCreds } = await useMultiFileAuthState('./auth_info');
      // const sock = makeWASocket({ auth: state });
      // sock.ev.on('creds.update', saveCreds);
      // sock.ev.on('connection.update', (update) => { ... });

      // Simulate successful connection for development
      this.status = 'connected';
    } catch (err) {
      this.status = 'disconnected';
      throw new MessengerError('whatsapp', err, 'Failed to connect to WhatsApp');
    }
  }

  async disconnect(): Promise<void> {
    try {
      // TODO: Call sock.logout() or sock.end() when real client is implemented
      this.status = 'disconnected';
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to disconnect from WhatsApp');
    }
  }

  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    this.ensureConnected();

    try {
      // TODO: Real implementation would use:
      // const chats = await sock.groupFetchAllParticipating();
      // Plus individual contacts from the store.
      // Return mapped results.

      // Return empty list — real data requires QR code session
      return [];
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to list WhatsApp chats');
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
      // const jid = externalChatId.includes('@') ? externalChatId : `${externalChatId}@s.whatsapp.net`;
      // const msg = await sock.sendMessage(jid, {
      //   text,
      //   ...(options?.replyToExternalId ? { quoted: { key: { id: options.replyToExternalId } } } : {}),
      // });
      // return { externalMessageId: msg.key.id ?? '' };

      // Stub — return placeholder
      return { externalMessageId: `wa_stub_${Date.now()}` };
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to send WhatsApp message');
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
      // const jid = externalChatId.includes('@') ? externalChatId : `${externalChatId}@s.whatsapp.net`;
      // await sock.sendMessage(jid, { text: newText, edit: { key: { id: externalMessageId } } });
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to edit WhatsApp message');
    }
  }

  async deleteMessage(
    externalChatId: string,
    externalMessageId: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      // TODO: Real implementation:
      // const jid = externalChatId.includes('@') ? externalChatId : `${externalChatId}@s.whatsapp.net`;
      // await sock.sendMessage(jid, { delete: { remoteJid: jid, id: externalMessageId, fromMe: true } });
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
