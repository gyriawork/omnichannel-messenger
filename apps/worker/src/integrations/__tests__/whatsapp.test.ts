import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessengerError } from '../base.js';

// ─── Mock Baileys ───

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  groupFetchAllParticipating: vi.fn(),
  end: vi.fn(),
}));

// Connection update handler will be captured here so tests can trigger events
let connectionUpdateHandler: ((update: Record<string, unknown>) => void) | null = null;

vi.mock('@whiskeysockets/baileys', () => {
  const makeWASocket = vi.fn().mockImplementation(() => ({
    sendMessage: mocks.sendMessage,
    groupFetchAllParticipating: mocks.groupFetchAllParticipating,
    end: mocks.end,
    ev: {
      on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === 'connection.update') {
          connectionUpdateHandler = handler as (update: Record<string, unknown>) => void;
        }
      }),
    },
  }));

  // The source does `import baileys from '...'` then destructures named exports
  // from `baileys as any`, so the default export needs to be callable AND have
  // the named exports as properties.
  const baileysDefault = Object.assign(makeWASocket, {
    default: makeWASocket,
    makeWASocket,
    DisconnectReason: { loggedOut: 401, connectionClosed: 428 },
    fetchLatestBaileysVersion: vi.fn().mockResolvedValue({ version: [2, 3000, 1015901307] }),
    makeCacheableSignalKeyStore: vi.fn().mockImplementation((keys: unknown) => keys),
    initAuthCreds: vi.fn().mockReturnValue({ me: null }),
  });

  return { default: baileysDefault, ...baileysDefault };
});

vi.mock('@hapi/boom', () => ({
  Boom: class Boom extends Error {
    output: { statusCode: number };
    constructor(msg: string, opts?: { statusCode?: number }) {
      super(msg);
      this.output = { statusCode: opts?.statusCode ?? 500 };
    }
  },
}));

vi.mock('pino', () => ({
  default: vi.fn().mockReturnValue({ level: 'silent', child: vi.fn().mockReturnValue({ level: 'silent' }) }),
}));

import { WhatsAppAdapter } from '../whatsapp.js';

