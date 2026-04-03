'use client';

import { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, X } from 'lucide-react';

interface ReplyTo {
  id: string;
  senderName: string;
  text: string;
}

interface MessageInputProps {
  onSend: (text: string, replyToMessageId?: string) => void;
  onEdit: (messageId: string, newText: string) => void;
  onCancelEdit: () => void;
  replyTo: ReplyTo | null;
  onCancelReply: () => void;
  editingMessage: { id: string; text: string } | null;
  disabled?: boolean;
  disabledReason?: string;
}

export default function MessageInput({
  onSend, onEdit, onCancelEdit, replyTo, onCancelReply, editingMessage, disabled, disabledReason,
}: MessageInputProps) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.text);
      textareaRef.current?.focus();
    }
  }, [editingMessage]);

  const handleSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (editingMessage) {
      onEdit(editingMessage.id, trimmed);
      setText('');
    } else {
      onSend(trimmed, replyTo?.id);
      setText('');
      onCancelReply();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  if (disabled) {
    return (
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-900 border-t text-center text-sm text-gray-400">
        {disabledReason ?? 'Read-only chat'}
      </div>
    );
  }

  return (
    <div className="border-t bg-white dark:bg-gray-900">
      {/* Reply preview */}
      {replyTo && (
        <div className="px-4 py-2 bg-blue-50 dark:bg-blue-900/20 flex items-center justify-between">
          <div className="text-sm">
            <span className="font-medium text-blue-600">Replying to {replyTo.senderName}</span>
            <p className="text-gray-500 truncate text-xs">{replyTo.text}</p>
          </div>
          <button onClick={onCancelReply} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Edit mode banner */}
      {editingMessage && (
        <div className="px-4 py-2 bg-yellow-50 dark:bg-yellow-900/20 flex items-center justify-between">
          <span className="text-sm font-medium text-yellow-700">Editing message</span>
          <button onClick={() => { onCancelEdit(); setText(''); }} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className="flex items-end gap-2 p-3">
        <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
          <Paperclip className="w-5 h-5" />
        </button>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          className="flex-1 resize-none rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50 dark:bg-gray-800"
          style={{ maxHeight: '120px' }}
        />
        <button
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="p-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
