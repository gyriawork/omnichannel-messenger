import { describe, it, expect } from 'vitest';
import { extractDomain } from './chat-grouping';

describe('extractDomain', () => {
  it('returns null for empty input', () => {
    expect(extractDomain('')).toBeNull();
    expect(extractDomain(null as unknown as string)).toBeNull();
    expect(extractDomain(undefined as unknown as string)).toBeNull();
  });

  it('returns null when there is no @', () => {
    expect(extractDomain('not-an-email')).toBeNull();
  });

  it('extracts a plain second-level domain', () => {
    expect(extractDomain('user@google.com')).toBe('google.com');
    expect(extractDomain('foo@allegro.pl')).toBe('allegro.pl');
  });

  it('collapses subdomains to the registrable domain', () => {
    expect(extractDomain('noreply@accounts.google.com')).toBe('google.com');
    expect(extractDomain('news@mail.notion.so')).toBe('notion.so');
    expect(extractDomain('a@b.c.d.example.com')).toBe('example.com');
  });

  it('handles multi-part TLDs (eTLD+1)', () => {
    expect(extractDomain('user@bbc.co.uk')).toBe('bbc.co.uk');
    expect(extractDomain('user@foo.bar.co.uk')).toBe('bar.co.uk');
    expect(extractDomain('user@example.com.au')).toBe('example.com.au');
    expect(extractDomain('user@a.b.example.com.au')).toBe('example.com.au');
  });

  it('lowercases the result', () => {
    expect(extractDomain('User@Google.COM')).toBe('google.com');
  });

  it('strips display name like "Google" <noreply@google.com>', () => {
    expect(extractDomain('"Google" <noreply@google.com>')).toBe('google.com');
    expect(extractDomain('Google <noreply@google.com>')).toBe('google.com');
  });

  it('handles display names containing > (anchors to final angle pair)', () => {
    expect(extractDomain('Re: A > B <user@example.com>')).toBe('example.com');
  });
});

import { isFreeMailDomain, FREEMAIL_DOMAINS, buildGroupLabel, groupGmailChats, isChatGroup } from './chat-grouping';
import type { Chat } from '@/types/chat';
import type { ChatRow, ChatGroup } from './chat-grouping';

describe('isFreeMailDomain', () => {
  it('returns true for common free-mail providers', () => {
    expect(isFreeMailDomain('gmail.com')).toBe(true);
    expect(isFreeMailDomain('yahoo.com')).toBe(true);
    expect(isFreeMailDomain('outlook.com')).toBe(true);
    expect(isFreeMailDomain('hotmail.com')).toBe(true);
    expect(isFreeMailDomain('icloud.com')).toBe(true);
    expect(isFreeMailDomain('proton.me')).toBe(true);
  });

  it('returns false for corporate domains', () => {
    expect(isFreeMailDomain('google.com')).toBe(false);
    expect(isFreeMailDomain('allegro.pl')).toBe(false);
    expect(isFreeMailDomain('github.com')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isFreeMailDomain('GMAIL.COM')).toBe(true);
  });

  it('FREEMAIL_DOMAINS is non-empty', () => {
    expect(FREEMAIL_DOMAINS.size).toBeGreaterThan(10);
  });
});

function makeChat(senderName: string | undefined): Chat {
  return {
    id: Math.random().toString(),
    name: 'subject',
    messenger: 'gmail',
    chatType: 'direct',
    status: 'active',
    messageCount: 1,
    lastMessage: senderName
      ? { text: '', senderName, createdAt: new Date().toISOString() }
      : undefined,
  } as Chat;
}

describe('buildGroupLabel', () => {
  it('returns capitalized domain label when no chats have a sender name', () => {
    const chats = [makeChat(undefined), makeChat(undefined)];
    expect(buildGroupLabel(chats, 'google.com')).toBe('Google');
    expect(buildGroupLabel(chats, 'paypal-business.com')).toBe('Paypal-business');
    expect(buildGroupLabel(chats, 'allegro.pl')).toBe('Allegro');
  });

  it('uses majority sender name', () => {
    const chats = [makeChat('Google'), makeChat('Google'), makeChat('google.com noreply')];
    expect(buildGroupLabel(chats, 'google.com')).toBe('Google');
  });

  it('falls back to capitalized domain when all sender names empty', () => {
    const chats = [makeChat(''), makeChat('   ')];
    expect(buildGroupLabel(chats, 'github.com')).toBe('Github');
  });

  it('tie-break: first occurrence wins', () => {
    const chats = [makeChat('Acme'), makeChat('Other'), makeChat('Acme'), makeChat('Other')];
    // Acme and Other tie at 2 each, but Acme came first
    expect(buildGroupLabel(chats, 'acme.com')).toBe('Acme');
  });
});

