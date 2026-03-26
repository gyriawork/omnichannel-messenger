'use client';

import { useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Pin,
  Volume2,
  Star,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { useChats } from '@/hooks/useChats';
import { ImportChatsModal } from './ImportChatsModal';
import type { Chat, MessengerType } from '@/types/chat';

const MESSENGER_FILTERS: Array<{
  key: MessengerType;
  label: string;
  dotColor: string;
  bgClass: string;
  textClass: string;
}> = [
  {
    key: 'telegram',
    label: 'TG',
    dotColor: '#0088cc',
    bgClass: 'bg-messenger-tg-bg',
    textClass: 'text-messenger-tg-text',
  },
  {
    key: 'slack',
    label: 'SL',
    dotColor: '#611f69',
    bgClass: 'bg-messenger-sl-bg',
    textClass: 'text-messenger-sl-text',
  },
  {
    key: 'whatsapp',
    label: 'WA',
    dotColor: '#25D366',
    bgClass: 'bg-messenger-wa-bg',
    textClass: 'text-messenger-wa-text',
  },
  {
    key: 'gmail',
    label: 'GM',
    dotColor: '#EA4335',
    bgClass: 'bg-messenger-gm-bg',
    textClass: 'text-messenger-gm-text',
  },
];

function getMessengerDotColor(messenger: MessengerType): string {
  const map: Record<MessengerType, string> = {
    telegram: '#0088cc',
    slack: '#611f69',
    whatsapp: '#25D366',
    gmail: '#EA4335',
  };
  return map[messenger];
}

function getAvatarColor(name: string): string {
  const colors = [
    '#6366f1', '#8b5cf6', '#a855f7', '#d946ef',
    '#ec4899', '#f43f5e', '#ef4444', '#f97316',
    '#eab308', '#84cc16', '#22c55e', '#14b8a6',
    '#06b6d4', '#3b82f6', '#2563eb',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function ChatItem({ chat, isActive }: { chat: Chat; isActive: boolean }) {
  const setActiveChat = useChatStore((s) => s.setActiveChat);
  const isUnread = chat.preferences?.unread;
  const isPinned = chat.preferences?.pinned;
  const isMuted = chat.preferences?.muted;
  const isFavorite = chat.preferences?.favorite;

  return (
    <button
      onClick={() => setActiveChat(chat)}
      className={cn(
        'group flex w-full items-start gap-3 px-4 py-3 text-left transition-colors duration-150',
        isActive
          ? 'border-l-[3px] border-accent bg-accent-bg'
          : 'border-l-[3px] border-transparent hover:bg-slate-50',
      )}
    >
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-avatar text-sm font-semibold text-white"
          style={{ backgroundColor: getAvatarColor(chat.name) }}
        >
          {getInitials(chat.name)}
        </div>
        {/* Messenger dot */}
        <span
          className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white"
          style={{ backgroundColor: getMessengerDotColor(chat.messenger) }}
        />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              isUnread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700',
            )}
          >
            {chat.name}
          </span>
          <div className="flex flex-shrink-0 items-center gap-1">
            {isPinned && (
              <Pin className="h-3 w-3 text-slate-400" />
            )}
            {isFavorite && (
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            )}
            {isMuted && (
              <Volume2 className="h-3 w-3 text-slate-300" />
            )}
          </div>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-slate-500">
            {chat.lastMessage
              ? `${chat.lastMessage.senderName}: ${chat.lastMessage.text}`
              : 'No messages yet'}
          </p>
          <span className="flex-shrink-0 text-[10px] text-slate-400">
            {formatTime(chat.lastMessage?.createdAt || chat.lastActivityAt)}
          </span>
        </div>

        {/* Tags */}
        {chat.tags && chat.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {chat.tags.slice(0, 3).map((tag) => (
              <span
                key={tag.id}
                className="inline-block rounded-full px-1.5 py-0 text-[9px] font-medium"
                style={{
                  backgroundColor: `${tag.color}20`,
                  color: tag.color,
                }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Unread badge */}
      {isUnread && (
        <div className="mt-1 flex h-5 min-w-[20px] flex-shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[10px] font-bold text-white">
          {chat.messageCount > 0 ? chat.messageCount : ''}
        </div>
      )}
    </button>
  );
}

export function ChatList() {
  const [importModalOpen, setImportModalOpen] = useState(false);
  const {
    activeChat,
    searchQuery,
    setSearchQuery,
    messengerFilter,
    setMessengerFilter,
  } = useChatStore();

  const { data, isLoading } = useChats({
    search: searchQuery || undefined,
    messenger: messengerFilter,
  });

  const chats = data?.chats ?? [];

  const sortedChats = useMemo(() => {
    const pinned = chats.filter((c) => c.preferences?.pinned);
    const unpinned = chats.filter((c) => !c.preferences?.pinned);
    return [...pinned, ...unpinned];
  }, [chats]);

  return (
    <>
      <div className="flex h-full w-[300px] flex-shrink-0 flex-col border-r border-slate-200 bg-white">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-slate-100 px-4 pb-3 pt-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-800">Chats</h2>
            <button
              onClick={() => setImportModalOpen(true)}
              className="flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-xs font-medium text-white shadow-accent-sm transition-colors hover:bg-accent-hover"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Chat
            </button>
          </div>

          {/* Search */}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search chats..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-700 placeholder-slate-400 outline-none transition-shadow focus:border-accent focus:bg-white focus:shadow-focus-ring"
            />
          </div>

          {/* Filter pills */}
          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              onClick={() => setMessengerFilter(null)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                messengerFilter === null
                  ? 'bg-accent text-white'
                  : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
              )}
            >
              All
            </button>
            {MESSENGER_FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() =>
                  setMessengerFilter(messengerFilter === f.key ? null : f.key)
                }
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  messengerFilter === f.key
                    ? `${f.bgClass} ${f.textClass}`
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chat list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col gap-1 p-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-10 w-10 flex-shrink-0 animate-pulse rounded-avatar bg-slate-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3.5 w-24 animate-pulse rounded bg-slate-200" />
                    <div className="h-3 w-36 animate-pulse rounded bg-slate-100" />
                  </div>
                </div>
              ))}
            </div>
          ) : sortedChats.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <p className="text-sm font-medium text-slate-600">
                {searchQuery ? 'No chats found' : 'No chats imported yet'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {searchQuery
                  ? 'Try a different search term'
                  : 'Click "+ Add Chat" to import your conversations'}
              </p>
            </div>
          ) : (
            <div className="py-1">
              {sortedChats.map((chat) => (
                <ChatItem
                  key={chat.id}
                  chat={chat}
                  isActive={activeChat?.id === chat.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <ImportChatsModal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
      />
    </>
  );
}
