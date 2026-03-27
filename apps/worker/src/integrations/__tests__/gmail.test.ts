import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessengerError } from '../base.js';

// ─── Mock googleapis ───

const mocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  getProfile: vi.fn(),
  threadsList: vi.fn(),
  threadsGet: vi.fn(),
  messagesSend: vi.fn(),
  messagesTrash: vi.fn(),
}));

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({
        setCredentials: vi.fn(),
        getAccessToken: mocks.getAccessToken,
      })),
    },
    gmail: vi.fn().mockImplementation(() => ({
      users: {
        getProfile: mocks.getProfile,
        threads: {
          list: mocks.threadsList,
          get: mocks.threadsGet,
        },
        messages: {
          send: mocks.messagesSend,
          trash: mocks.messagesTrash,
        },
      },
    })),
  },
}));

import { GmailAdapter } from '../gmail.js';

describe('GmailAdapter', () => {
  let adapter: GmailAdapter;

  const validCreds = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    refreshToken: 'test-refresh-token',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new GmailAdapter(validCreds);
  });

  // ─── Connection ───

  describe('connect', () => {
    it('should connect successfully with valid credentials', async () => {
      mocks.getAccessToken.mockResolvedValue({ token: 'valid-access-token' });
      mocks.getProfile.mockResolvedValue({ data: { emailAddress: 'user@example.com' } });

      await adapter.connect();

      expect(adapter.getStatus()).toBe('connected');
    });

    it('should throw when access token is null', async () => {
      mocks.getAccessToken.mockResolvedValue({ token: null });

      await expect(adapter.connect()).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('disconnected');
    });

    it('should set token_expired on invalid_grant error', async () => {
      mocks.getAccessToken.mockRejectedValue(new Error('invalid_grant'));

      await expect(adapter.connect()).rejects.toThrow('Gmail token is expired or revoked');
      expect(adapter.getStatus()).toBe('token_expired');
    });

    it('should set token_expired on "Token has been expired or revoked"', async () => {
      mocks.getAccessToken.mockRejectedValue(new Error('Token has been expired or revoked'));

      await expect(adapter.connect()).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('token_expired');
    });

    it('should remain disconnected on generic error', async () => {
      mocks.getAccessToken.mockRejectedValue(new Error('Network failure'));

      await expect(adapter.connect()).rejects.toThrow('Failed to connect to Gmail');
      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── Status Tracking ───

  describe('getStatus', () => {
    it('should return disconnected by default', () => {
      expect(adapter.getStatus()).toBe('disconnected');
    });

    it('should return connected after successful connect', async () => {
      mocks.getAccessToken.mockResolvedValue({ token: 'token' });
      mocks.getProfile.mockResolvedValue({ data: { emailAddress: 'u@e.com' } });
      await adapter.connect();

      expect(adapter.getStatus()).toBe('connected');
    });

    it('should return disconnected after disconnect', async () => {
      mocks.getAccessToken.mockResolvedValue({ token: 'token' });
      mocks.getProfile.mockResolvedValue({ data: { emailAddress: 'u@e.com' } });
      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  // ─── sendMessage ───

  describe('sendMessage', () => {
    beforeEach(async () => {
      mocks.getAccessToken.mockResolvedValue({ token: 'token' });
      mocks.getProfile.mockResolvedValue({ data: { emailAddress: 'me@example.com' } });
      await adapter.connect();
    });

    it('should send a reply and return externalMessageId', async () => {
      mocks.threadsGet.mockResolvedValue({
        data: {
          id: 'thread_1',
          messages: [{
            payload: {
              headers: [
                { name: 'Subject', value: 'Hello' },
                { name: 'From', value: 'sender@example.com' },
                { name: 'To', value: 'me@example.com' },
                { name: 'Message-ID', value: '<msg-id@mail>' },
              ],
            },
          }],
        },
      });
      mocks.messagesSend.mockResolvedValue({ data: { id: 'sent_msg_1' } });

      const result = await adapter.sendMessage('thread_1', 'My reply');

      expect(result).toEqual({ externalMessageId: 'sent_msg_1' });
      expect(mocks.messagesSend).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'me',
          requestBody: expect.objectContaining({
            threadId: 'thread_1',
          }),
        }),
      );
    });

    it('should throw MessengerError on send failure', async () => {
      mocks.threadsGet.mockResolvedValue({
        data: {
          id: 'thread_1',
          messages: [{ payload: { headers: [] } }],
        },
      });
      mocks.messagesSend.mockRejectedValue(new Error('Send failed'));

      await expect(adapter.sendMessage('thread_1', 'Hello')).rejects.toThrow(MessengerError);
    });

    it('should detect token error during send', async () => {
      mocks.threadsGet.mockRejectedValue(new Error('invalid_grant'));

      await expect(adapter.sendMessage('thread_1', 'Hello')).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('token_expired');
    });

    it('should throw when not connected', async () => {
      await adapter.disconnect();

      await expect(adapter.sendMessage('thread_1', 'Hello')).rejects.toThrow('Gmail adapter is not connected');
    });
  });

  // ─── listChats ───

  describe('listChats', () => {
    beforeEach(async () => {
      mocks.getAccessToken.mockResolvedValue({ token: 'token' });
      mocks.getProfile.mockResolvedValue({ data: { emailAddress: 'me@example.com' } });
      await adapter.connect();
    });

    it('should return normalized thread objects', async () => {
      mocks.threadsList.mockResolvedValue({
        data: {
          threads: [{ id: 't1' }, { id: 't2' }],
        },
      });
      mocks.threadsGet
        .mockResolvedValueOnce({
          data: {
            id: 't1',
            messages: [{
              payload: {
                headers: [
                  { name: 'Subject', value: 'Invoice' },
                  { name: 'From', value: 'Alice <alice@example.com>' },
                ],
              },
            }],
          },
        })
        .mockResolvedValueOnce({
          data: {
            id: 't2',
            messages: [{
              payload: {
                headers: [
                  { name: 'Subject', value: 'Meeting' },
                  { name: 'From', value: 'me@example.com' },
                ],
              },
            }],
          },
        });

      const chats = await adapter.listChats();

      expect(chats).toHaveLength(2);
      expect(chats[0].externalChatId).toBe('t1');
      expect(chats[0].chatType).toBe('direct');
      // From sender other than me: "From — Subject" pattern
      expect(chats[0].name).toContain('Alice');
      // From self: uses subject
      expect(chats[1].name).toBe('Meeting');
    });

    it('should return empty array when no threads exist', async () => {
      mocks.threadsList.mockResolvedValue({ data: { threads: undefined } });

      const chats = await adapter.listChats();

      expect(chats).toEqual([]);
    });

    it('should throw MessengerError on API failure', async () => {
      mocks.threadsList.mockRejectedValue(new Error('API error'));

      await expect(adapter.listChats()).rejects.toThrow(MessengerError);
    });

    it('should detect token error during listChats', async () => {
      mocks.threadsList.mockRejectedValue(new Error('Token has been expired or revoked'));

      await expect(adapter.listChats()).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('token_expired');
    });
  });

  // ─── editMessage ───

  describe('editMessage', () => {
    it('should always throw because Gmail does not support editing', async () => {
      mocks.getAccessToken.mockResolvedValue({ token: 'token' });
      mocks.getProfile.mockResolvedValue({ data: { emailAddress: 'me@example.com' } });
      await adapter.connect();

      await expect(adapter.editMessage('t1', 'msg_1', 'new text'))
        .rejects.toThrow('Gmail does not support editing sent messages');
    });
  });

  // ─── deleteMessage ───

  describe('deleteMessage', () => {
    beforeEach(async () => {
      mocks.getAccessToken.mockResolvedValue({ token: 'token' });
      mocks.getProfile.mockResolvedValue({ data: { emailAddress: 'me@example.com' } });
      await adapter.connect();
    });

    it('should trash the message', async () => {
      mocks.messagesTrash.mockResolvedValue({ data: {} });

      await adapter.deleteMessage('t1', 'msg_1');

      expect(mocks.messagesTrash).toHaveBeenCalledWith({
        userId: 'me',
        id: 'msg_1',
      });
    });

    it('should throw MessengerError on trash failure', async () => {
      mocks.messagesTrash.mockRejectedValue(new Error('Trash failed'));

      await expect(adapter.deleteMessage('t1', 'msg_1')).rejects.toThrow(MessengerError);
    });

    it('should detect token error on delete', async () => {
      mocks.messagesTrash.mockRejectedValue(new Error('invalid_grant'));

      await expect(adapter.deleteMessage('t1', 'msg_1')).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('token_expired');
    });
  });

  // ─── disconnect ───

  describe('disconnect', () => {
    it('should set status to disconnected', async () => {
      mocks.getAccessToken.mockResolvedValue({ token: 'token' });
      mocks.getProfile.mockResolvedValue({ data: { emailAddress: 'me@example.com' } });
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
});
