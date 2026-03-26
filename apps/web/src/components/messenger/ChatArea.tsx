'use client';

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type FormEvent,
} from 'react';
import {
  Send,
  Paperclip,
  Pin,
  Search,
  PanelRightOpen,
  MessageSquare,
  User,
  Users,
  Megaphone,
  X,
  Reply,
  Check,
  CheckCheck,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useChatStore } from '@/stores/chat';
import { useMessages, useSendMessage } from '@/hooks/useChats';
import type { Chat, Message, MessengerType } from '@/types/chat';

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

function formatMessageTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round(
    (today.getTime() - msgDate.getTime()) / 86400000,
  );

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], {
    month: 'long',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

function DeliveryIcon({ status }: { status?: string }) {
  switch (status) {
    case 'sent':
      return <Check className="h-3 w-3 text-white/60" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3 text-white/60" />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-white" />;
    default:
      return null;
  }
}

function MessageBubble({
  message,
  onReply,
}: {
  message: Message;
  onReply: (message: Message) => void;
}) {
  const isSelf = message.isSelf;

  return (
    <div
      className={cn(
        'group flex max-w-[70%] flex-col',
        isSelf ? 'ml-auto items-end' : 'mr-auto items-start',
      )}
    >
      {/* Reply quote */}
      {message.replyToMessage && (
        <div
          className={cn(
            'mb-1 flex items-start gap-2 rounded-lg px-3 py-1.5 text-xs',
            isSelf
              ? 'bg-accent/20 text-accent-hover'
              : 'border-l-2 border-accent bg-accent-bg text-slate-600',
          )}
        >
          <Reply className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <div className="min-w-0">
            <span className="font-semibold">
              {message.replyToMessage.senderName}
            </span>
            <p className="truncate">{message.replyToMessage.text}</p>
          </div>
        </div>
      )}

      <div
        className={cn(
          'relative rounded-[18px] px-3.5 py-2 text-sm leading-relaxed',
          isSelf
            ? 'rounded-br-[4px] bg-accent text-white'
            : 'rounded-bl-[4px] bg-white text-slate-800 shadow-xs',
        )}
      >
        {/* Sender name for incoming */}
        {!isSelf && (
          <p className="mb-0.5 text-xs font-semibold text-accent">
            {message.senderName}
          </p>
        )}

        {/* Pinned indicator */}
        {message.isPinned && (
          <div
            className={cn(
              'mb-1 flex items-center gap-1 text-[10px]',
              isSelf ? 'text-white/70' : 'text-slate-400',
            )}
          >
            <Pin className="h-2.5 w-2.5" />
            Pinned
          </div>
        )}

        {/* Text */}
        <p className="whitespace-pre-wrap break-words">{message.text}</p>

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {message.attachments.map((att, i) => (
              <a
                key={i}
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center gap-2 rounded-lg p-2 text-xs transition-colors',
                  isSelf
                    ? 'bg-white/10 hover:bg-white/20'
                    : 'bg-slate-50 hover:bg-slate-100',
                )}
              >
                <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{att.filename}</span>
                <span className="flex-shrink-0 opacity-60">
                  {(att.size / 1024).toFixed(0)}KB
                </span>
              </a>
            ))}
          </div>
        )}

        {/* Footer: time + edited + delivery */}
        <div
          className={cn(
            'mt-1 flex items-center gap-1.5 text-[10px]',
            isSelf ? 'justify-end text-white/60' : 'text-slate-400',
          )}
        >
          {message.editedAt && (
            <span className="flex items-center gap-0.5">
              <Pencil className="h-2.5 w-2.5" />
              edited
            </span>
          )}
          <span>{formatMessageTime(message.createdAt)}</span>
          {isSelf && <DeliveryIcon status={message.deliveryStatus} />}
        </div>

        {/* Reply button on hover */}
        <button
          onClick={() => onReply(message)}
          className={cn(
            'absolute top-1 opacity-0 transition-opacity group-hover:opacity-100',
            isSelf ? '-left-8' : '-right-8',
          )}
          title="Reply"
        >
          <Reply className="h-4 w-4 text-slate-400 hover:text-accent" />
        </button>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-[#f8fafc]">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-accent-bg">
        <MessageSquare className="h-7 w-7 text-accent" />
      </div>
      <h2 className="text-lg font-semibold text-slate-800">
        Select a chat to start messaging
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        Choose a conversation from the list on the left
      </p>
    </div>
  );
}

