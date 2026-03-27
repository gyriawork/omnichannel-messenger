import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessengerError } from '../base.js';

// ─── Mock gramjs (telegram) ───

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  isUserAuthorized: vi.fn(),
  getDialogs: vi.fn(),
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  deleteMessages: vi.fn(),
  getMessages: vi.fn(),
  getMe: vi.fn(),
  getEntity: vi.fn(),
}));

vi.mock('telegram', () => {
  const TelegramClient = vi.fn().mockImplementation(() => ({
    connect: mocks.connect,
    disconnect: mocks.disconnect,
    isUserAuthorized: mocks.isUserAuthorized,
    getDialogs: mocks.getDialogs,
    sendMessage: mocks.sendMessage,
    editMessage: mocks.editMessage,
    deleteMessages: mocks.deleteMessages,
    getMessages: mocks.getMessages,
    getMe: mocks.getMe,
    getEntity: mocks.getEntity,
  }));
  return { TelegramClient, Api: { User: class User {} } };
});

vi.mock('telegram/sessions/index.js', () => ({
  StringSession: vi.fn().mockImplementation(() => ({})),
}));

import { TelegramAdapter } from '../telegram.js';

describe('TelegramAdapter', () => {
  let adapter: TelegramAdapter;

  const validCreds = { apiId: 12345, apiHash: 'test-hash', session: 'test-session' };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new TelegramAdapter(validCreds);
  });

  // ─── Connection ───

  describe('connect', () => {
    it('should connect successfully when authorized', async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(true);

      await adapter.connect();

      expect(adapter.getStatus()).toBe('connected');
      expect(mocks.connect).toHaveBeenCalledOnce();
      expect(mocks.isUserAuthorized).toHaveBeenCalledOnce();
    });

    it('should set session_expired when not authorized', async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(false);

      await expect(adapter.connect()).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('session_expired');
    });

    it('should throw MessengerError when connect fails', async () => {
      mocks.connect.mockRejectedValue(new Error('Network error'));

      await expect(adapter.connect()).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('disconnected');
    });

    it('should throw when apiId or apiHash is missing', async () => {
      const badAdapter = new TelegramAdapter({ apiId: 0, apiHash: '' });

      await expect(badAdapter.connect()).rejects.toThrow(MessengerError);
      expect(badAdapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── Status Tracking ───

  describe('getStatus', () => {
    it('should return disconnected by default', () => {
      expect(adapter.getStatus()).toBe('disconnected');
    });

    it('should return connected after successful connect', async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(true);
      await adapter.connect();

      expect(adapter.getStatus()).toBe('connected');
    });

    it('should return disconnected after disconnect', async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(true);
      await adapter.connect();

      mocks.disconnect.mockResolvedValue(undefined);
      await adapter.disconnect();

      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── sendMessage ───

  describe('sendMessage', () => {
    beforeEach(async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(true);
      await adapter.connect();
    });

    it('should send message and return externalMessageId', async () => {
      mocks.sendMessage.mockResolvedValue({ id: 42 });

      const result = await adapter.sendMessage('123', 'Hello');

      expect(result).toEqual({ externalMessageId: '42' });
      expect(mocks.sendMessage).toHaveBeenCalledWith(123, {
        message: 'Hello',
        replyTo: undefined,
      });
    });

    it('should pass replyTo when provided', async () => {
      mocks.sendMessage.mockResolvedValue({ id: 43 });

      await adapter.sendMessage('123', 'Reply', { replyToExternalId: '10' });

      expect(mocks.sendMessage).toHaveBeenCalledWith(123, {
        message: 'Reply',
        replyTo: 10,
      });
    });

    it('should throw MessengerError when send fails', async () => {
      mocks.sendMessage.mockRejectedValue(new Error('Send failed'));

      await expect(adapter.sendMessage('123', 'Hello')).rejects.toThrow(MessengerError);
    });

    it('should throw when not connected', async () => {
      mocks.disconnect.mockResolvedValue(undefined);
      await adapter.disconnect();

      await expect(adapter.sendMessage('123', 'Hello')).rejects.toThrow('Telegram adapter is not connected');
    });
  });

  // ─── listChats ───

  describe('listChats', () => {
    beforeEach(async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(true);
      await adapter.connect();
    });

    it('should return normalized chat objects', async () => {
      mocks.getDialogs.mockResolvedValue([
        { id: 1, title: 'Alice', isGroup: false, isChannel: false },
        { id: 2, title: 'Dev Team', isGroup: true, isChannel: false },
        { id: 3, title: 'News', isGroup: false, isChannel: true },
      ]);

      const chats = await adapter.listChats();

      expect(chats).toEqual([
        { externalChatId: '1', name: 'Alice', chatType: 'direct' },
        { externalChatId: '2', name: 'Dev Team', chatType: 'group' },
        { externalChatId: '3', name: 'News', chatType: 'channel' },
      ]);
    });

    it('should use "Unknown" for chats without title', async () => {
      mocks.getDialogs.mockResolvedValue([
        { id: 5, title: undefined, name: undefined, isGroup: false, isChannel: false },
      ]);

      const chats = await adapter.listChats();

      expect(chats[0].name).toBe('Unknown');
    });

    it('should throw MessengerError on API failure', async () => {
      mocks.getDialogs.mockRejectedValue(new Error('API error'));

      await expect(adapter.listChats()).rejects.toThrow(MessengerError);
    });
  });

  // ─── disconnect ───

  describe('disconnect', () => {
    it('should clean up and set status to disconnected', async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(true);
      await adapter.connect();

      mocks.disconnect.mockResolvedValue(undefined);
      await adapter.disconnect();

      expect(adapter.getStatus()).toBe('disconnected');
      expect(adapter.getClient()).toBeNull();
    });

    it('should be safe to call when already disconnected', async () => {
      mocks.disconnect.mockResolvedValue(undefined);
      await adapter.disconnect();

      expect(adapter.getStatus()).toBe('disconnected');
    });

    it('should throw MessengerError when disconnect fails', async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(true);
      await adapter.connect();

      mocks.disconnect.mockRejectedValue(new Error('DC failed'));

      await expect(adapter.disconnect()).rejects.toThrow(MessengerError);
    });
  });

  // ─── editMessage / deleteMessage ───

  describe('editMessage', () => {
    beforeEach(async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(true);
      await adapter.connect();
    });

    it('should edit a message', async () => {
      mocks.editMessage.mockResolvedValue(undefined);

      await adapter.editMessage('123', '42', 'Updated text');

      expect(mocks.editMessage).toHaveBeenCalledWith(123, {
        message: 42,
        text: 'Updated text',
      });
    });
  });

  describe('deleteMessage', () => {
    beforeEach(async () => {
      mocks.connect.mockResolvedValue(undefined);
      mocks.isUserAuthorized.mockResolvedValue(true);
      await adapter.connect();
    });

    it('should delete a message with revoke', async () => {
      mocks.deleteMessages.mockResolvedValue(undefined);

      await adapter.deleteMessage('123', '42');

      expect(mocks.deleteMessages).toHaveBeenCalledWith(123, [42], { revoke: true });
    });
  });
});
