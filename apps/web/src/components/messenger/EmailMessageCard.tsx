'use client';

// ─── EmailMessageCard ───
// Renders a single email in a Gmail thread. Two visual states:
//   - collapsed: one-line preview (avatar, sender, time, snippet)
//   - expanded: full header (from/to/cc) + rendered HTML body
// Click toggles between states via Zustand `expandedMessageId`.

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Message } from '@/types/chat';
import { getAvatarColor, getInitials } from '@/lib/chat-utils';
import { EmailBody } from './EmailBody';

interface EmailMessageCardProps {
  message: Message;
  isExpanded: boolean;
  onToggle: () => void;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return `Today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  const isThisYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    year: isThisYear ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getPreview(message: Message): string {
  const raw = message.plainBody || message.text || '';
  return raw.replace(/\s+/g, ' ').trim().slice(0, 180);
}

export function EmailMessageCard({ message, isExpanded, onToggle }: EmailMessageCardProps) {
  const [showAllRecipients, setShowAllRecipients] = useState(false);

  const senderName = message.senderName || message.fromEmail || 'Unknown';
  const avatarColor = getAvatarColor(senderName);
  const initials = getInitials(senderName);
  const timestamp = formatDateTime(message.createdAt);

  const toList = message.toEmails ?? [];
  const ccList = message.ccEmails ?? [];

  if (!isExpanded) {
    // ── Collapsed: one-line row ──
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 border-b border-neutral-100 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
      >
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {initials}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex-shrink-0 truncate text-sm font-semibold text-neutral-900">
            {senderName}
          </span>
          <span className="truncate text-sm text-neutral-500">{getPreview(message)}</span>
        </div>
        <span className="flex-shrink-0 text-xs text-neutral-400">{timestamp}</span>
      </button>
    );
  }

  // ── Expanded: full card ──
  // Header is a plain div with role=button, not a real button element,
  // because it contains a nested chevron toggle which would cause a
  // hydration error if nested inside another button.
  return (
    <div className="border-b border-neutral-100 bg-white">
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-neutral-50"
      >
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-medium text-white"
          style={{ backgroundColor: avatarColor }}
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-neutral-900">{senderName}</span>
            {message.fromEmail && (
              <span className="truncate text-xs text-neutral-500">
                &lt;{message.fromEmail}&gt;
              </span>
            )}
          </div>
          {/* Recipients */}
          <div className="mt-0.5 flex items-start gap-1 text-xs text-neutral-500">
            <span className="flex-shrink-0">to</span>
            <span className="truncate">
              {toList.length > 0 ? toList.slice(0, showAllRecipients ? toList.length : 1).join(', ') : '—'}
              {!showAllRecipients && toList.length > 1 && (
                <span className="text-neutral-400"> +{toList.length - 1}</span>
              )}
            </span>
            {(toList.length > 1 || ccList.length > 0) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAllRecipients((v) => !v);
                }}
                className="flex-shrink-0 text-neutral-400 hover:text-neutral-600"
                aria-label="Toggle recipients"
              >
                {showAllRecipients ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            )}
          </div>
          {showAllRecipients && ccList.length > 0 && (
            <div className="mt-0.5 truncate text-xs text-neutral-500">
              cc: {ccList.join(', ')}
            </div>
          )}
        </div>
        <span className="flex-shrink-0 text-xs text-neutral-400">{timestamp}</span>
      </div>

      {/* Body */}
      <div className="px-4 pb-4">
        <EmailBody html={message.htmlBody} fallbackText={message.plainBody || message.text} />
      </div>

      {/* Attachments (if any) */}
      {message.attachments && message.attachments.length > 0 && (
        <div className="border-t border-neutral-100 px-4 py-2">
          <div className="text-xs font-medium text-neutral-500">
            {message.attachments.length} attachment{message.attachments.length > 1 ? 's' : ''}
          </div>
          <ul className="mt-1 space-y-1">
            {message.attachments.map((att, i) => (
              <li key={i} className="text-xs text-neutral-700">
                <a
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {att.filename}
                </a>
                <span className="ml-2 text-neutral-400">
                  ({Math.round(att.size / 1024)} KB)
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
