'use client';

import React, { type ReactNode } from 'react';
import {
  renderSlackMrkdwn,
  renderTelegramText,
  renderWhatsAppText,
} from '@/lib/messageFormatters';
import type { MessengerType } from '@/types/chat';

interface MessageTextProps {
  text: string;
  messenger?: MessengerType | string;
  className?: string;
}

/**
 * Renders message body text using the per-messenger formatter:
 * parses mrkdwn / markdown, linkifies URLs, and converts emoji shortcodes.
 * Falls back to plain text for Gmail or unknown messengers (Gmail has its own
 * rich renderer in EmailMessageCard).
 */
export function MessageText({ text, messenger, className }: MessageTextProps) {
  let content: ReactNode = text;
  if (messenger === 'slack') content = renderSlackMrkdwn(text);
  else if (messenger === 'telegram') content = renderTelegramText(text);
  else if (messenger === 'whatsapp') content = renderWhatsAppText(text);

  return (
    <p className={className ?? 'whitespace-pre-wrap break-words'}>{content}</p>
  );
}
