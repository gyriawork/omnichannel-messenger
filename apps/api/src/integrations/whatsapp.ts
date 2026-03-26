// ─── WhatsApp Adapter (Baileys) ───
// Real implementation using @whiskeysockets/baileys with QR code auth flow.

import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WASocket,
  type ConnectionState,
  type AuthenticationState,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type SignalDataSet,
  type SignalKeyStore,
  initAuthCreds,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { EventEmitter } from 'node:events';
import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';
import pino from 'pino';

// ─── Types ───

interface WhatsAppCredentials {
  /** Serialized JSON of the Baileys auth state (creds + keys) */
  authState?: string;
  phoneNumber?: string;
}

export interface WhatsAppPairingEvents {
  qr: (qrCode: string) => void;
  connected: (credentials: WhatsAppCredentials) => void;
  error: (error: Error) => void;
  status: (message: string) => void;
}

// ─── In-memory auth state from serialized JSON ───

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KeyStore = Record<string, Record<string, any>>;

interface SerializedAuthState {
  creds: AuthenticationCreds;
  keys: KeyStore;
}

/**
 * Creates an in-memory auth state backed by a serialized JSON blob.
 * This allows us to persist auth state in the database (encrypted)
 * rather than on the filesystem.
 */
function useMemoryAuthState(serialized?: string): {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  getSerializedState: () => string;
} {
  let creds: AuthenticationCreds;
  const keys: KeyStore = {};

  if (serialized) {
    try {
      const parsed: SerializedAuthState = JSON.parse(serialized);
      creds = parsed.creds;
      if (parsed.keys) {
        for (const [category, entries] of Object.entries(parsed.keys)) {
          keys[category] = entries;
        }
      }
    } catch {
      creds = initAuthCreds();
    }
  } else {
    creds = initAuthCreds();
  }

  const keyStore: SignalKeyStore = {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const data: { [id: string]: SignalDataTypeMap[T] } = {};
      const category = keys[type];
      if (category) {
        for (const id of ids) {
          if (id in category) {
            data[id] = category[id] as SignalDataTypeMap[T];
          }
        }
      }
      return data;
    },
    set: async (data: SignalDataSet) => {
      for (const _category of Object.keys(data)) {
        const category = _category as keyof SignalDataSet;
        const entries = data[category];
        if (!entries) continue;
        if (!keys[category]) {
          keys[category] = {};
        }
        for (const [id, value] of Object.entries(entries)) {
          if (value) {
            keys[category][id] = value;
          } else {
            delete keys[category][id];
          }
        }
      }
    },
  };

  const state: AuthenticationState = {
    creds,
    keys: keyStore,
  };

  const saveCreds = async () => {
    // No-op; state is always in memory. Use getSerializedState() to persist.
  };

  const getSerializedState = (): string => {
    return JSON.stringify({ creds, keys } satisfies SerializedAuthState);
  };

  return { state, saveCreds, getSerializedState };
}

// ─── Pairing session manager ───

/** Active pairing sessions indexed by a unique session key. */
const activePairingSessions = new Map<string, {
  sock: WASocket;
  emitter: EventEmitter;
  timeout: ReturnType<typeof setTimeout>;
}>();

/**
 * Start a new WhatsApp pairing session. Returns an EventEmitter that
 * fires 'qr', 'connected', 'error', and 'status' events.
 *
 * The session auto-cleans after 120 seconds (QR codes expire).
 */
export async function startWhatsAppPairing(sessionKey: string): Promise<EventEmitter> {
  // If there's an existing session, clean it up
  const existing = activePairingSessions.get(sessionKey);
  if (existing) {
    clearTimeout(existing.timeout);
    try { existing.sock.end(undefined); } catch { /* ignore */ }
    activePairingSessions.delete(sessionKey);
  }

  const emitter = new EventEmitter();
  const logger = pino({ level: 'silent' });

  const { state, saveCreds, getSerializedState } = useMemoryAuthState();

  let sock: WASocket;

  try {
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: ['Omnichannel Messenger', 'Chrome', '120.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    emitter.emit('error', error);
    return emitter;
  }

  // Auto-timeout after 2 minutes
  const timeout = setTimeout(() => {
    emitter.emit('error', new Error('QR code pairing timed out after 120 seconds'));
    try { sock.end(undefined); } catch { /* ignore */ }
    activePairingSessions.delete(sessionKey);
  }, 120_000);

  activePairingSessions.set(sessionKey, { sock, emitter, timeout });

  // Handle credential updates
  sock.ev.on('creds.update', saveCreds);

  // Handle connection updates (QR code, connected, disconnected)
  sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      emitter.emit('qr', qr);
      emitter.emit('status', 'Scan the QR code with WhatsApp on your phone');
    }

    if (connection === 'open') {
      emitter.emit('status', 'Connected to WhatsApp');

      // Build credential payload for storage
      const credentials: WhatsAppCredentials = {
        authState: getSerializedState(),
        phoneNumber: state.creds.me?.id?.split(':')[0] ?? undefined,
      };

      emitter.emit('connected', credentials);

      // Clean up the pairing session (but keep the socket reference if needed)
      clearTimeout(timeout);
      activePairingSessions.delete(sessionKey);

      // End the socket — the adapter will create its own when connect() is called
      try { sock.end(undefined); } catch { /* ignore */ }
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (!shouldReconnect) {
        emitter.emit('error', new Error('WhatsApp session logged out'));
        clearTimeout(timeout);
        activePairingSessions.delete(sessionKey);
      }
      // If shouldReconnect, Baileys will handle it automatically
    }
  });

  return emitter;
}

/**
 * Cancel an active pairing session.
 */
