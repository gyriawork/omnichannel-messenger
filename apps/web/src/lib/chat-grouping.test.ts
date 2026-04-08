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

import { isFreeMailDomain, FREEMAIL_DOMAINS, buildGroupLabel } from './chat-grouping';
import type { Chat } from '@/types/chat';

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
