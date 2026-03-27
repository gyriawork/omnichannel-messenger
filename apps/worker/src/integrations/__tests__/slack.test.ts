import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessengerError } from '../base.js';

// ─── Mock @slack/web-api ───

const mocks = vi.hoisted(() => ({
  authTest: vi.fn(),
  conversationsList: vi.fn(),
  postMessage: vi.fn(),
  chatUpdate: vi.fn(),
  chatDelete: vi.fn(),
}));

vi.mock('@slack/web-api', () => ({
  WebClient: vi.fn().mockImplementation(() => ({
    auth: { test: mocks.authTest },
    conversations: { list: mocks.conversationsList },
    chat: {
      postMessage: mocks.postMessage,
      update: mocks.chatUpdate,
      delete: mocks.chatDelete,
    },
  })),
}));

import { SlackAdapter } from '../slack.js';

describe('SlackAdapter', () => {
  let adapter: SlackAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new SlackAdapter({ token: 'xoxb-test-token' });
  });

  // ─── Connection ───

  describe('connect', () => {
    it('should connect successfully when auth.test returns ok', async () => {
      mocks.authTest.mockResolvedValue({ ok: true, user_id: 'U123' });

      await adapter.connect();

      expect(adapter.getStatus()).toBe('connected');
    });

    it('should throw when auth.test returns not ok', async () => {
      mocks.authTest.mockResolvedValue({ ok: false });

      await expect(adapter.connect()).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('disconnected');
    });

    it('should set token_expired on token_revoked error', async () => {
      mocks.authTest.mockRejectedValue(new Error('token_revoked'));

      await expect(adapter.connect()).rejects.toThrow('Slack token is expired or revoked');
      expect(adapter.getStatus()).toBe('token_expired');
    });

    it('should set token_expired on token_expired error', async () => {
      mocks.authTest.mockRejectedValue(new Error('token_expired'));

      await expect(adapter.connect()).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('token_expired');
    });

    it('should set token_expired on invalid_auth error', async () => {
      mocks.authTest.mockRejectedValue(new Error('invalid_auth'));

      await expect(adapter.connect()).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('token_expired');
    });

    it('should remain disconnected on generic error', async () => {
      mocks.authTest.mockRejectedValue(new Error('Network timeout'));

      await expect(adapter.connect()).rejects.toThrow('Failed to connect to Slack');
      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── Status Tracking ───

  describe('getStatus', () => {
    it('should return disconnected by default', () => {
      expect(adapter.getStatus()).toBe('disconnected');
    });

    it('should return connected after successful connect', async () => {
      mocks.authTest.mockResolvedValue({ ok: true });
      await adapter.connect();

      expect(adapter.getStatus()).toBe('connected');
    });

    it('should return disconnected after disconnect', async () => {
      mocks.authTest.mockResolvedValue({ ok: true });
      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── sendMessage ───

  describe('sendMessage', () => {
    beforeEach(async () => {
      mocks.authTest.mockResolvedValue({ ok: true });
      await adapter.connect();
    });

    it('should send message and return ts as externalMessageId', async () => {
      mocks.postMessage.mockResolvedValue({ ok: true, ts: '1234567890.123456' });

      const result = await adapter.sendMessage('C123', 'Hello Slack');

      expect(result).toEqual({ externalMessageId: '1234567890.123456' });
      expect(mocks.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        text: 'Hello Slack',
        thread_ts: undefined,
      });
    });

    it('should pass thread_ts when replying', async () => {
      mocks.postMessage.mockResolvedValue({ ok: true, ts: '111.222' });

      await adapter.sendMessage('C123', 'Reply', { replyToExternalId: '100.200' });

      expect(mocks.postMessage).toHaveBeenCalledWith({
        channel: 'C123',
        text: 'Reply',
        thread_ts: '100.200',
      });
    });

    it('should throw when postMessage fails', async () => {
      mocks.postMessage.mockResolvedValue({ ok: false, ts: undefined });

      await expect(adapter.sendMessage('C123', 'Hello')).rejects.toThrow(MessengerError);
    });

    it('should detect token errors during sendMessage', async () => {
      mocks.postMessage.mockRejectedValue(new Error('token_revoked'));

      await expect(adapter.sendMessage('C123', 'Hello')).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('token_expired');
    });

    it('should throw when not connected', async () => {
      await adapter.disconnect();

      await expect(adapter.sendMessage('C123', 'Hello')).rejects.toThrow('Slack adapter is not connected');
    });
  });

  // ─── listChats ───

  describe('listChats', () => {
    beforeEach(async () => {
      mocks.authTest.mockResolvedValue({ ok: true });
      await adapter.connect();
    });

    it('should return normalized chat objects with correct types', async () => {
      mocks.conversationsList.mockResolvedValue({
        channels: [
          { id: 'C1', name: 'general', is_im: false, is_mpim: false },
          { id: 'D1', name: 'dm-user', is_im: true, is_mpim: false },
          { id: 'G1', name: 'group-dm', is_im: false, is_mpim: true },
        ],
        response_metadata: { next_cursor: '' },
      });

      const chats = await adapter.listChats();

      expect(chats).toEqual([
        { externalChatId: 'C1', name: 'general', chatType: 'channel' },
        { externalChatId: 'D1', name: 'dm-user', chatType: 'direct' },
        { externalChatId: 'G1', name: 'group-dm', chatType: 'group' },
      ]);
    });

    it('should paginate through all conversations', async () => {
      mocks.conversationsList
        .mockResolvedValueOnce({
          channels: [{ id: 'C1', name: 'first', is_im: false, is_mpim: false }],
          response_metadata: { next_cursor: 'cursor_page2' },
        })
        .mockResolvedValueOnce({
          channels: [{ id: 'C2', name: 'second', is_im: false, is_mpim: false }],
          response_metadata: { next_cursor: '' },
        });

      const chats = await adapter.listChats();

      expect(chats).toHaveLength(2);
      expect(mocks.conversationsList).toHaveBeenCalledTimes(2);
    });

    it('should skip channels without id', async () => {
      mocks.conversationsList.mockResolvedValue({
        channels: [
          { id: undefined, name: 'broken' },
          { id: 'C1', name: 'valid', is_im: false, is_mpim: false },
        ],
        response_metadata: {},
      });

      const chats = await adapter.listChats();

      expect(chats).toHaveLength(1);
      expect(chats[0].externalChatId).toBe('C1');
    });
  });

  // ─── disconnect ───

  describe('disconnect', () => {
    it('should set status to disconnected', async () => {
      mocks.authTest.mockResolvedValue({ ok: true });
      await adapter.connect();

      await adapter.disconnect();

      expect(adapter.getStatus()).toBe('disconnected');
    });

    it('should be safe to call multiple times', async () => {
      await adapter.disconnect();
      await adapter.disconnect();

      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── editMessage / deleteMessage ───

  describe('editMessage', () => {
    beforeEach(async () => {
      mocks.authTest.mockResolvedValue({ ok: true });
      await adapter.connect();
    });

    it('should edit a message', async () => {
      mocks.chatUpdate.mockResolvedValue({ ok: true });

      await adapter.editMessage('C123', '111.222', 'Edited text');

      expect(mocks.chatUpdate).toHaveBeenCalledWith({
        channel: 'C123',
        ts: '111.222',
        text: 'Edited text',
      });
    });

    it('should throw when update returns not ok', async () => {
      mocks.chatUpdate.mockResolvedValue({ ok: false });

      await expect(adapter.editMessage('C123', '111.222', 'text')).rejects.toThrow(MessengerError);
    });
  });

  describe('deleteMessage', () => {
    beforeEach(async () => {
      mocks.authTest.mockResolvedValue({ ok: true });
      await adapter.connect();
    });

    it('should delete a message', async () => {
      mocks.chatDelete.mockResolvedValue({ ok: true });

      await adapter.deleteMessage('C123', '111.222');

      expect(mocks.chatDelete).toHaveBeenCalledWith({
        channel: 'C123',
        ts: '111.222',
      });
    });

    it('should detect account_inactive on delete', async () => {
      mocks.chatDelete.mockRejectedValue(new Error('account_inactive'));

      await expect(adapter.deleteMessage('C123', '111.222')).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('token_expired');
    });
  });
});
