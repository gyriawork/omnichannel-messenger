'use client';

import {
  useRef,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type FormEvent,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Send,
  Paperclip,
  Pin,
  PinOff,
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
  Trash2,
  Clock,
  AlertCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useChatStore } from '@/stores/chat';
import {
  useMessages,
  useSendMessage,
  useEditMessage,
  useDeleteMessage,
  usePinMessage,
  useSearchMessages,
  type MessageAttachment,
} from '@/hooks/useChats';
import { useReactions } from '@/hooks/useReactions';
import { ReactionsBubble } from './ReactionsBubble';
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
    case 'sending':
      return <Clock className="h-3 w-3 text-white/40" />;
    case 'sent':
      return <Check className="h-3 w-3 text-white/60" />;
    case 'delivered':
      return <CheckCheck className="h-3 w-3 text-white/60" />;
    case 'read':
      return <CheckCheck className="h-3 w-3 text-white" />;
    case 'failed':
      return <AlertCircle className="h-3 w-3 text-red-300" />;
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
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(message.text);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const { mutate: editMessage, isPending: isEditPending } = useEditMessage();
  const { mutate: deleteMessage, isPending: isDeletePending } = useDeleteMessage();
  const { mutate: pinMessage } = usePinMessage();
  const { mutate: sendMessage, isPending: isRetrySending } = useSendMessage();

  const {
    reactions,
    isLoading: isReactionsLoading,
    addReaction,
    removeReaction,
    isAddingReaction,
    isRemovingReaction,
  } = useReactions(message.chatId, message.id);

  const handleRetry = useCallback(() => {
    sendMessage(
      { chatId: message.chatId, text: message.text },
      { onError: () => toast.error('Retry failed') },
    );
  }, [message.chatId, message.text, sendMessage]);

  const handleEdit = useCallback(() => {
    setEditText(message.text);
    setIsEditing(true);
    setTimeout(() => editRef.current?.focus(), 0);
  }, [message.text]);

  const handleEditSave = useCallback(() => {
    const trimmed = editText.trim();
    if (!trimmed || trimmed === message.text) {
      setIsEditing(false);
      return;
    }
    editMessage(
      { messageId: message.id, text: trimmed },
      {
        onSuccess: () => {
          setIsEditing(false);
          toast.success('Message edited');
        },
        onError: () => toast.error('Failed to edit message'),
      },
    );
  }, [editText, message.id, message.text, editMessage]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditText(message.text);
  }, [message.text]);

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSave();
    }
    if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  const handlePin = useCallback(() => {
    pinMessage(
      { messageId: message.id, isPinned: !message.isPinned },
      {
        onSuccess: () =>
          toast.success(message.isPinned ? 'Message unpinned' : 'Message pinned'),
        onError: () => toast.error('Failed to update pin'),
      },
    );
  }, [message.id, message.isPinned, pinMessage]);

  const handleDelete = useCallback(() => {
    deleteMessage(message.id, {
      onSuccess: () => {
        setShowDeleteConfirm(false);
        toast.success('Message deleted');
      },
      onError: () => toast.error('Failed to delete message'),
    });
  }, [message.id, deleteMessage]);

  return (
    <div
      className={cn(
        'group relative flex max-w-[70%] flex-col',
        isSelf ? 'ml-auto items-end' : 'mr-auto items-start',
      )}
    >
      {/* Hover action bar */}
      <div
        className={cn(
          'absolute -top-3 z-10 flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white px-1 py-0.5 shadow-sm opacity-0 transition-opacity group-hover:opacity-100',
          isSelf ? 'right-0' : 'left-0',
        )}
      >
        <button
          onClick={() => onReply(message)}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title="Reply"
        >
          <Reply className="h-3.5 w-3.5" />
        </button>
        {isSelf && (
          <button
            onClick={handleEdit}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          onClick={handlePin}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          title={message.isPinned ? 'Unpin' : 'Pin'}
        >
          {message.isPinned ? (
            <PinOff className="h-3.5 w-3.5" />
          ) : (
            <Pin className="h-3.5 w-3.5" />
          )}
        </button>
        {isSelf && (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div
          className={cn(
            'mb-1 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs',
            isSelf ? 'flex-row-reverse' : '',
          )}
        >
          <span className="text-red-700">Delete this message?</span>
          <button
            onClick={handleDelete}
            disabled={isDeletePending}
            className="rounded bg-red-600 px-2 py-1 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isDeletePending ? 'Deleting...' : 'Delete'}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="rounded bg-white px-2 py-1 text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
        </div>
      )}

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
          'relative rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
          isSelf
            ? 'rounded-br-md bg-accent text-white'
            : 'rounded-bl-md bg-white text-slate-800 shadow-sm ring-1 ring-slate-100',
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

        {/* Text or inline edit */}
        {isEditing ? (
          <div className="space-y-2">
            <textarea
              ref={editRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleEditKeyDown}
              rows={2}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800 outline-none focus:border-accent"
            />
            <div className="flex gap-1.5">
              <button
                onClick={handleEditSave}
                disabled={isEditPending}
                className="rounded bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {isEditPending ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={handleEditCancel}
                className="rounded bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
        )}

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
          {isSelf && message.deliveryStatus === 'failed' && (
            <button
              onClick={handleRetry}
              disabled={isRetrySending}
              className="ml-0.5 flex items-center gap-0.5 rounded text-[10px] text-red-300 underline-offset-2 hover:text-red-100 disabled:opacity-50"
              title="Retry sending"
            >
              ↺ Retry
            </button>
          )}
        </div>

      </div>

      {/* Emoji reactions — outside bubble */}
      <ReactionsBubble
        reactions={reactions}
        onAddReaction={addReaction}
        onRemoveReaction={removeReaction}
        isLoading={isAddingReaction || isRemovingReaction}
        showPicker
      />
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

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-200 px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

function ChatHeader({
  chat,
  searchOpen,
  onToggleSearch,
}: {
  chat: Chat;
  searchOpen: boolean;
  onToggleSearch: () => void;
}) {
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
          onClick={onToggleSearch}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
            searchOpen
              ? 'bg-accent-bg text-accent'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
          )}
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

function SearchBar({
  chatId,
  onClose,
}: {
  chatId: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: searchResults, isLoading } = useSearchMessages(chatId, query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="relative flex-shrink-0 border-b border-slate-200 bg-white px-5 py-2">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search messages..."
          className="flex-1 bg-transparent text-sm text-slate-700 placeholder-slate-400 outline-none"
        />
        {isLoading && (
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        )}
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Search results dropdown */}
      {query.length >= 2 && searchResults?.messages && (
        <div className="absolute left-0 right-0 top-full z-20 max-h-64 overflow-y-auto border-b border-slate-200 bg-white shadow-lg">
          {searchResults.messages.length === 0 ? (
            <div className="px-5 py-4 text-center text-sm text-slate-400">
              No messages found
            </div>
          ) : (
            searchResults.messages.map((msg) => (
              <div
                key={msg.id}
                className="cursor-pointer border-b border-slate-100 px-5 py-3 transition-colors last:border-0 hover:bg-slate-50"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-accent">
                    {msg.senderName}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {formatMessageTime(msg.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-sm text-slate-700">
                  {highlightMatch(msg.text, query)}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ComposeBar({ chatId }: { chatId: string }) {
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replyingTo = useChatStore((s) => s.replyingTo);
  const setReplyingTo = useChatStore((s) => s.setReplyingTo);
  const { mutate: sendMessage, isPending } = useSendMessage();

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !isPending && !isUploading;

  const handleSubmit = useCallback(
    (e?: FormEvent) => {
      e?.preventDefault();
      if (!canSend) return;

      sendMessage(
        {
          chatId,
          text: text.trim(),
          replyToId: replyingTo?.id,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        {
          onSuccess: () => {
            setText('');
            setAttachments([]);
            setReplyingTo(null);
            textareaRef.current?.focus();
          },
        },
      );
    },
    [text, attachments, chatId, replyingTo, canSend, isPending, sendMessage, setReplyingTo],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length === 0) return;
      e.target.value = '';

      setIsUploading(true);
      try {
        for (const file of files) {
          const result = await api.upload<{ file: MessageAttachment }>('/api/uploads', file);
          setAttachments((prev) => [...prev, result.file]);
        }
      } catch {
        toast.error('Failed to upload file');
      } finally {
        setIsUploading(false);
      }
    },
    [],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }, []);

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

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((att, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-700"
            >
              <Paperclip className="h-3 w-3 flex-shrink-0 text-slate-400" />
              <span className="max-w-[140px] truncate">{att.filename}</span>
              <span className="text-slate-400">
                {att.size < 1024 * 1024
                  ? `${(att.size / 1024).toFixed(0)}KB`
                  : `${(att.size / 1024 / 1024).toFixed(1)}MB`}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="ml-0.5 text-slate-400 hover:text-red-500"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileChange}
          accept="image/*,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx,.zip,.mp4,.mp3"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className={cn(
            'mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-colors',
            isUploading
              ? 'text-accent animate-pulse'
              : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
          )}
          title="Attach file"
        >
          <Paperclip className="h-5 w-5" />
        </button>

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={attachments.length > 0 ? 'Add a caption...' : 'Type a message...'}
          rows={1}
          className="min-h-[36px] flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 placeholder-slate-400 outline-none transition-shadow focus:border-accent focus:bg-white focus:shadow-focus-ring"
        />

        <button
          type="submit"
          disabled={!canSend}
          className={cn(
            'mb-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg transition-all',
            canSend
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
    // API returns desc (newest first), reverse to chronological order (oldest first)
    return data.pages.flatMap((p) => p.messages).reverse();
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

  // Scroll to bottom on new messages (only if already near bottom)
  const prevLengthRef = useRef(0);

  useEffect(() => {
    if (feedRef.current && messages.length > prevLengthRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = feedRef.current;
      const wasNearBottom = scrollHeight - scrollTop - clientHeight < 150;
      if (wasNearBottom || prevLengthRef.current === 0) {
        feedRef.current.scrollTop = feedRef.current.scrollHeight;
      }
    }
    prevLengthRef.current = messages.length;
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
  const [searchOpen, setSearchOpen] = useState(false);
  const queryClient = useQueryClient();

  // Close search when switching chats
  useEffect(() => {
    setSearchOpen(false);
  }, [activeChat?.id]);

  // Mark chat as read when it is opened
  useEffect(() => {
    if (!activeChat?.id) return;
    api.patch(`/api/chats/${activeChat.id}/read`).then(() => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    }).catch(() => {
      // fire-and-forget — silently ignore errors
    });
  }, [activeChat?.id, queryClient]);

  if (!activeChat) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <ChatHeader
        chat={activeChat}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((v) => !v)}
      />
      {searchOpen && (
        <SearchBar
          chatId={activeChat.id}
          onClose={() => setSearchOpen(false)}
        />
      )}
      <MessageFeed chatId={activeChat.id} />
      <ComposeBar chatId={activeChat.id} />
    </div>
  );
}
