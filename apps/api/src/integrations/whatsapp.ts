// ─── WhatsApp Adapter (Baileys) ───
// Real implementation using @whiskeysockets/baileys with QR code auth flow.

import baileys from '@whiskeysockets/baileys';
import type {
  WASocket,
  ConnectionState,
  AuthenticationState,
  AuthenticationCreds,
  SignalDataTypeMap,
  SignalDataSet,
  SignalKeyStore,
} from '@whiskeysockets/baileys';

// Handle ESM/CJS interop: baileys default export may be the function or the whole module
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _mod: any = baileys;
const _ns = (typeof _mod === 'function' ? _mod : null) ? { default: _mod } : _mod;
const makeWASocket = (_ns.default ?? _ns.makeWASocket) as typeof baileys;
const DisconnectReason = _ns.DisconnectReason ?? (_ns.default?.DisconnectReason);
const fetchLatestBaileysVersion = _ns.fetchLatestBaileysVersion ?? (_ns.default?.fetchLatestBaileysVersion);
const makeCacheableSignalKeyStore = _ns.makeCacheableSignalKeyStore ?? (_ns.default?.makeCacheableSignalKeyStore);
const initAuthCreds = _ns.initAuthCreds ?? (_ns.default?.initAuthCreds);

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

  const createCreds = typeof initAuthCreds === 'function'
    ? initAuthCreds
    : () => ({} as AuthenticationCreds);

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
      creds = createCreds();
    }
  } else {
    creds = createCreds();
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

  console.log(`[WhatsApp] Starting pairing session: ${sessionKey}`);
  const emitter = new EventEmitter();
  const logger = pino({ level: 'silent' });

  const { state, saveCreds, getSerializedState } = useMemoryAuthState();

  let sock: WASocket;
  let qrTimeout: ReturnType<typeof setTimeout> | null = null;

  try {
    // Fetch latest Baileys version with a 5-second timeout; fall back to a
    // known-good version so QR generation is not blocked by a slow network call.
    const FALLBACK_VERSION: [number, number, number] = [2, 3000, 1015901307];
    let version: [number, number, number] = FALLBACK_VERSION;
    if (typeof fetchLatestBaileysVersion === 'function') {
      try {
        const result = await Promise.race([
          fetchLatestBaileysVersion(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('version fetch timeout')), 5000),
          ),
        ]);
        version = result.version;
      } catch {
        // Use fallback version silently
      }
    }

    if (typeof makeWASocket !== 'function') {
      throw new Error('Baileys makeWASocket not found — check @whiskeysockets/baileys installation');
    }

    const keyStore = typeof makeCacheableSignalKeyStore === 'function'
      ? makeCacheableSignalKeyStore(state.keys, logger)
      : state.keys;

    sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: keyStore,
      },
      logger,
      printQRInTerminal: false,
      browser: ['Omnichannel Messenger', 'Chrome', '120.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
    });
    console.log(`[WhatsApp] Socket created for session: ${sessionKey}`);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error(`[WhatsApp] Socket creation failed for session ${sessionKey}:`, error.message);
    // Defer emission so the caller can attach listeners before the error fires
    process.nextTick(() => emitter.emit('error', error));
    return emitter;
  }

  // Auto-timeout after 2 minutes
  const timeout = setTimeout(() => {
    console.log(`[WhatsApp] Session timed out after 120 seconds: ${sessionKey}`);
    emitter.emit('error', new Error('QR code pairing timed out after 120 seconds'));
    try { sock.end(undefined); } catch { /* ignore */ }
    activePairingSessions.delete(sessionKey);
  }, 120_000);

  activePairingSessions.set(sessionKey, { sock, emitter, timeout });

  // Handle credential updates
  sock.ev.on('creds.update', saveCreds);
  console.log(`[WhatsApp] Registered creds.update listener for session: ${sessionKey}`);

  // Handle connection updates (QR code, connected, disconnected)
  sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;
    console.log(`[WhatsApp] Connection update for session ${sessionKey}:`, {
      connection,
      hasQr: !!qr,
      hasLastDisconnect: !!lastDisconnect,
    });

    if (qr) {
      console.log(`[WhatsApp] QR code generated for session: ${sessionKey}`);
      // Clear QR timeout on new QR (Baileys regenerates ~every 20s)
      if (qrTimeout !== null) {
        clearTimeout(qrTimeout);
      }
      // Reset QR timeout: if no 'open' event within 30s, fail the session
      qrTimeout = setTimeout(() => {
        console.error(`[WhatsApp] QR code not scanned within 30 seconds for session: ${sessionKey}`);
        emitter.emit('error', new Error('QR code was not scanned within 30 seconds'));
        try { sock.end(undefined); } catch { /* ignore */ }
        activePairingSessions.delete(sessionKey);
        clearTimeout(timeout);
      }, 30_000);

      emitter.emit('qr', qr);
      emitter.emit('status', 'Scan the QR code with WhatsApp on your phone');
    }

    if (connection === 'open') {
      console.log(`[WhatsApp] Connected to WhatsApp for session: ${sessionKey}`);
      // Clear QR timeout on successful connection
      if (qrTimeout !== null) {
        clearTimeout(qrTimeout);
        qrTimeout = null;
      }
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
      console.log(`[WhatsApp] Connection closed for session ${sessionKey}:`, {
        lastDisconnect: lastDisconnect?.error?.message,
      });
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (!shouldReconnect) {
        console.log(`[WhatsApp] Session logged out for session: ${sessionKey}`);
        emitter.emit('error', new Error('WhatsApp session logged out'));
        if (qrTimeout !== null) {
          clearTimeout(qrTimeout);
          qrTimeout = null;
        }
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
      const FALLBACK_VERSION: [number, number, number] = [2, 3000, 1015901307];
      let version: [number, number, number] = FALLBACK_VERSION;
      try {
        const result = await Promise.race([
          fetchLatestBaileysVersion(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('version fetch timeout')), 5000),
          ),
        ]);
        version = result.version;
      } catch {
        // Use fallback version silently
      }

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
    options?: {
      replyToExternalId?: string;
      attachments?: Array<{ url: string; filename: string; mimeType: string }>;
    },
  ): Promise<{ externalMessageId: string }> {
    this.ensureConnected();

    try {
      const jid = this.normalizeJid(externalChatId);

      const quotedMsg = options?.replyToExternalId
        ? { key: { remoteJid: jid, id: options.replyToExternalId }, message: {} }
        : undefined;

      if (options?.attachments && options.attachments.length > 0) {
        let firstMessageId: string | undefined;

        for (let i = 0; i < options.attachments.length; i++) {
          const attachment = options.attachments[i];
          const isImage = attachment.mimeType.startsWith('image/');

          try {
            let msgContent: Parameters<WASocket['sendMessage']>[1];

            if (isImage) {
              msgContent = {
                image: { url: attachment.url },
                caption: i === 0 ? text : '',
              } as Parameters<WASocket['sendMessage']>[1];
            } else {
              // For non-image attachments: send text first on the first iteration, then document
              if (i === 0 && text) {
                const textOptions: Record<string, unknown> = { text };
                if (quotedMsg) textOptions.quoted = quotedMsg;
                const textMsg = await this.sock!.sendMessage(jid, textOptions as Parameters<WASocket['sendMessage']>[1]);
                firstMessageId = textMsg?.key?.id ?? `wa_${Date.now()}`;
              }

              msgContent = {
                document: { url: attachment.url },
                fileName: attachment.filename,
                mimetype: attachment.mimeType,
              } as Parameters<WASocket['sendMessage']>[1];
            }

            const sendOpts: Record<string, unknown> = { ...msgContent as object };
            if (i === 0 && quotedMsg && isImage) sendOpts.quoted = quotedMsg;

            const msg = await this.sock!.sendMessage(jid, sendOpts as Parameters<WASocket['sendMessage']>[1]);

            if (i === 0 && !firstMessageId) {
              firstMessageId = msg?.key?.id ?? `wa_${Date.now()}`;
            }
          } catch {
            // If attachment send fails, continue with remaining attachments
          }
        }

        // If all attachment sends failed, fall back to text-only
        if (!firstMessageId) {
          const textOptions: Record<string, unknown> = { text };
          if (quotedMsg) textOptions.quoted = quotedMsg;
          const msg = await this.sock!.sendMessage(jid, textOptions as Parameters<WASocket['sendMessage']>[1]);
          return { externalMessageId: msg?.key?.id ?? `wa_${Date.now()}` };
        }

        return { externalMessageId: firstMessageId };
      }

      // Text-only path (original behavior)
      const sendOptions: Record<string, unknown> = { text };
      if (quotedMsg) sendOptions.quoted = quotedMsg;

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
