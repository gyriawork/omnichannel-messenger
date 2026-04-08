// ─── chat-grouping.ts ───
// Pure helpers for collapsing multiple Gmail chats from the same sender
// domain into a single visual row on the /chats page.
//
// All exports are pure functions — no React, no I/O, no side effects.
// This makes them trivially unit-testable and SSR-safe.

import type { Chat } from '@/types/chat';

// Multi-part public suffixes we know about. Not the full Public Suffix List
// (that would add ~150KB to the bundle). Just the common ones we see in
// practice. Misses on exotic TLDs are acceptable — the worst that happens
// is a domain like `something.co.za` collapses to `co.za` instead of
// `something.co.za`, which only matters if there's actually more than one
// distinct sender on that suffix.
// All entries must be lowercase — the lookup string is always lowercased before comparison.
const MULTI_PART_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp',
  'co.nz', 'net.nz', 'org.nz',
  'com.br', 'net.br', 'org.br',
  'co.in', 'net.in', 'org.in',
  'co.za', 'org.za',
  'com.mx', 'com.ar', 'com.tr', 'com.sg', 'com.hk',
]);

/**
 * Extract the registrable domain (eTLD+1) from a raw email-ish string.
 * Accepts plain emails ("user@example.com") and RFC-style addresses
 * ('"Display" <user@example.com>'). Returns null for unparseable input.
 */
export function extractDomain(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;

  // Pull the part inside <...> if present, otherwise use the whole string.
  const angleMatch = raw.match(/<([^>]+)>\s*$/);
  const candidate = (angleMatch ? angleMatch[1] : raw).trim();

  const atIdx = candidate.lastIndexOf('@');
  if (atIdx === -1 || atIdx === candidate.length - 1) return null;

  const host = candidate.slice(atIdx + 1).toLowerCase().trim();
  if (!host || !host.includes('.')) return null;

  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return null;

  // Check if the last two labels form a known multi-part suffix.
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }

  return labels.slice(-2).join('.');
}

/**
 * Common free email providers. Chats from these domains are NEVER grouped —
 * they represent personal correspondence where each sender is a distinct
 * person, not a company.
 */
export const FREEMAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'ymail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'gmx.com',
  'gmx.net',
  'mail.ru',
  'yandex.ru',
  'yandex.com',
  'proton.me',
  'protonmail.com',
  'tutanota.com',
  'fastmail.com',
  'fastmail.fm',
  'hey.com',
  'zoho.com',
]);

export function isFreeMailDomain(domain: string): boolean {
  return FREEMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * Pick the best display name for a group of chats from the same domain.
 *
 * Strategy:
 *   1. Collect non-empty senderName from each chat's lastMessage.
 *   2. Pick the most frequent value. Tie-break: first occurrence wins.
 *   3. If none exists, capitalize the first label of the domain
 *      ("google.com" → "Google", "paypal-business.com" → "Paypal-business").
 */
export function buildGroupLabel(chats: Chat[], fallbackDomain: string): string {
  const counts = new Map<string, { count: number; firstIndex: number }>();
  chats.forEach((chat, idx) => {
    const name = chat.lastMessage?.senderName?.trim();
    if (!name) return;
    const existing = counts.get(name);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(name, { count: 1, firstIndex: idx });
    }
  });

  if (counts.size > 0) {
    let bestName = '';
    let bestCount = 0;
    let bestIndex = Infinity;
    for (const [name, { count, firstIndex }] of counts.entries()) {
      if (count > bestCount || (count === bestCount && firstIndex < bestIndex)) {
        bestName = name;
        bestCount = count;
        bestIndex = firstIndex;
      }
    }
    return bestName;
  }

  // Fallback: capitalize the first label of the domain.
  const firstLabel = fallbackDomain.split('.')[0] ?? fallbackDomain;
  return firstLabel.charAt(0).toUpperCase() + firstLabel.slice(1);
}
