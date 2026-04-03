'use client';

import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '@/stores/auth';
import { useQueryClient } from '@tanstack/react-query';
import type { Message } from '@/types/chat';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

let socket: Socket | null = null;

export function getSocket(): Socket | null {
  return socket;
}

export function useSocket() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const queryClient = useQueryClient();
  const connectedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      if (socket) {
        socket.disconnect();
        socket = null;
        connectedRef.current = false;
      }
      return;
    }

    // Disconnect existing socket if token changed
    if (socket) {
      socket.disconnect();
      socket = null;
      connectedRef.current = false;
    }

    socket = io(SOCKET_URL, {
      path: '/socket.io',
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => {
      connectedRef.current = true;
      console.log('[WS] Connected');
    });

    socket.on('disconnect', (reason) => {
      connectedRef.current = false;
      console.log('[WS] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[WS] Connection error:', err.message);
    });

    // Real-time message received → optimistically insert into cache
    socket.on('new_message', (data: { chatId: string; message: Message }) => {
      if (data.message) {
        queryClient.setQueryData(
          ['messages', data.chatId],
          (oldData: { pages: Array<{ messages: Message[]; nextCursor?: string }>; pageParams: unknown[] } | undefined) => {
            if (!oldData?.pages) return oldData;
            const firstPage = oldData.pages[0];
            if (!firstPage) return oldData;

            // Check for duplicate
            const allMessages = oldData.pages.flatMap((p) => p.messages);
            if (allMessages.some((m) => m.id === data.message.id)) return oldData;

            return {
              ...oldData,
              pages: [
                { ...firstPage, messages: [data.message, ...firstPage.messages] },
                ...oldData.pages.slice(1),
              ],
            };
          },
        );
      }
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    });

    // Message updated
    socket.on('message_updated', (data: { chatId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['messages', data.chatId] });
    });

    // Message deleted
    socket.on('message_deleted', (data: { chatId: string }) => {
      queryClient.invalidateQueries({ queryKey: ['messages', data.chatId] });
    });

    // Chat updated (new message count, last activity, etc.)
    socket.on('chat_updated', () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    });

    // Broadcast status update
    socket.on('broadcast_status', () => {
      queryClient.invalidateQueries({ queryKey: ['broadcasts'] });
    });

    // Typing indicator
    socket.on('typing', (_data: { chatId: string; userId: string; userName: string }) => {
      // Typing state is handled at the component level
    });

    return () => {
      if (socket) {
        socket.disconnect();
        socket = null;
        connectedRef.current = false;
      }
    };
  }, [isAuthenticated, accessToken, queryClient]);

  const joinChat = useCallback((chatId: string) => {
    socket?.emit('join_chat', { chatId });
  }, []);

  const leaveChat = useCallback((chatId: string) => {
    socket?.emit('leave_chat', { chatId });
  }, []);

  const sendTyping = useCallback((chatId: string) => {
    socket?.emit('typing', { chatId });
  }, []);

  const markRead = useCallback((chatId: string, messageId: string) => {
    socket?.emit('mark_read', { chatId, messageId });
  }, []);

  return {
    isConnected: connectedRef.current,
    joinChat,
    leaveChat,
    sendTyping,
    markRead,
  };
}