function ChatHeader({ chat }: { chat: Chat }) {
  const toggleInfoPanel = useChatStore((s) => s.toggleInfoPanel);
  const ChatTypeIcon = getChatTypeIcon(chat.chatType);

  return (
    <div className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5">
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className="relative">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-avatar text-xs font-semibold text-white"
            style={{ backgroundColor: getAvatarColor(chat.name) }}
          >
            {getInitials(chat.name)}
          </div>
          <span
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white"
            style={{ backgroundColor: getMessengerDotColor(chat.messenger) }}
          />
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-800">
              {chat.name}
            </h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium',
                getMessengerBgClass(chat.messenger),
              )}
            >
              {getMessengerLabel(chat.messenger)}
            </span>
            <ChatTypeIcon className="h-3.5 w-3.5 text-slate-400" />
          </div>
          {chat.ownerName && (
            <p className="text-xs text-slate-500">
              Assigned to {chat.ownerName}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="Pin"
        >
          <Pin className="h-4 w-4" />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="Search messages"
        >
          <Search className="h-4 w-4" />
        </button>
        <button
          onClick={toggleInfoPanel}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="Toggle info panel"
        >
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function ComposeBar({ chatId }: { chatId: string }) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const replyingTo = useChatStore((s) => s.replyingTo);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const { mutate: sendMessage, isPending } = useSendMessage();

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = text.trim();
      if (!trimmed || isPending) return;

      sendMessage(
        {
          chatId,
          text: trimmed,
          replyToId: replyingTo?.id,
        },
        {
          onSuccess: () => {
            setText('');
            setReplyingTo(null);
            textareaRef.current?.focus();
          },
        },
      );
    },
    [text, chatId, replyingTo, isPending, sendMessage, setReplyingTo],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    }
  }, [text]);

  return (
    <div className="flex-shrink-0 border-t border-slate-200 bg-white px-5 pb-4 pt-3">
      {/* Reply preview */}
      {replyingTo && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border-l-2 border-accent bg-accent-bg px-3 py-2">
          <Reply className="h-4 w-4 flex-shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-accent">
              {replyingTo.senderName}
            </p>
            <p className="truncate text-xs text-slate-600">
              {replyingTo.text}
            </p>
          </div>
          <button
            onClick={() => setReplyingTo(null)}
            className="flex-shrink-0 text-slate-400 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <button
          type="button"
          className="mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          title="Attach file"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="min-h-[36px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 placeholder-slate-400 outline-none transition-shadow focus:border-accent focus:bg-white focus:shadow-focus-ring"
        />

        <button
          type="submit"
          disabled={!text.trim() || isPending}
          className={cn(
            'mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-all',
            text.trim() && !isPending
              ? 'bg-accent text-white shadow-accent-sm hover:bg-accent-hover'
              : 'bg-slate-100 text-slate-300',
          )}
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function MessageFeed({ chatId }: { chatId: string }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useMessages(chatId);

  const messages = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap((p) => p.messages);
  }, [data]);

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups: Array<{ date: string; messages: Message[] }> = [];
    let currentDate = '';

    for (const msg of messages) {
      const msgDate = new Date(msg.createdAt).toDateString();
      if (msgDate !== currentDate) {
        currentDate = msgDate;
        groups.push({ date: msg.createdAt, messages: [msg] });
      } else {
        groups[groups.length - 1].messages.push(msg);
      }
    }
    return groups;
  }, [messages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [messages.length]);

  // Scroll up to load more
  const handleScroll = useCallback(() => {
    if (!feedRef.current || !hasNextPage || isFetchingNextPage) return;
    if (feedRef.current.scrollTop < 100) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#f8fafc]">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-[#f8fafc]">
        <MessageSquare className="mb-2 h-8 w-8 text-slate-300" />
        <p className="text-sm text-slate-400">No messages yet</p>
        <p className="mt-0.5 text-xs text-slate-400">
          Send the first message to start the conversation
        </p>
      </div>
    );
  }

  return (
    <div
      ref={feedRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto bg-[#f8fafc] px-5 py-4"
    >
      {isFetchingNextPage && (
        <div className="flex justify-center py-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      )}

      {groupedMessages.map((group) => (
        <div key={group.date}>
          {/* Date separator */}
          <div className="my-4 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-slate-500 shadow-xs">
              {formatDateSeparator(group.date)}
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Messages */}
          <div className="space-y-3">
            {group.messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onReply={setReplyingTo}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChatArea() {
  const activeChat = useChatStore((s) => s.activeChat);

  if (!activeChat) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <ChatHeader chat={activeChat} />
      <MessageFeed chatId={activeChat.id} />
      <ComposeBar chatId={activeChat.id} />
    </div>
  );
}
