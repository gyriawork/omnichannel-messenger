'use client';

import {
  useQuery,
  useMutation,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  Chat,
  Message,
  ChatFilters,
  AvailableChat,
  MessengerType,
} from '@/types/chat';

interface ChatsResponse {
  chats: Chat[];
  total: number;
}

interface MessagesResponse {
  messages: Message[];
  nextCursor?: string;
}

export function useChats(filters?: ChatFilters) {
  return useQuery({
    queryKey: ['chats', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.search) params.set('search', filters.search);
      if (filters?.messenger) params.set('messenger', filters.messenger);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.ownerId) params.set('ownerId', filters.ownerId);
      if (filters?.tagId) params.set('tagId', filters.tagId);
      const query = params.toString();
      return api.get<ChatsResponse>(
        `/api/chats${query ? `?${query}` : ''}`,
      );
    },
  });
}

export function useChat(id: string | undefined) {
  return useQuery({
    queryKey: ['chat', id],
    queryFn: () => api.get<Chat>(`/api/chats/${id}`),
    enabled: !!id,
  });
}

export function useMessages(chatId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ['messages', chatId],
    queryFn: async ({ pageParam }: { pageParam?: string }) => {
      const params = new URLSearchParams();
      if (pageParam) params.set('cursor', pageParam);
      params.set('limit', '50');
      const query = params.toString();
      return api.get<MessagesResponse>(
        `/api/chats/${chatId}/messages${query ? `?${query}` : ''}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!chatId,
  });
}

export interface MessageAttachment {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      chatId,
      text,
      replyToId,
      attachments,
    }: {
      chatId: string;
      text: string;
      replyToId?: string;
      attachments?: MessageAttachment[];
    }) => {
      return api.post<Message>(`/api/chats/${chatId}/messages`, {
        text,
        replyToMessageId: replyToId,
        attachments,
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['messages', variables.chatId],
      });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useAvailableChats(messenger: MessengerType | null) {
  return useQuery({
    queryKey: ['available-chats', messenger],
    queryFn: () =>
      api.get<{ chats: AvailableChat[] }>(
        `/api/chats/available/${messenger}`,
      ),
    enabled: !!messenger,
  });
}

export function useImportChats() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messenger,
      chats,
    }: {
      messenger: MessengerType;
      chats: { externalChatId: string; name: string; chatType: string }[];
    }) => {
      return api.post<{ imported: number }>('/api/chats/import', {
        messenger,
        chats,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useEditMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ messageId, text }: { messageId: string; text: string }) =>
      api.patch(`/api/messages/${messageId}`, { text }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

export function useDeleteMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => api.delete(`/api/messages/${messageId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

export function usePinMessage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      messageId,
      isPinned,
    }: {
      messageId: string;
      isPinned: boolean;
    }) => api.patch(`/api/messages/${messageId}/pin`, { isPinned }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages'] });
    },
  });
}

export function useSearchMessages(chatId: string | undefined, query: string) {
  return useQuery({
    queryKey: ['messages-search', chatId, query],
    queryFn: () =>
      api.get<{ messages: Message[] }>(
        `/api/chats/${chatId}/messages/search?q=${encodeURIComponent(query)}&limit=20`,
      ),
    enabled: !!chatId && query.length >= 2,
  });
}

export function useDeleteChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (chatId: string) => api.delete(`/api/chats/${chatId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useUpdateChat() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      chatId,
      ...data
    }: {
      chatId: string;
      ownerId?: string;
      status?: string;
      tags?: string[];
    }) => api.patch(`/api/chats/${chatId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['chat'] });
    },
  });
}

export function useTags() {
  return useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<{ tags: Array<{ id: string; name: string; color: string }> }>('/api/tags'),
  });
}

export function useChatPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      chatId,
      preferences,
    }: {
      chatId: string;
      preferences: {
        pinned?: boolean;
        favorite?: boolean;
        muted?: boolean;
      };
    }) => {
      return api.patch<void>(
        `/api/chats/${chatId}/preferences`,
        preferences,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
  });
}

export function useBulkAssignChats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { chatIds: string[]; ownerId: string }) => api.post('/api/chats/bulk/assign', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chats'] }),
  });
}

export function useBulkTagChats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { chatIds: string[]; tagId: string; action: 'add' | 'remove' }) => api.post('/api/chats/bulk/tag', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chats'] }),
  });
}

export function useBulkDeleteChats() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chatIds: string[]) => api.post('/api/chats/bulk', { chatIds }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chats'] }),
  });
}
