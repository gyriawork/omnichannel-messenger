'use client';

// ─── EmailThread ───
// Accordion view of Gmail messages in a single conversation.
// Replaces the standard bubble-style message list for Gmail chats.
//
// Layout:
//   - Sticky header with thread subject (pulled from latest message)
//   - Scrollable list of messages, each using <EmailMessageCard>
//   - Only one message expanded at a time (tracked in Zustand)
//   - Latest message auto-expanded on mount / chat change

import { useEffect, useMemo } from 'react';
import { Mail } from 'lucide-react';
import { useChatStore } from '@/stores/chat';
import type { Message } from '@/types/chat';
import { EmailMessageCard } from './EmailMessageCard';

interface EmailThreadProps {
  messages: Message[];
  isLoading?: boolean;
}

export function EmailThread({ messages, isLoading }: EmailThreadProps) {
  const expandedMessageId = useChatStore((s) => s.expandedMessageId);
  const setExpandedMessageId = useChatStore((s) => s.setExpandedMessageId);
  const activeChat = useChatStore((s) => s.activeChat);

  // Sort oldest → newest for a natural reading order
  const sortedMessages = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
    [messages],
  );

  // Auto-expand the latest message when:
  //   - chat changes (expandedMessageId was reset to null by setActiveChat)
  //   - messages finish loading
  useEffect(() => {
    if (expandedMessageId || sortedMessages.length === 0) return;
    const latest = sortedMessages[sortedMessages.length - 1]!;
    setExpandedMessageId(latest.id);
  }, [sortedMessages, expandedMessageId, setExpandedMessageId]);

  // Subject: prefer the latest message's subject; fall back to chat name.
  const subject = useMemo(() => {
    for (let i = sortedMessages.length - 1; i >= 0; i--) {
      const s = sortedMessages[i]!.subject;
      if (s) return s;
    }
    return activeChat?.name ?? '(no subject)';
  }, [sortedMessages, activeChat]);

  if (isLoading && messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        Loading email thread…
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        No messages in this thread yet
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white">
      {/* Sticky subject header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-neutral-200 bg-white px-5 py-4">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
          <Mail className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Subject
          </div>
          <h2 className="truncate text-base font-semibold text-neutral-900">{subject}</h2>
        </div>
        <div className="flex-shrink-0 text-xs text-neutral-400">
          {sortedMessages.length} message{sortedMessages.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Accordion list */}
      <div className="flex-1 overflow-y-auto">
        {sortedMessages.map((msg) => (
          <EmailMessageCard
            key={msg.id}
            message={msg}
            isExpanded={expandedMessageId === msg.id}
            onToggle={() =>
              setExpandedMessageId(expandedMessageId === msg.id ? null : msg.id)
            }
          />
        ))}
      </div>
    </div>
  );
}
