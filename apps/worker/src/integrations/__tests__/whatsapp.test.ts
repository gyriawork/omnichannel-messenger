import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessengerError } from '../base.js';

// ─── Mock WahaClient ───

const mockGetSession = vi.fn();
const mockStartSession = vi.fn();
const mockStopSession = vi.fn();
const mockListChats = vi.fn();
const mockSendText = vi.fn();
const mockSendImage = vi.fn();
const mockSendFile = vi.fn();
const mockDeleteMessage = vi.fn();
const mockGetMessages = vi.fn();

vi.mock('../../lib/waha-client.js', () => ({
  WahaClient: vi.fn().mockImplementation(() => ({
    getSession: mockGetSession,
    startSession: mockStartSession,
    stopSession: mockStopSession,
    listChats: mockListChats,
    sendText: mockSendText,
    sendImage: mockSendImage,
    sendFile: mockSendFile,
    deleteMessage: mockDeleteMessage,
    getMessages: mockGetMessages,
  })),
  WahaApiError: class WahaApiError extends Error {
    statusCode: number;
    responseBody: string;
    constructor(statusCode: number, responseBody: string) {
      super(`WAHA API error ${statusCode}`);
      this.name = 'WahaApiError';
      this.statusCode = statusCode;
      this.responseBody = responseBody;
    }
  },
}));

// ─── Import adapter after mocks ───

const { WhatsAppAdapter } = await import('../whatsapp.js');

describe('WhatsAppAdapter (WAHA)', () => {
  let adapter: InstanceType<typeof WhatsAppAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new WhatsAppAdapter({
      wahaSessionName: 'test-session',
      phoneNumber: '+1234567890',
    });
  });

  describe('connect', () => {
    it('should set status to connected when session is WORKING', async () => {
      mockGetSession.mockResolvedValue({ name: 'test-session', status: 'WORKING' });
      await adapter.connect();
      expect(adapter.getStatus()).toBe('connected');
    });

    it('should start a STOPPED session', async () => {
      mockGetSession.mockResolvedValue({ name: 'test-session', status: 'STOPPED' });
      await adapter.connect();
      expect(mockStartSession).toHaveBeenCalledWith('test-session');
      expect(adapter.getStatus()).toBe('connected');
    });

    it('should throw on FAILED session', async () => {
      mockGetSession.mockResolvedValue({ name: 'test-session', status: 'FAILED' });
      await expect(adapter.connect()).rejects.toThrow(MessengerError);
      expect(adapter.getStatus()).toBe('session_expired');
    });
  });

  describe('disconnect', () => {
    it('should stop the session', async () => {
      mockGetSession.mockResolvedValue({ name: 'test-session', status: 'WORKING' });
      await adapter.connect();
      await adapter.disconnect();
      expect(mockStopSession).toHaveBeenCalledWith('test-session');
      expect(adapter.getStatus()).toBe('disconnected');
    });
  });

  describe('listChats', () => {
    it('should return mapped chats', async () => {
      mockGetSession.mockResolvedValue({ name: 'test-session', status: 'WORKING' });
      await adapter.connect();

      mockListChats.mockResolvedValue([
        { id: '123@s.whatsapp.net', name: 'John', isGroup: false },
        { id: '456@g.us', name: 'Family', isGroup: true },
      ]);

      const chats = await adapter.listChats();
      expect(chats).toHaveLength(2);
      expect(chats[0]).toEqual({ externalChatId: '123@s.whatsapp.net', name: 'John', chatType: 'private' });
      expect(chats[1]).toEqual({ externalChatId: '456@g.us', name: 'Family', chatType: 'group' });
    });
  });

  describe('sendMessage', () => {
    beforeEach(async () => {
      mockGetSession.mockResolvedValue({ name: 'test-session', status: 'WORKING' });
      await adapter.connect();
    });

    it('should send text message', async () => {
      mockSendText.mockResolvedValue({ id: 'msg_1' });
      const result = await adapter.sendMessage('123@s.whatsapp.net', 'Hello');
      expect(mockSendText).toHaveBeenCalledWith('test-session', '123@s.whatsapp.net', 'Hello');
      expect(result.externalMessageId).toBe('msg_1');
    });

    it('should send image attachment with caption', async () => {
      mockSendImage.mockResolvedValue({ id: 'msg_img' });
      const result = await adapter.sendMessage('123@s.whatsapp.net', 'Caption', {
        attachments: [{ url: 'https://example.com/photo.jpg', filename: 'photo.jpg', mimeType: 'image/jpeg', size: 1024 }],
      });
      expect(mockSendImage).toHaveBeenCalledWith('test-session', '123@s.whatsapp.net', 'https://example.com/photo.jpg', 'Caption');
      expect(result.externalMessageId).toBe('msg_img');
    });

    it('should send file attachment', async () => {
      mockSendFile.mockResolvedValue({ id: 'msg_file' });
      const result = await adapter.sendMessage('123@s.whatsapp.net', 'Here is a doc', {
        attachments: [{ url: 'https://example.com/doc.pdf', filename: 'doc.pdf', mimeType: 'application/pdf', size: 2048 }],
      });
      expect(mockSendFile).toHaveBeenCalledWith('test-session', '123@s.whatsapp.net', 'https://example.com/doc.pdf', 'doc.pdf', 'Here is a doc');
      expect(result.externalMessageId).toBe('msg_file');
    });
  });

  describe('editMessage', () => {
    it('should throw — WhatsApp does not support editing', async () => {
      mockGetSession.mockResolvedValue({ name: 'test-session', status: 'WORKING' });
      await adapter.connect();
      await expect(adapter.editMessage('123', 'msg_1', 'new text')).rejects.toThrow('does not support');
    });
  });

  describe('deleteMessage', () => {
    it('should call WAHA deleteMessage', async () => {
      mockGetSession.mockResolvedValue({ name: 'test-session', status: 'WORKING' });
      await adapter.connect();
      await adapter.deleteMessage('123@s.whatsapp.net', 'msg_1');
      expect(mockDeleteMessage).toHaveBeenCalledWith('test-session', '123@s.whatsapp.net', 'msg_1');
    });
  });

  describe('getMessages', () => {
    it('should return messages oldest-first', async () => {
      mockGetSession.mockResolvedValue({ name: 'test-session', status: 'WORKING' });
      await adapter.connect();

      mockGetMessages.mockResolvedValue([
        { id: 'msg_2', body: 'Newer', fromMe: false, timestamp: 1700000002, from: '123@s.whatsapp.net', to: 'me', hasMedia: false },
        { id: 'msg_1', body: 'Older', fromMe: true, timestamp: 1700000001, from: 'me', to: '123@s.whatsapp.net', hasMedia: false },
      ]);

      const result = await adapter.getMessages('123@s.whatsapp.net', 50);
      expect(result.messages).toHaveLength(2);
      // Should be oldest-first after reverse
      expect(result.messages[0].text).toBe('Older');
      expect(result.messages[1].text).toBe('Newer');
    });
  });
});
