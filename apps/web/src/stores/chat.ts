'use client';

import { create } from 'zustand';
import type { Chat, Message, MessengerType } from '@/types/chat';

interface ChatStore {
  chats: Chat[];
  activeChat: Chat | null;
  messages: Message[];
  isLoadingChats: boolean;
  isLoadingMessages: boolean;
  searchQuery: string;
  messengerFilter: MessengerType | null;
  tagFilter: string | null;
  infoPanelOpen: boolean;
  replyingTo: Message | null;
  mobileView: 'list' | 'chat' | 'info';
  setMobileView: (view: 'list' | 'chat' | 'info') => void;
  // Email thread: which message is currently expanded (Gmail chats only)
  expandedMessageId: string | null;
  setExpandedMessageId: (id: string | null) => void;

  setActiveChat: (chat: Chat | null) => void;
  setSearchQuery: (q: string) => void;
  setMessengerFilter: (m: MessengerType | null) => void;
  setTagFilter: (tagId: string | null) => void;
  setChats: (chats: Chat[]) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  removeMessage: (id: string) => void;
  setInfoPanelOpen: (open: boolean) => void;
  toggleInfoPanel: () => void;
  setReplyingTo: (message: Message | null) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  chats: [],
  activeChat: null,
  messages: [],
  isLoadingChats: false,
  isLoadingMessages: false,
  searchQuery: '',
  messengerFilter: null,
  tagFilter: null,
  infoPanelOpen: false,
  replyingTo: null,
  mobileView: 'list' as const,
  expandedMessageId: null,

  setActiveChat: (chat) =>
    set({
      activeChat: chat,
      messages: [],
      replyingTo: null,
      mobileView: chat ? 'chat' : 'list',
      expandedMessageId: null,
    }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setMessengerFilter: (messengerFilter) => set({ messengerFilter }),

  setTagFilter: (tagFilter) => set({ tagFilter }),

  setChats: (chats) => set({ chats }),

  setMessages: (messages) => set({ messages }),

  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  updateMessage: (id, updates) =>
    set((state) => ({
      messages: state.messages.map((m) =>
        m.id === id ? { ...m, ...updates } : m,
      ),
    })),

  removeMessage: (id) =>
    set((state) => ({
      messages: state.messages.filter((m) => m.id !== id),
    })),

  setInfoPanelOpen: (infoPanelOpen) => set({ infoPanelOpen }),

  toggleInfoPanel: () =>
    set((state) => ({ infoPanelOpen: !state.infoPanelOpen })),

  setReplyingTo: (replyingTo) => set({ replyingTo }),

  setMobileView: (mobileView) => set({ mobileView }),

  setExpandedMessageId: (expandedMessageId) => set({ expandedMessageId }),
}));