function gmailChat(opts: {
  id: string;
  fromEmail?: string | null;
  senderName?: string;
  messageCount?: number;
  lastActivityAt?: string;
  tags?: Array<{ id: string; name: string; color: string }>;
}): Chat {
  return {
    id: opts.id,
    name: `Subject ${opts.id}`,
    messenger: 'gmail',
    chatType: 'direct',
    status: 'active',
    messageCount: opts.messageCount ?? 1,
    lastActivityAt: opts.lastActivityAt ?? '2026-04-01T00:00:00Z',
    tags: opts.tags,
    lastMessage: opts.fromEmail
      ? {
          text: 'body',
          senderName: opts.senderName ?? '',
          createdAt: opts.lastActivityAt ?? '2026-04-01T00:00:00Z',
          fromEmail: opts.fromEmail,
        }
      : undefined,
  } as Chat;
}

function tgChat(id: string): Chat {
  return {
    id,
    name: `Telegram ${id}`,
    messenger: 'telegram',
    chatType: 'direct',
    status: 'active',
    messageCount: 1,
  } as Chat;
}

describe('groupGmailChats', () => {
  it('returns empty array for empty input', () => {
    expect(groupGmailChats([])).toEqual([]);
  });

  it('passes through non-gmail chats untouched', () => {
    const tg = tgChat('1');
    const result = groupGmailChats([tg]);
    expect(result).toEqual([tg]);
  });

  it('does not group a single gmail chat (below threshold)', () => {
    const c = gmailChat({ id: '1', fromEmail: 'a@google.com' });
    const result = groupGmailChats([c]);
    expect(result).toHaveLength(1);
    expect(isChatGroup(result[0]!)).toBe(false);
  });

  it('does not group two gmail chats from different domains', () => {
    const a = gmailChat({ id: '1', fromEmail: 'a@google.com' });
    const b = gmailChat({ id: '2', fromEmail: 'a@github.com' });
    const result = groupGmailChats([a, b]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => !isChatGroup(r))).toBe(true);
  });

  it('groups two gmail chats from the same domain', () => {
    const a = gmailChat({ id: '1', fromEmail: 'a@google.com', senderName: 'Google', messageCount: 5 });
    const b = gmailChat({ id: '2', fromEmail: 'b@accounts.google.com', senderName: 'Google', messageCount: 3 });
    const result = groupGmailChats([a, b]);
    expect(result).toHaveLength(1);
    expect(isChatGroup(result[0]!)).toBe(true);
    const group = result[0] as ChatGroup;
    expect(group.domain).toBe('google.com');
    expect(group.label).toBe('Google');
    expect(group.chats).toHaveLength(2);
    expect(group.totalMessages).toBe(8);
  });

  it('skips free-mail domains (each chat stays separate)', () => {
    const a = gmailChat({ id: '1', fromEmail: 'john@gmail.com' });
    const b = gmailChat({ id: '2', fromEmail: 'jane@gmail.com' });
    const result = groupGmailChats([a, b]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => !isChatGroup(r))).toBe(true);
  });

  it('passes through gmail chats with no fromEmail', () => {
    const a = gmailChat({ id: '1', fromEmail: null });
    const b = gmailChat({ id: '2', fromEmail: null });
    const result = groupGmailChats([a, b]);
    expect(result).toHaveLength(2);
    expect(result.every((r) => !isChatGroup(r))).toBe(true);
  });

  it('latestChat is the chat with the max lastActivityAt', () => {
    const older = gmailChat({ id: '1', fromEmail: 'a@google.com', lastActivityAt: '2026-01-01T00:00:00Z' });
    const newer = gmailChat({ id: '2', fromEmail: 'b@google.com', lastActivityAt: '2026-04-01T00:00:00Z' });
    const result = groupGmailChats([older, newer]) as ChatRow[];
    const group = result[0] as ChatGroup;
    expect(group.latestChat.id).toBe('2');
    expect(group.lastActivityAt).toBe('2026-04-01T00:00:00Z');
  });

  it('group tags = deduped union of chat tags', () => {
    const a = gmailChat({
      id: '1', fromEmail: 'a@google.com',
      tags: [{ id: 't1', name: 'A', color: '#f00' }, { id: 't2', name: 'B', color: '#0f0' }],
    });
    const b = gmailChat({
      id: '2', fromEmail: 'b@google.com',
      tags: [{ id: 't2', name: 'B', color: '#0f0' }, { id: 't3', name: 'C', color: '#00f' }],
    });
    const group = groupGmailChats([a, b])[0] as ChatGroup;
    expect(group.tags).toHaveLength(3);
    expect(group.tags.map((t) => t.id).sort()).toEqual(['t1', 't2', 't3']);
  });

  it('mixed input: telegram untouched, gmail grouped', () => {
    const tg = tgChat('tg1');
    const a = gmailChat({ id: 'g1', fromEmail: 'a@google.com' });
    const b = gmailChat({ id: 'g2', fromEmail: 'b@google.com' });
    const result = groupGmailChats([tg, a, b]);
    expect(result).toHaveLength(2);
    expect(isChatGroup(result.find((r) => !isChatGroup(r) && (r as Chat).id === 'tg1') as ChatRow)).toBe(false);
    const group = result.find(isChatGroup);
    expect(group).toBeDefined();
    expect((group as ChatGroup).chats).toHaveLength(2);
  });
});
