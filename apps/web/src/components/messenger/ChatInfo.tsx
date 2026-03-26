'use client';

import {
  X,
  Pin,
  Star,
  Volume2,
  VolumeX,
  Trash2,
  FileText,
  Users,
  Tag,
  User,
  Megaphone,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { useChatPreferences } from '@/hooks/useChats';
import type { Chat, MessengerType } from '@/types/chat';

function getMessengerDotColor(messenger: MessengerType): string {
  const map: Record<MessengerType, string> = {
    telegram: '#0088cc',
    slack: '#611f69',
    whatsapp: '#25D366',
    gmail: '#EA4335',
  };
  return map[messenger];
}

function getMessengerLabel(messenger: MessengerType): string {
  const map: Record<MessengerType, string> = {
    telegram: 'Telegram',
    slack: 'Slack',
    whatsapp: 'WhatsApp',
    gmail: 'Gmail',
  };
  return map[messenger];
}

function getMessengerBgClass(messenger: MessengerType): string {
  const map: Record<MessengerType, string> = {
    telegram: 'bg-messenger-tg-bg text-messenger-tg-text',
    slack: 'bg-messenger-sl-bg text-messenger-sl-text',
    whatsapp: 'bg-messenger-wa-bg text-messenger-wa-text',
    gmail: 'bg-messenger-gm-bg text-messenger-gm-text',
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

function getChatTypeLabel(chatType: string): string {
  switch (chatType) {
    case 'group':
      return 'Group chat';
    case 'channel':
      return 'Channel';
    default:
      return 'Direct message';
  }
}

function getChatTypeIcon(chatType: string) {
  switch (chatType) {
    case 'group':
      return Users;
    case 'channel':
      return Megaphone;
    default:
      return User;
  }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </h4>
  );
}

export function ChatInfo() {
  const activeChat = useChatStore((s) => s.activeChat);
  const infoPanelOpen = useChatStore((s) => s.infoPanelOpen);
  const setInfoPanelOpen = useChatStore((s) => s.setInfoPanelOpen);
  const { mutate: updatePreferences } = useChatPreferences();

  if (!activeChat || !infoPanelOpen) return null;

  const chat = activeChat;
  const prefs = chat.preferences;
  const ChatTypeIcon = getChatTypeIcon(chat.chatType);

  const togglePref = (key: 'pinned' | 'favorite' | 'muted') => {
    updatePreferences({
      chatId: chat.id,
      preferences: { [key]: !prefs?.[key] },
    });
  };

  return (
    <div className="flex h-full w-[320px] flex-shrink-0 flex-col border-l border-slate-200 bg-white">
      {/* Header */}
      <div className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-slate-100 px-5">
        <h3 className="text-sm font-semibold text-slate-800">Chat Details</h3>
        <button
          onClick={() => setInfoPanelOpen(false)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Profile section */}
        <div className="flex flex-col items-center border-b border-slate-100 px-5 pb-5 pt-6">
          <div className="relative">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-xl text-xl font-bold text-white"
              style={{ backgroundColor: getAvatarColor(chat.name) }}
            >
              {getInitials(chat.name)}
            </div>
            <span
              className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-white"
              style={{
                backgroundColor: getMessengerDotColor(chat.messenger),
              }}
            />
          </div>

          <h3 className="mt-3 text-base font-semibold text-slate-800">
            {chat.name}
          </h3>

          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                getMessengerBgClass(chat.messenger),
              )}
            >
              {getMessengerLabel(chat.messenger)}
            </span>
          </div>

          <div className="mt-2 flex items-center gap-1 text-xs text-slate-500">
            <ChatTypeIcon className="h-3.5 w-3.5" />
            <span>{getChatTypeLabel(chat.chatType)}</span>
          </div>

          {chat.ownerName && (
            <p className="mt-1 text-xs text-slate-400">
              Assigned to{' '}
              <span className="font-medium text-slate-600">
                {chat.ownerName}
              </span>
            </p>
          )}
        </div>

        {/* Quick actions */}
        <div className="border-b border-slate-100 p-4">
          <SectionTitle>Quick Actions</SectionTitle>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => togglePref('muted')}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg py-3 text-xs transition-colors',
                prefs?.muted
                  ? 'bg-red-50 text-red-600'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100',
              )}
            >
              {prefs?.muted ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
              {prefs?.muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              onClick={() => togglePref('favorite')}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg py-3 text-xs transition-colors',
                prefs?.favorite
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100',
              )}
            >
              <Star
                className={cn(
                  'h-4 w-4',
                  prefs?.favorite && 'fill-amber-400',
                )}
              />
              {prefs?.favorite ? 'Unfavorite' : 'Favorite'}
            </button>
            <button
              onClick={() => togglePref('pinned')}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-lg py-3 text-xs transition-colors',
                prefs?.pinned
                  ? 'bg-accent-bg text-accent'
                  : 'bg-slate-50 text-slate-600 hover:bg-slate-100',
              )}
            >
              <Pin className="h-4 w-4" />
              {prefs?.pinned ? 'Unpin' : 'Pin'}
            </button>
          </div>
        </div>

        {/* Tags */}
        <div className="border-b border-slate-100 p-4">
          <SectionTitle>Tags</SectionTitle>
          {chat.tags && chat.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {chat.tags.map((tag) => (
                <span
                  key={tag.id}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: `${tag.color}15`,
                    color: tag.color,
                  }}
                >
                  <Tag className="h-3 w-3" />
                  {tag.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">No tags assigned</p>
          )}
        </div>

        {/* Pinned messages */}
        <div className="border-b border-slate-100 p-4">
          <SectionTitle>Pinned Messages</SectionTitle>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3">
            <Pin className="h-4 w-4 flex-shrink-0 text-slate-400" />
            <p className="text-xs text-slate-500">
              No pinned messages in this chat
            </p>
          </div>
        </div>

        {/* Shared files */}
        <div className="border-b border-slate-100 p-4">
          <SectionTitle>Shared Files</SectionTitle>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 p-3">
            <FileText className="h-4 w-4 flex-shrink-0 text-slate-400" />
            <p className="text-xs text-slate-500">No shared files yet</p>
          </div>
        </div>

        {/* Danger zone */}
        <div className="p-4">
          <button className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100">
            <Trash2 className="h-4 w-4" />
            Delete Chat
          </button>
        </div>
      </div>
    </div>
  );
}
