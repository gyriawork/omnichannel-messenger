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

export function useSendMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      chatId,
      text,
      replyToId,
    }: {
      chatId: string;
      text: string;
      replyToId?: string;
    }) => {
      return api.post<Message>(`/api/chats/${chatId}/messages`, {
        text,
        replyToId,
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
      chatIds,
    }: {
      messenger: MessengerType;
      chatIds: string[];
    }) => {
      return api.post<{ imported: number }>('/api/chats/import', {
        messenger,
        chatIds,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    },
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