export function cancelPairing(sessionKey: string): void {
  const session = activePairingSessions.get(sessionKey);
  if (session) {
    clearTimeout(session.timeout);
    try { session.sock.end(undefined); } catch { /* ignore */ }
    activePairingSessions.delete(sessionKey);
  }
}

// ─── WhatsApp Adapter ───

export class WhatsAppAdapter implements MessengerAdapter {
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';
  private credentials: WhatsAppCredentials;
  private sock: WASocket | null = null;
  private logger = pino({ level: 'silent' });

  constructor(credentials: WhatsAppCredentials | Record<string, unknown>) {
    this.credentials = credentials as WhatsAppCredentials;
  }

  async connect(_credentials?: Record<string, unknown>): Promise<void> {
    const creds = (_credentials as WhatsAppCredentials | undefined) ?? this.credentials;

    if (!creds.authState) {
      // No auth state means the user hasn't paired yet.
      // The pairing flow is handled by startWhatsAppPairing(), not connect().
      throw new MessengerError('whatsapp', null, 'No WhatsApp session found. Please pair via QR code first.');
    }

    try {
      const { state, saveCreds, getSerializedState } = useMemoryAuthState(creds.authState);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.logger),
        },
        logger: this.logger,
        printQRInTerminal: false,
        browser: ['Omnichannel Messenger', 'Chrome', '120.0'],
        generateHighQualityLinkPreview: false,
        syncFullHistory: false,
      });

      // Wait for connection to open or fail
      await new Promise<void>((resolve, reject) => {
        const connectionTimeout = setTimeout(() => {
          reject(new Error('WhatsApp connection timed out'));
        }, 30_000);

        this.sock!.ev.on('connection.update', (update: Partial<ConnectionState>) => {
          if (update.connection === 'open') {
            clearTimeout(connectionTimeout);
            this.status = 'connected';
            resolve();
          }

          if (update.connection === 'close') {
            clearTimeout(connectionTimeout);
            const statusCode = (update.lastDisconnect?.error as Boom)?.output?.statusCode;

            if (statusCode === DisconnectReason.loggedOut) {
              this.status = 'session_expired';
              reject(new MessengerError('whatsapp', update.lastDisconnect?.error, 'WhatsApp session expired. Please re-pair via QR code.'));
            } else {
              this.status = 'disconnected';
              reject(new MessengerError('whatsapp', update.lastDisconnect?.error, 'WhatsApp connection closed'));
            }
          }
        });

        this.sock!.ev.on('creds.update', saveCreds);
      });

      // Update stored auth state after successful connection
      this.credentials.authState = getSerializedState();
    } catch (err) {
      if (err instanceof MessengerError) throw err;
      this.status = 'disconnected';
      throw new MessengerError('whatsapp', err, 'Failed to connect to WhatsApp');
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.sock) {
        this.sock.end(undefined);
        this.sock = null;
      }
      this.status = 'disconnected';
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to disconnect from WhatsApp');
    }
  }

  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    this.ensureConnected();

    try {
      const results: Array<{ externalChatId: string; name: string; chatType: string }> = [];

      // Fetch groups
      const groups = await this.sock!.groupFetchAllParticipating();
      for (const [jid, metadata] of Object.entries(groups)) {
        results.push({
          externalChatId: jid,
          name: metadata.subject || jid,
          chatType: 'group',
        });
      }

      // Fetch individual chats from the store (contacts)
      // Baileys exposes contacts via the 'contacts.upsert' event,
      // but we can also use the cached store. For a fresh connection,
      // contacts come in via events. We'll return groups for now and
      // contacts will be discovered as messages arrive.
      // Individual contacts are available via sock.store if configured,
      // but the default socket doesn't persist a store. We return groups only.

      return results;
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
      const jid = this.normalizeJid(externalChatId);

      const sendOptions: Record<string, unknown> = { text };

      if (options?.replyToExternalId) {
        sendOptions.quoted = {
          key: {
            remoteJid: jid,
            id: options.replyToExternalId,
          },
          message: {},
        };
      }

      const msg = await this.sock!.sendMessage(jid, sendOptions as Parameters<WASocket['sendMessage']>[1]);
      return { externalMessageId: msg?.key?.id ?? `wa_${Date.now()}` };
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
      const jid = this.normalizeJid(externalChatId);
      await this.sock!.sendMessage(jid, {
        text: newText,
        edit: {
          remoteJid: jid,
          id: externalMessageId,
          fromMe: true,
        } as Parameters<WASocket['sendMessage']>[1] extends { edit?: infer E } ? E : never,
      } as Parameters<WASocket['sendMessage']>[1]);
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
      const jid = this.normalizeJid(externalChatId);
      await this.sock!.sendMessage(jid, {
        delete: {
          remoteJid: jid,
          id: externalMessageId,
          fromMe: true,
        },
      } as Parameters<WASocket['sendMessage']>[1]);
    } catch (err) {
      throw new MessengerError('whatsapp', err, 'Failed to delete WhatsApp message');
    }
  }

  getStatus(): 'connected' | 'disconnected' | 'token_expired' | 'session_expired' {
    return this.status;
  }

  /** Get the underlying socket (for advanced usage like incoming message handlers) */
  getSocket(): WASocket | null {
    return this.sock;
  }

  /** Get the current auth state for re-encryption and persistence */
  getAuthState(): string | undefined {
    return this.credentials.authState;
  }

  private ensureConnected(): void {
    if (this.status !== 'connected' || !this.sock) {
      throw new MessengerError('whatsapp', null, 'WhatsApp adapter is not connected');
    }
  }

  private normalizeJid(chatId: string): string {
    if (chatId.includes('@')) return chatId;
    // Assume individual chat
    return `${chatId}@s.whatsapp.net`;
  }
}
