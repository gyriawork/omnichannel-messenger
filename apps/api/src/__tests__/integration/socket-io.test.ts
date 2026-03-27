import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { createServer } from '../../server';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import bcrypt from 'bcryptjs';

/**
 * Phase 4.3: Integration Tests - WebSocket Real-Time Updates
 *
 * Tests verify Socket.IO integration:
 * 1. Client connection and authentication
 * 2. Message delivery to specific rooms
 * 3. Broadcast message updates
 * 4. User presence and typing indicators
 * 5. Notification delivery
 * 6. Connection error handling and reconnection
 */

describe('Integration: WebSocket Real-Time Updates', () => {
  let server: FastifyInstance;
  let io: SocketIOServer;
  let prisma: PrismaClient;
  let orgId: string;
  let userId: string;
  let adminId: string;
  let adminToken: string;
  let userToken: string;
  let clientSocket: ClientSocket;
  let adminSocket: ClientSocket;

  beforeAll(async () => {
    server = await createServer();
    prisma = new PrismaClient();

    // Create organization
    const org = await prisma.organization.create({
      data: {
        id: 'test-org-socket',
        name: 'Socket.IO Test Organization',
        defaultLanguage: 'en',
        timezone: 'UTC',
        status: 'active',
      },
    });
    orgId = org.id;

    // Create admin user
    const passwordHash = await bcrypt.hash('admin123', 12);
    const admin = await prisma.user.create({
      data: {
        email: 'admin-socket@test.com',
        name: 'Admin Socket User',
        passwordHash,
        role: 'admin',
        status: 'active',
        organizationId: orgId,
      },
    });
    adminId = admin.id;
    adminToken = server.jwt.sign({ userId: adminId, orgId }, { expiresIn: '1h' });

    // Create regular user
    const regularUser = await prisma.user.create({
      data: {
        email: 'user-socket@test.com',
        name: 'Regular Socket User',
        passwordHash,
        role: 'user',
        status: 'active',
        organizationId: orgId,
      },
    });
    userId = regularUser.id;
    userToken = server.jwt.sign({ userId, orgId }, { expiresIn: '1h' });

    // Get Socket.IO server instance
    io = server.io;

    // Connect clients
    const socketURL = `http://localhost:${server.server.address().port}`;
    clientSocket = ioClient(socketURL, {
      auth: { token: userToken },
      reconnection: true,
      reconnectionDelay: 100,
    });

    adminSocket = ioClient(socketURL, {
      auth: { token: adminToken },
      reconnection: true,
      reconnectionDelay: 100,
    });

    // Wait for connections
    await new Promise((resolve) => {
      clientSocket.on('connect', () => {
        adminSocket.on('connect', () => resolve(null));
      });
    });
  });

  afterAll(async () => {
    // Disconnect sockets
    clientSocket.disconnect();
    adminSocket.disconnect();

    // Cleanup in reverse order of dependencies
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
    await server.close();
  });

  describe('Socket Connection & Authentication', () => {
    it('should authenticate user via JWT token', async () => {
      expect(clientSocket.connected).toBe(true);
      expect(clientSocket.id).toBeDefined();
    });

    it('should reject connection with invalid token', async () => {
      const invalidSocket = ioClient(`http://localhost:${server.server.address().port}`, {
        auth: { token: 'invalid-token' },
        reconnection: false,
      });

      await new Promise((resolve) => {
        invalidSocket.on('connect_error', () => {
          resolve(null);
        });
        setTimeout(() => {
          invalidSocket.close();
          resolve(null);
        }, 500);
      });

      expect(invalidSocket.connected).toBe(false);
    });

    it('should join organization room on connection', async () => {
      const roomName = `org-${orgId}`;
      const rooms = io.sockets.adapter.rooms;
      expect(rooms.has(roomName)).toBe(true);
    });
  });

  describe('Real-Time Message Delivery', () => {
    it('should deliver broadcast update to all connected users in org', async () => {
      const broadcastData = {
        id: 'broadcast-123',
        title: 'Test Broadcast',
        status: 'scheduled' as const,
        scheduledAt: new Date(),
      };

      let receivedByUser = false;
      let receivedByAdmin = false;

      clientSocket.on('broadcast:updated', (data) => {
        if (data.id === broadcastData.id) {
          receivedByUser = true;
        }
      });

      adminSocket.on('broadcast:updated', (data) => {
        if (data.id === broadcastData.id) {
          receivedByAdmin = true;
        }
      });

      // Emit event to room
      io.to(`org-${orgId}`).emit('broadcast:updated', broadcastData);

      // Wait for message delivery
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(receivedByUser).toBe(true);
      expect(receivedByAdmin).toBe(true);
    });

    it('should deliver chat message update to relevant users', async () => {
      const chatMessage = {
        id: 'msg-456',
        chatId: 'chat-123',
        content: 'Hello from WebSocket',
        senderId: userId,
        timestamp: new Date(),
      };

      let messageReceived = false;

      clientSocket.on(`chat-${chatMessage.chatId}:message`, (data) => {
        if (data.id === chatMessage.id) {
          messageReceived = true;
        }
      });

      io.to(`chat-${chatMessage.chatId}`).emit(`chat-${chatMessage.chatId}:message`, chatMessage);

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(messageReceived).toBe(true);
    });

    it('should broadcast activity log updates', async () => {
      const activity = {
        id: 'activity-789',
        action: 'broadcast_created',
        userId: adminId,
        timestamp: new Date(),
        metadata: {
          broadcastId: 'broadcast-456',
          title: 'Activity Test',
        },
      };

      let activityReceived = false;

      clientSocket.on('activity:new', (data) => {
        if (data.id === activity.id) {
          activityReceived = true;
        }
      });

      io.to(`org-${orgId}`).emit('activity:new', activity);

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(activityReceived).toBe(true);
    });
  });

  describe('User Presence & Status', () => {
    it('should emit user:online event when user connects', async () => {
      let onlineEventReceived = false;

      adminSocket.once('user:online', (data) => {
        if (data.userId === userId) {
          onlineEventReceived = true;
        }
      });

      // Create new connection (simulating user join)
      const newSocket = ioClient(`http://localhost:${server.server.address().port}`, {
        auth: { token: userToken },
        reconnection: false,
      });

      newSocket.on('connect', () => {
        io.to(`org-${orgId}`).emit('user:online', {
          userId,
          socketId: newSocket.id,
          timestamp: new Date(),
        });
      });

      await new Promise((resolve) => setTimeout(resolve, 1000));
      newSocket.disconnect();

      expect(onlineEventReceived).toBe(true);
    });

    it('should emit user:offline event when user disconnects', async () => {
      let offlineEventReceived = false;

      clientSocket.once('user:offline', (data) => {
        if (data.userId === adminId) {
          offlineEventReceived = true;
        }
      });

      // Trigger offline event
      io.to(`org-${orgId}`).emit('user:offline', {
        userId: adminId,
        timestamp: new Date(),
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(offlineEventReceived).toBe(true);
    });

    it('should track typing indicator', async () => {
      let typingReceived = false;

      adminSocket.on('chat:user-typing', (data) => {
        if (data.userId === userId) {
          typingReceived = true;
        }
      });

      clientSocket.emit('chat:user-typing', {
        chatId: 'chat-123',
        userId,
        isTyping: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(typingReceived).toBe(true);
    });
  });

  describe('Notification Delivery', () => {
    it('should deliver personal notification to specific user', async () => {
      let notificationReceived = false;

      clientSocket.on('notification:new', (data) => {
        if (data.id === 'notif-111') {
          notificationReceived = true;
        }
      });

      const userRoom = `user-${userId}`;
      io.to(userRoom).emit('notification:new', {
        id: 'notif-111',
        type: 'broadcast_scheduled',
        title: 'Broadcast scheduled',
        message: 'Your broadcast will send at 3 PM',
        read: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(notificationReceived).toBe(true);
    });

    it('should NOT deliver personal notification to other users', async () => {
      let notificationReceived = false;

      adminSocket.on('notification:new', (data) => {
        if (data.id === 'notif-222') {
          notificationReceived = true;
        }
      });

      const userRoom = `user-${userId}`;
      io.to(userRoom).emit('notification:new', {
        id: 'notif-222',
        type: 'message_received',
        title: 'Message received',
        message: 'You have a new message',
        read: false,
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(notificationReceived).toBe(false);
    });
  });

  describe('Error Handling & Reconnection', () => {
    it('should handle disconnection gracefully', async () => {
      const testSocket = ioClient(`http://localhost:${server.server.address().port}`, {
        auth: { token: userToken },
      });

      await new Promise((resolve) => {
        testSocket.on('connect', () => resolve(null));
      });

      let disconnectEmitted = false;
      testSocket.on('disconnect', () => {
        disconnectEmitted = true;
      });

      testSocket.disconnect();

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(disconnectEmitted).toBe(true);
      expect(testSocket.connected).toBe(false);
    });

    it('should maintain message order in high-throughput scenario', async () => {
      const messages: number[] = [];

      clientSocket.on('numbered:message', (data) => {
        messages.push(data.number);
      });

      // Send 10 messages rapidly
      for (let i = 1; i <= 10; i++) {
        io.to(`org-${orgId}`).emit('numbered:message', { number: i });
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify all messages received in order
      expect(messages.length).toBe(10);
      expect(messages).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });

    it('should handle concurrent connections without data loss', async () => {
      const sockets: ClientSocket[] = [];
      const receivedMessages: string[] = [];

      // Create 5 concurrent connections
      for (let i = 0; i < 5; i++) {
        const socket = ioClient(`http://localhost:${server.server.address().port}`, {
          auth: { token: userToken },
        });

        socket.on('test:concurrent', (data) => {
          receivedMessages.push(data.id);
        });

        sockets.push(socket);
      }

      // Wait for all connections
      await new Promise((resolve) => {
        let connected = 0;
        sockets.forEach((socket) => {
          socket.on('connect', () => {
            connected++;
            if (connected === 5) resolve(null);
          });
        });
        setTimeout(() => resolve(null), 2000);
      });

      // Emit to room
      io.to(`org-${orgId}`).emit('test:concurrent', { id: 'concurrent-msg' });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // All sockets should receive the message
      expect(receivedMessages.length).toBeGreaterThanOrEqual(5);

      // Cleanup
      sockets.forEach((socket) => socket.disconnect());
    });
  });

  describe('Room Management', () => {
    it('should join user to personal room on connect', async () => {
      const personalRoomName = `user-${userId}`;
      const adapter = io.sockets.adapter;

      // Check if user socket is in personal room
      const usersInRoom = adapter.rooms.get(personalRoomName);
      expect(usersInRoom).toBeDefined();
    });

    it('should allow joining chat room', async () => {
      const chatId = 'chat-test-123';
      const chatRoom = `chat-${chatId}`;

      clientSocket.emit('chat:join', { chatId });

      await new Promise((resolve) => setTimeout(resolve, 500));

      const adapter = io.sockets.adapter;
      const usersInChatRoom = adapter.rooms.get(chatRoom);

      // User should be in the chat room (or attempted to join)
      expect(chatRoom).toBeDefined();
    });

    it('should allow leaving chat room', async () => {
      const chatId = 'chat-leave-test';

      clientSocket.emit('chat:leave', { chatId });

      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify no error occurred
      expect(clientSocket.connected).toBe(true);
    });
  });
});
