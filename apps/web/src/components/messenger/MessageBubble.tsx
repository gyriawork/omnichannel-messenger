'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { Check, CheckCheck, AlertCircle, CornerUpLeft, Pencil, Trash2, Pin, Forward } from 'lucide-react';
import { MessageText } from './MessageText';
import type { MessengerType } from '@/types/chat';

interface Message {
  id: string;
  text: string;
  senderName: string;
  isSelf: boolean;
  createdAt: string;
  editedAt?: string | null;
  deliveryStatus: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  isPinned?: boolean;
  replyToMessage?: { id: string; senderName: string; text: string } | null;
}

interface MessageBubbleProps {
  message: Message;
  messenger?: MessengerType;
  onReply: (message: Message) => void;
  onEdit: (message: Message) => void;
  onDelete: (messageId: string) => void;
  onPin: (messageId: string, isPinned: boolean) => void;
  onForward: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
}

function DeliveryIcon({ status }: { status: string }) {
  switch (status) {
    case 'pending': return <span className="text-gray-400 text-xs">...</span>;
    case 'sent': return <Check className="w-3 h-3 text-gray-400" />;
    case 'delivered': return <CheckCheck className="w-3 h-3 text-gray-400" />;
    case 'read': return <CheckCheck className="w-3 h-3 text-blue-500" />;
    case 'failed': return <AlertCircle className="w-3 h-3 text-red-500" />;
    default: return null;
  }
}

export default function MessageBubble({ message, messenger, onReply, onEdit, onDelete, onPin, onForward, onRetry }: MessageBubbleProps) {
  const [showMenu, setShowMenu] = useState(false);

  const time = format(new Date(message.createdAt), 'HH:mm');

  return (
    <div
      className={`flex ${message.isSelf ? 'justify-end' : 'justify-start'} mb-2 group`}
      onContextMenu={(e) => {
        e.preventDefault();
        setShowMenu(!showMenu);
      }}
    >
      <div className={`max-w-[65%] relative`}>
        {/* Reply preview */}
        {message.replyToMessage && (
          <div className="text-xs bg-gray-100 dark:bg-gray-700 rounded-t-lg px-3 py-1 border-l-2 border-blue-500 mb-0.5">
            <span className="font-medium">{message.replyToMessage.senderName}</span>
            <p className="text-gray-500 truncate">{message.replyToMessage.text}</p>
          </div>
        )}

        {/* Bubble */}
        <div
          className={`px-4 py-2 rounded-2xl ${
            message.isSelf
              ? 'bg-blue-600 text-white rounded-br-md'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-bl-md shadow-xs'
          }`}
        >
          {!message.isSelf && (
            <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
              {message.senderName}
            </p>
          )}
          <MessageText
            text={message.text}
            messenger={messenger}
            className="whitespace-pre-wrap break-words text-sm"
          />
          <div className={`flex items-center gap-1 mt-1 ${message.isSelf ? 'justify-end' : ''}`}>
            <span className={`text-xs ${message.isSelf ? 'text-blue-200' : 'text-gray-400'}`}>
              {time}
            </span>
            {message.editedAt && (
              <span className={`text-xs ${message.isSelf ? 'text-blue-200' : 'text-gray-400'}`}>
                (edited)
              </span>
            )}
            {message.isSelf && <DeliveryIcon status={message.deliveryStatus} />}
          </div>
        </div>

        {/* Failed retry button */}
        {message.deliveryStatus === 'failed' && onRetry && (
          <button
            onClick={() => onRetry(message.id)}
            className="text-xs text-red-500 hover:text-red-700 mt-1"
          >
            Retry sending
          </button>
        )}

        {/* Context menu */}
        {showMenu && (
          <div
            className="absolute z-50 bg-white dark:bg-gray-900 border rounded-lg shadow-lg py-1 min-w-[160px]"
            style={{ top: '100%', right: message.isSelf ? 0 : undefined, left: message.isSelf ? undefined : 0 }}
            onMouseLeave={() => setShowMenu(false)}
          >
            <button onClick={() => { onReply(message); setShowMenu(false); }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
              <CornerUpLeft className="w-4 h-4" /> Reply
            </button>
            <button onClick={() => { onForward(message.id); setShowMenu(false); }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
              <Forward className="w-4 h-4" /> Forward
            </button>
            {message.isSelf && (
              <button onClick={() => { onEdit(message); setShowMenu(false); }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
                <Pencil className="w-4 h-4" /> Edit
              </button>
            )}
            <button onClick={() => { onPin(message.id, !message.isPinned); setShowMenu(false); }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2">
              <Pin className="w-4 h-4" /> {message.isPinned ? 'Unpin' : 'Pin'}
            </button>
            {message.isSelf && (
              <button onClick={() => { onDelete(message.id); setShowMenu(false); }} className="w-full px-3 py-1.5 text-sm text-left hover:bg-gray-100 dark:hover:bg-gray-800 text-red-500 flex items-center gap-2">
                <Trash2 className="w-4 h-4" /> Delete
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