describe('WhatsAppAdapter', () => {
  let adapter: WhatsAppAdapter;

  const validCreds = {
    authState: JSON.stringify({
      creds: { me: { id: '1234@s.whatsapp.net' } },
      keys: {},
    }),
    phoneNumber: '1234567890',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    connectionUpdateHandler = null;
    adapter = new WhatsAppAdapter(validCreds);
  });

  // ─── Connection ───

  describe('connect', () => {
    it('should connect successfully when connection opens', async () => {
      const connectPromise = adapter.connect();
      // Simulate connection opening
      connectionUpdateHandler?.({ connection: 'open' });
      await connectPromise;

      expect(adapter.getStatus()).toBe('connected');
    });

    it('should throw when no authState is provided', async () => {
      const noAuthAdapter = new WhatsAppAdapter({ phoneNumber: '123' });

      await expect(noAuthAdapter.connect()).rejects.toThrow('No WhatsApp session found');
      expect(noAuthAdapter.getStatus()).toBe('disconnected');
    });

    it('should set session_expired on loggedOut disconnect', async () => {
      const connectPromise = adapter.connect();
      // Simulate disconnect with loggedOut reason
      connectionUpdateHandler?.({
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 401 } },
        },
      });

      await expect(connectPromise).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('session_expired');
    });

    it('should set disconnected on non-loggedOut close', async () => {
      const connectPromise = adapter.connect();
      connectionUpdateHandler?.({
        connection: 'close',
        lastDisconnect: {
          error: { output: { statusCode: 428 } },
        },
      });

      await expect(connectPromise).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── Status Tracking ───

  describe('getStatus', () => {
    it('should return disconnected by default', () => {
      expect(adapter.getStatus()).toBe('disconnected');
    });

    it('should return connected after open event', async () => {
      const p = adapter.connect();
      connectionUpdateHandler?.({ connection: 'open' });
      await p;

      expect(adapter.getStatus()).toBe('connected');
    });

    it('should return disconnected after disconnect', async () => {
      const p = adapter.connect();
      connectionUpdateHandler?.({ connection: 'open' });
      await p;

      await adapter.disconnect();

      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── sendMessage ───

  describe('sendMessage', () => {
    beforeEach(async () => {
      const p = adapter.connect();
      connectionUpdateHandler?.({ connection: 'open' });
      await p;
    });

    it('should send message and return externalMessageId', async () => {
      mocks.sendMessage.mockResolvedValue({ key: { id: 'wa_msg_1' } });

      const result = await adapter.sendMessage('1234567890', 'Hello WA');

      expect(result).toEqual({ externalMessageId: 'wa_msg_1' });
    });

    it('should normalize JID when no @ is present', async () => {
      mocks.sendMessage.mockResolvedValue({ key: { id: 'wa_msg_2' } });

      await adapter.sendMessage('1234567890', 'Hello');

      expect(mocks.sendMessage).toHaveBeenCalledWith(
        '1234567890@s.whatsapp.net',
        expect.objectContaining({ text: 'Hello' }),
      );
    });

    it('should pass JID as-is when it contains @', async () => {
      mocks.sendMessage.mockResolvedValue({ key: { id: 'wa_msg_3' } });

      await adapter.sendMessage('group@g.us', 'Hello group');

      expect(mocks.sendMessage).toHaveBeenCalledWith(
        'group@g.us',
        expect.objectContaining({ text: 'Hello group' }),
      );
    });

    it('should throw MessengerError on send failure', async () => {
      mocks.sendMessage.mockRejectedValue(new Error('Send failed'));

      await expect(adapter.sendMessage('123', 'Hello')).rejects.toThrow(MessengerError);
    });

    it('should throw when not connected', async () => {
      await adapter.disconnect();

      await expect(adapter.sendMessage('123', 'Hello')).rejects.toThrow('WhatsApp adapter is not connected');
    });

    it('should generate fallback ID when msg key is null', async () => {
      mocks.sendMessage.mockResolvedValue(null);

      const result = await adapter.sendMessage('123', 'Hello');

      expect(result.externalMessageId).toMatch(/^wa_\d+$/);
    });
  });

  // ─── listChats ───

  describe('listChats', () => {
    beforeEach(async () => {
      const p = adapter.connect();
      connectionUpdateHandler?.({ connection: 'open' });
      await p;
    });

    it('should return normalized group chat objects', async () => {
      mocks.groupFetchAllParticipating.mockResolvedValue({
        'group1@g.us': { subject: 'Dev Team' },
        'group2@g.us': { subject: 'Marketing' },
      });

      const chats = await adapter.listChats();

      expect(chats).toEqual([
        { externalChatId: 'group1@g.us', name: 'Dev Team', chatType: 'group' },
        { externalChatId: 'group2@g.us', name: 'Marketing', chatType: 'group' },
      ]);
    });

    it('should use JID as name when subject is empty', async () => {
      mocks.groupFetchAllParticipating.mockResolvedValue({
        'group@g.us': { subject: '' },
      });

      const chats = await adapter.listChats();

      expect(chats[0].name).toBe('group@g.us');
    });

    it('should throw MessengerError on API failure', async () => {
      mocks.groupFetchAllParticipating.mockRejectedValue(new Error('Fetch error'));

      await expect(adapter.listChats()).rejects.toThrow(MessengerError);
    });
  });

  // ─── disconnect ───

  describe('disconnect', () => {
    it('should end socket and set status to disconnected', async () => {
      const p = adapter.connect();
      connectionUpdateHandler?.({ connection: 'open' });
      await p;

      await adapter.disconnect();

      expect(mocks.end).toHaveBeenCalled();
      expect(adapter.getStatus()).toBe('disconnected');
      expect(adapter.getSocket()).toBeNull();
    });

    it('should be safe to call when already disconnected', async () => {
      await adapter.disconnect();

      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── editMessage / deleteMessage ───

  describe('editMessage', () => {
    beforeEach(async () => {
      const p = adapter.connect();
      connectionUpdateHandler?.({ connection: 'open' });
      await p;
    });

    it('should send edit message via sendMessage', async () => {
      mocks.sendMessage.mockResolvedValue({ key: { id: 'edit_1' } });

      await adapter.editMessage('123@s.whatsapp.net', 'msg_1', 'Updated');

      expect(mocks.sendMessage).toHaveBeenCalledWith(
        '123@s.whatsapp.net',
        expect.objectContaining({ text: 'Updated' }),
      );
    });
  });

  describe('deleteMessage', () => {
    beforeEach(async () => {
      const p = adapter.connect();
      connectionUpdateHandler?.({ connection: 'open' });
      await p;
    });

    it('should send delete via sendMessage', async () => {
      mocks.sendMessage.mockResolvedValue({ key: { id: 'del_1' } });

      await adapter.deleteMessage('123@s.whatsapp.net', 'msg_1');

      expect(mocks.sendMessage).toHaveBeenCalledWith(
        '123@s.whatsapp.net',
        expect.objectContaining({
          delete: expect.objectContaining({ id: 'msg_1' }),
        }),
      );
    });
  });
});
