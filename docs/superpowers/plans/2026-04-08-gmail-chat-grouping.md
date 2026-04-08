# Gmail Chat Grouping Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the `/chats` page, collapse multiple Gmail chats from the same sender domain into a single visual row. Clicking the row navigates to `/messenger` with the search field prefilled by the domain so the user sees all matching threads in the existing left panel.

**Architecture:** 100% client-side grouping inside an existing `useMemo` on the `/chats` page. One pure utility module with unit tests. Two small server-side touch-ups: extend the `lastMessage` projection to include `fromEmail`, and extend the `?search=` clause to also match `Message.fromEmail`. One small UI touch-up on the messenger page: read `?search=` from the URL on mount and seed the existing left-panel search.

**Tech Stack:** React 18 + Next.js 14 App Router (`apps/web`), Vitest, Fastify + Prisma (`apps/api`).

**Spec:** `docs/superpowers/specs/2026-04-08-gmail-chat-grouping-design.md`

---

## Pre-flight Context

Before starting, the implementer should know:

- **Monorepo:** Turborepo. `apps/web` is the Next.js frontend, `apps/api` is the Fastify backend, `apps/worker` is BullMQ. For this plan, only `apps/web` and `apps/api` are touched.
- **Communication style (`CLAUDE.md`):** Russian, simple, with risk levels. Applies to user-facing summaries, not code or commit messages.
- **Critical existing bug context:** The `ComposeBar` in `apps/web/src/components/messenger/ChatArea.tsx` has hooks ordering that was fixed recently — do not reintroduce an early `return` before any hook in that function.
- **Existing search behavior:** `/api/chats?search=foo` currently matches `chat.name` and `chat.messages.some.text`. After this plan, it will also match `chat.messages.some.fromEmail` — this is the mechanism that powers the click-to-Messenger flow.
- **Existing `/messenger` page:** Has no URL-param handling at all today. We add it for `?search=`. The pre-existing `?chatId=` link from `/chats` is also currently inert; we are NOT fixing that here (out of scope, separate issue).
- **TDD discipline:** Unit-tested utility first, then integrate. Manual verification at the end via the existing seed Gmail data (chat 69840d07-da19-451e-8302-f636ac345fa4 has 3 HTML emails from `sarah@acme.example`).
- **Vitest is configured at the repo root.** Test files live next to source: `chat-grouping.test.ts` next to `chat-grouping.ts`.

---

## File Structure

| File | Responsibility | Type |
|---|---|---|
| `apps/web/src/lib/chat-grouping.ts` | Pure functions: `extractDomain`, `isFreeMailDomain`, `buildGroupLabel`, `groupGmailChats`, `isChatGroup`, type `ChatGroup`, `ChatRow`, constant `FREEMAIL_DOMAINS` | New |
| `apps/web/src/lib/chat-grouping.test.ts` | Unit tests for the utility | New |
| `apps/web/src/types/chat.ts` | Add `fromEmail?: string \| null` to `Chat.lastMessage` | Modify |
| `apps/web/src/app/(dashboard)/chats/page.tsx` | Use grouping inside the `sorted` memo; render group rows in both desktop table and mobile card list | Modify |
| `apps/web/src/components/messenger/ChatList.tsx` | On mount, read `?search=` from the URL and seed `searchQuery` + local input | Modify |
| `apps/api/src/routes/chats.ts` | Extend the `lastMessage` Prisma projection to include `fromEmail`; extend the `where.OR` search clause to also match `messages.some.fromEmail` | Modify |

No DB schema changes. No migrations. No changes to `packages/shared`, websocket layer, worker, or other messenger UIs.

---

## Task 1: Domain extraction utility (TDD)

**Files:**
- Create: `apps/web/src/lib/chat-grouping.ts`
- Test: `apps/web/src/lib/chat-grouping.test.ts`

This task builds the lowest-level helper. Everything else depends on it.

- [ ] **Step 1.1: Write the failing test for `extractDomain`**

Create `apps/web/src/lib/chat-grouping.test.ts`:

```ts
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
});
```

- [ ] **Step 1.2: Run the test, confirm it fails**

```bash
cd "/Users/anton/Development projects/Omnichannel Messeger/General"
npx vitest run apps/web/src/lib/chat-grouping.test.ts
```

Expected: All tests fail with `Cannot find module './chat-grouping'`.

- [ ] **Step 1.3: Create `chat-grouping.ts` with `extractDomain` only**

Create `apps/web/src/lib/chat-grouping.ts`:

```ts
// ─── chat-grouping.ts ───
// Pure helpers for collapsing multiple Gmail chats from the same sender
// domain into a single visual row on the /chats page.
//
// All exports are pure functions — no React, no I/O, no side effects.
// This makes them trivially unit-testable and SSR-safe.

// Multi-part public suffixes we know about. Not the full Public Suffix List
// (that would add ~150KB to the bundle). Just the common ones we see in
// practice. Misses on exotic TLDs are acceptable — the worst that happens
// is a domain like `something.co.za` collapses to `co.za` instead of
// `something.co.za`, which only matters if there's actually more than one
// distinct sender on that suffix.
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
  const angleMatch = raw.match(/<([^>]+)>/);
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
```

- [ ] **Step 1.4: Run the test, confirm it passes**

```bash
npx vitest run apps/web/src/lib/chat-grouping.test.ts
```

Expected: All `extractDomain` tests PASS.

- [ ] **Step 1.5: Commit**

```bash
git add apps/web/src/lib/chat-grouping.ts apps/web/src/lib/chat-grouping.test.ts
git commit -m "feat(chat-grouping): add extractDomain helper with eTLD+1 support"
```

---

## Task 2: Free-mail domain detection (TDD)

**Files:**
- Modify: `apps/web/src/lib/chat-grouping.ts`
- Modify: `apps/web/src/lib/chat-grouping.test.ts`

- [ ] **Step 2.1: Add the failing test**

Append to `chat-grouping.test.ts`:

```ts
import { isFreeMailDomain, FREEMAIL_DOMAINS } from './chat-grouping';

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
```

- [ ] **Step 2.2: Run, confirm fail**

```bash
npx vitest run apps/web/src/lib/chat-grouping.test.ts
```

Expected: New `isFreeMailDomain` block fails on import.

- [ ] **Step 2.3: Implement**

Append to `apps/web/src/lib/chat-grouping.ts`:

```ts
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
```

- [ ] **Step 2.4: Run, confirm pass**

```bash
npx vitest run apps/web/src/lib/chat-grouping.test.ts
```

Expected: All tests PASS.

- [ ] **Step 2.5: Commit**

```bash
git add apps/web/src/lib/chat-grouping.ts apps/web/src/lib/chat-grouping.test.ts
git commit -m "feat(chat-grouping): add free-mail domain skip list"
```

---

## Task 3: `buildGroupLabel` (TDD)

**Files:**
- Modify: `apps/web/src/lib/chat-grouping.ts`
- Modify: `apps/web/src/lib/chat-grouping.test.ts`

- [ ] **Step 3.1: Add failing tests**

Append to `chat-grouping.test.ts`:

```ts
import { buildGroupLabel } from './chat-grouping';
import type { Chat } from '@/types/chat';

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
```

- [ ] **Step 3.2: Run, confirm fail**

```bash
npx vitest run apps/web/src/lib/chat-grouping.test.ts
```

Expected: New tests fail on import of `buildGroupLabel`.

- [ ] **Step 3.3: Implement**

Append to `apps/web/src/lib/chat-grouping.ts`:

```ts
import type { Chat } from '@/types/chat';

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
```

- [ ] **Step 3.4: Run, confirm pass**

```bash
npx vitest run apps/web/src/lib/chat-grouping.test.ts
```

Expected: All tests PASS.

- [ ] **Step 3.5: Commit**

```bash
git add apps/web/src/lib/chat-grouping.ts apps/web/src/lib/chat-grouping.test.ts
git commit -m "feat(chat-grouping): add buildGroupLabel with majority + fallback"
```

---

## Task 4: `groupGmailChats` main function (TDD)

**Files:**
- Modify: `apps/web/src/lib/chat-grouping.ts`
- Modify: `apps/web/src/lib/chat-grouping.test.ts`
- Modify: `apps/web/src/types/chat.ts` (add `fromEmail` to `lastMessage`)

This task introduces the `ChatGroup` type and the main grouping function. It also requires extending the `Chat.lastMessage` type to carry `fromEmail`, since that's what `groupGmailChats` reads.

- [ ] **Step 4.1: Extend `Chat.lastMessage` type**

In `apps/web/src/types/chat.ts`, replace the `lastMessage` block (lines 24-28):

```ts
  lastMessage?: {
    text: string;
    senderName: string;
    createdAt: string;
    fromEmail?: string | null; // Gmail only — used for sender-domain grouping
  };
```

- [ ] **Step 4.2: Write failing tests for `groupGmailChats`**

Append to `chat-grouping.test.ts`:

```ts
import { groupGmailChats, isChatGroup } from './chat-grouping';
import type { ChatRow, ChatGroup } from './chat-grouping';

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
```

- [ ] **Step 4.3: Run, confirm fail**

```bash
npx vitest run apps/web/src/lib/chat-grouping.test.ts
```

Expected: New tests fail on missing exports `groupGmailChats`, `isChatGroup`, types `ChatGroup`, `ChatRow`.

- [ ] **Step 4.4: Implement**

Append to `apps/web/src/lib/chat-grouping.ts`:

```ts
// ─── Grouping types ───

export interface ChatGroup {
  isGroup: true;
  domain: string;          // canonical registrable domain, e.g. "google.com"
  label: string;           // display name, e.g. "Google"
  chats: Chat[];           // ≥ 2 chats
  latestChat: Chat;        // chat with the most recent lastActivityAt
  totalMessages: number;   // sum of messageCount across chats
  lastActivityAt: string;  // max lastActivityAt across chats
  messenger: 'gmail';
  tags: Array<{ id: string; name: string; color: string }>;
}

export type ChatRow = Chat | ChatGroup;

export function isChatGroup(row: ChatRow): row is ChatGroup {
  return (row as ChatGroup).isGroup === true;
}

const MIN_GROUP_SIZE = 2;

/**
 * Group Gmail chats by sender domain. Returns a flat list mixing
 * ungrouped chats (Chat) and groups (ChatGroup) in the original order.
 *
 * Sorting is deliberately NOT applied here — the caller controls sort.
 *
 * Rules:
 *   - Non-Gmail chats are passed through untouched.
 *   - Gmail chats with no lastMessage.fromEmail are passed through.
 *   - Gmail chats whose domain is in FREEMAIL_DOMAINS are passed through.
 *   - Gmail chats whose domain has < MIN_GROUP_SIZE other matches are passed through.
 *   - Otherwise, chats are bucketed by domain and each bucket becomes a ChatGroup.
 */
export function groupGmailChats(chats: Chat[]): ChatRow[] {
  if (chats.length === 0) return [];

  const buckets = new Map<string, Chat[]>();
  const passthrough: Chat[] = [];

  for (const chat of chats) {
    if (chat.messenger !== 'gmail') {
      passthrough.push(chat);
      continue;
    }
    const fromEmail = chat.lastMessage?.fromEmail;
    if (!fromEmail) {
      passthrough.push(chat);
      continue;
    }
    const domain = extractDomain(fromEmail);
    if (!domain || isFreeMailDomain(domain)) {
      passthrough.push(chat);
      continue;
    }
    const bucket = buckets.get(domain);
    if (bucket) {
      bucket.push(chat);
    } else {
      buckets.set(domain, [chat]);
    }
  }

  const result: ChatRow[] = [...passthrough];

  for (const [domain, bucketChats] of buckets.entries()) {
    if (bucketChats.length < MIN_GROUP_SIZE) {
      // Below threshold: pass through as ungrouped chats
      result.push(...bucketChats);
      continue;
    }

    // Build the group
    let latestChat = bucketChats[0]!;
    let latestTime = new Date(latestChat.lastActivityAt ?? 0).getTime();
    let totalMessages = 0;
    const tagMap = new Map<string, { id: string; name: string; color: string }>();

    for (const c of bucketChats) {
      totalMessages += c.messageCount ?? 0;
      const t = new Date(c.lastActivityAt ?? 0).getTime();
      if (t > latestTime) {
        latestTime = t;
        latestChat = c;
      }
      for (const tag of c.tags ?? []) {
        if (!tagMap.has(tag.id)) tagMap.set(tag.id, tag);
      }
    }

    const group: ChatGroup = {
      isGroup: true,
      domain,
      label: buildGroupLabel(bucketChats, domain),
      chats: bucketChats,
      latestChat,
      totalMessages,
      lastActivityAt: latestChat.lastActivityAt ?? new Date(0).toISOString(),
      messenger: 'gmail',
      tags: Array.from(tagMap.values()),
    };
    result.push(group);
  }

  return result;
}
```

- [ ] **Step 4.5: Run, confirm pass**

```bash
npx vitest run apps/web/src/lib/chat-grouping.test.ts
```

Expected: All tests PASS (including all earlier tests — no regressions).

- [ ] **Step 4.6: Commit**

```bash
git add apps/web/src/lib/chat-grouping.ts apps/web/src/lib/chat-grouping.test.ts apps/web/src/types/chat.ts
git commit -m "feat(chat-grouping): add groupGmailChats and ChatGroup type"
```

---

## Task 5: API — extend `lastMessage` projection and search clause

**Files:**
- Modify: `apps/api/src/routes/chats.ts:153` (lastMessage select)
- Modify: `apps/api/src/routes/chats.ts:130-135` (search OR clause)

The grouping function reads `chat.lastMessage.fromEmail`. Currently the API does not project this field. Without this change, every Gmail chat will fall through to the `passthrough` branch and nothing will ever group.

**Precondition:** The migration `20260408000001_add_email_fields` must already be applied (it adds `Message.fromEmail`). If you pulled the repo fresh, run `cd apps/api && npx prisma migrate deploy && npx prisma generate` before starting this task.

- [ ] **Step 5.1: Extend the `lastMessage` projection**

In `apps/api/src/routes/chats.ts`, find:

```ts
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: { id: true, text: true, senderName: true, createdAt: true },
            },
```

Replace with:

```ts
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              select: { id: true, text: true, senderName: true, createdAt: true, fromEmail: true },
            },
```

- [ ] **Step 5.2: Extend the search OR clause**

In the same file, find:

```ts
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { messages: { some: { text: { contains: search, mode: 'insensitive' } } } },
        ];
      }
```

Replace with:

```ts
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { messages: { some: { text: { contains: search, mode: 'insensitive' } } } },
          // Match Gmail sender domain so /messenger?search=google.com works.
          { messages: { some: { fromEmail: { contains: search, mode: 'insensitive' } } } },
        ];
      }
```

- [ ] **Step 5.3: Verify the API still type-checks**

```bash
cd "/Users/anton/Development projects/Omnichannel Messeger/General"
npx tsc -p apps/api/tsconfig.json --noEmit
```

Expected: No errors. (Prisma already exposes `Message.fromEmail` because the migration `20260408000001_add_email_fields` is applied.)

- [ ] **Step 5.4: Commit**

```bash
git add apps/api/src/routes/chats.ts
git commit -m "feat(api/chats): include fromEmail in lastMessage and search clause"
```

---

## Task 6: `/chats` page — integrate grouping into rendering

**Files:**
- Modify: `apps/web/src/app/(dashboard)/chats/page.tsx`

This is the largest task. Outline:

1. Replace the `sorted` `useMemo` with one that calls `groupGmailChats`.
2. Add a sort helper that knows how to sort `ChatRow`s.
3. Refactor the table-row rendering and the mobile-card rendering to dispatch on `isChatGroup`.

- [ ] **Step 6.1: Add imports**

At the top of `apps/web/src/app/(dashboard)/chats/page.tsx`, add:

```ts
import { groupGmailChats, isChatGroup, type ChatRow, type ChatGroup } from '@/lib/chat-grouping';
```

- [ ] **Step 6.2: Replace the `sorted` memo**

Find the existing `sorted` `useMemo` (around lines 362-391). Replace with:

```ts
  const sorted = useMemo<ChatRow[]>(() => {
    // 1. Apply chat-type filter (existing logic).
    let filtered = chats;
    if (chatTypeFilter) {
      filtered = filtered.filter((c) => c.chatType === chatTypeFilter);
    }

    // 2. Group eligible Gmail chats by sender domain.
    const rows = groupGmailChats(filtered);

    // 3. Sort. Helper functions handle both Chat and ChatGroup.
    const getName = (r: ChatRow) => (isChatGroup(r) ? r.label : r.name);
    const getMessageCount = (r: ChatRow) =>
      isChatGroup(r) ? r.totalMessages : (r.messageCount ?? 0);
    const getChatType = (r: ChatRow) => (isChatGroup(r) ? '' : (r.chatType ?? ''));
    const getFirstTagName = (r: ChatRow) =>
      isChatGroup(r) ? r.tags[0]?.name : r.tags?.[0]?.name;
    const getLastMessageTime = (r: ChatRow) => {
      if (isChatGroup(r)) return new Date(r.lastActivityAt).getTime();
      return r.lastMessage?.createdAt ? new Date(r.lastMessage.createdAt).getTime() : 0;
    };
    const getLastActivity = (r: ChatRow) =>
      new Date(r.lastActivityAt ?? 0).getTime();

    return [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'name') {
        cmp = getName(a).localeCompare(getName(b));
      } else if (sortBy === 'messageCount') {
        cmp = getMessageCount(a) - getMessageCount(b);
      } else if (sortBy === 'chatType') {
        cmp = getChatType(a).localeCompare(getChatType(b));
      } else if (sortBy === 'tags') {
        const aTag = getFirstTagName(a);
        const bTag = getFirstTagName(b);
        if (!aTag && !bTag) cmp = 0;
        else if (!aTag) cmp = 1;
        else if (!bTag) cmp = -1;
        else cmp = aTag.localeCompare(bTag);
      } else if (sortBy === 'lastMessageDate') {
        cmp = getLastMessageTime(a) - getLastMessageTime(b);
      } else {
        cmp = getLastActivity(a) - getLastActivity(b);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
  }, [chats, chatTypeFilter, sortBy, sortDir]);
```

- [ ] **Step 6.3: Update `toggleSelectAll` to ignore groups**

`toggleSelectAll` currently does `sorted.map((c) => c.id)`. Groups have no `id` (and shouldn't be selectable). Change to:

```ts
  const toggleSelectAll = () => {
    const selectableIds = sorted.filter((r) => !isChatGroup(r)).map((r) => (r as Chat).id);
    if (selectedIds.length === selectableIds.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableIds);
    }
  };
```

Also update the "select all" checkbox `checked` prop similarly:

```tsx
                    checked={
                      selectedIds.length > 0 &&
                      selectedIds.length === sorted.filter((r) => !isChatGroup(r)).length
                    }
```

- [ ] **Step 6.4: Branch the desktop table row rendering**

Find the `sorted.map((chat) => { … })` block in the table body (around line 633). Replace the inner of the map with the code below. **Important:** keep the existing `<tr>` body for the chat case exactly as it is today — only the wrapping is changing. The `/* ...existing content unchanged... */` placeholder below means "leave the existing JSX for that row verbatim".

```tsx
              {sorted.map((row) => {
                if (isChatGroup(row)) {
                  return <GroupRow key={`group-${row.domain}`} group={row} />;
                }
                const chat = row;
                const mcfg = messengerConfig[chat.messenger];
                const TypeIcon = chatTypeIcons[chat.chatType] ?? MessageSquare;
                const isSelected = selectedIds.includes(chat.id);

                return (
                  <tr
                    key={chat.id}
                    className={cn(
                      'transition-colors hover:bg-slate-50/50',
                      isSelected && 'bg-accent-bg/30',
                    )}
                  >
                    {/* ...existing content unchanged... */}
                  </tr>
                );
              })}
```

- [ ] **Step 6.5: Add the `GroupRow` component**

Add this above the `ChatsPage` function:

```tsx
// ─── GroupRow ───
// Renders a virtual row representing a group of Gmail chats from the same
// sender domain. Visually identical to a normal chat row. Click navigates
// to /messenger?search=<domain> so the existing left-panel search shows
// the constituent threads.

function GroupRow({ group }: { group: ChatGroup }) {
  const cfg = messengerConfig.gmail;
  const subjectPreview = group.latestChat.lastMessage?.text ?? group.latestChat.name;
  const formatTime = (iso?: string) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = new Date();
    const diffH = (now.getTime() - d.getTime()) / (1000 * 60 * 60);
    if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <tr className="transition-colors hover:bg-slate-50/50">
      {/* Empty checkbox cell — groups are not bulk-selectable */}
      <td className="px-4 py-3" />

      {/* Chat: avatar + label + subject preview */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <ChatAvatar name={group.label} messenger="gmail" size={36} />
          <div className="min-w-0">
            <a
              href={`/messenger?search=${encodeURIComponent(group.domain)}`}
              className="text-sm font-medium text-slate-800 hover:text-accent"
            >
              {group.label}
            </a>
            <div className="truncate text-xs text-slate-400">{subjectPreview}</div>
          </div>
        </div>
      </td>

      {/* Messenger badge */}
      <td className="px-4 py-3">
        <span
          className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
            cfg.bgClass,
            cfg.textClass,
          )}
        >
          {cfg.label}
        </span>
      </td>

      {/* Type — N/A for groups */}
      <td className="px-4 py-3 text-xs text-slate-300">—</td>

      {/* Owner — N/A for groups */}
      <td className="px-4 py-3 text-xs text-slate-300">—</td>

      {/* Total messages */}
      <td className="px-4 py-3 text-xs font-medium text-slate-600">
        {group.totalMessages.toLocaleString()}
      </td>

      {/* Tags union */}
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {group.tags.length === 0 ? (
            <span className="text-[10px] text-slate-300">—</span>
          ) : (
            group.tags.map((tag) => (
              <span
                key={tag.id}
                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ backgroundColor: tag.color + '18', color: tag.color }}
              >
                {tag.name}
              </span>
            ))
          )}
        </div>
      </td>

      {/* Last active */}
      <td className="px-4 py-3 text-xs text-slate-500">
        {formatTime(group.lastActivityAt)}
      </td>

      {/* Actions — N/A for groups */}
      <td className="px-3 py-3" />
    </tr>
  );
}
```

- [ ] **Step 6.6: Update mobile card list**

Find the mobile card list block (around line 542). Replace `sorted.map((chat) => { … })` with the code below. Same convention as Step 6.4: the `// ...existing card markup unchanged...` placeholder means keep the existing chat-card JSX verbatim.

```tsx
        {sorted.map((row) => {
          if (isChatGroup(row)) {
            const cfg = messengerConfig.gmail;
            return (
              <a
                key={`group-${row.domain}`}
                href={`/messenger?search=${encodeURIComponent(row.domain)}`}
                className="rounded-xl border border-slate-200 bg-white p-3 transition-colors block"
              >
                <div className="flex items-center gap-3">
                  <div className={cn('h-2 w-2 rounded-full', cfg.dotColor)} />
                  <span className="flex-1 truncate text-sm font-medium text-slate-900">
                    {row.label}
                  </span>
                  <span className="text-xs text-slate-400">
                    {row.totalMessages} msgs
                  </span>
                </div>
                <p className="mt-1 truncate pl-5 text-xs text-slate-500">
                  {row.latestChat.lastMessage?.text ?? row.latestChat.name}
                </p>
              </a>
            );
          }
          const chat = row;
          const cfg = messengerConfig[chat.messenger];
          const isSelected = selectedIds.includes(chat.id);
          return (
            // ...existing card markup unchanged...
          );
        })}
```

- [ ] **Step 6.7: Type-check the web app**

```bash
cd "/Users/anton/Development projects/Omnichannel Messeger/General"
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: No errors.

- [ ] **Step 6.8: Run all unit tests once more**

```bash
npx vitest run apps/web/src/lib/chat-grouping.test.ts
```

Expected: All pass.

- [ ] **Step 6.9: Commit**

```bash
git add apps/web/src/app/(dashboard)/chats/page.tsx
git commit -m "feat(chats-page): render grouped Gmail rows via groupGmailChats"
```

---

## Task 7: Messenger left panel — read `?search=` from URL

**Files:**
- Modify: `apps/web/src/components/messenger/ChatList.tsx`

The grouped row in /chats links to `/messenger?search=google.com`. The Messenger left panel must read that param on mount and seed both the Zustand `searchQuery` and the local debounced input.

- [ ] **Step 7.1: Add the URL-param effect**

At the top of `ChatList.tsx`, add the import:

```ts
import { useSearchParams } from 'next/navigation';
```

Inside the `ChatList` function, after the existing `useState(searchQuery)` for `localSearch`, add:

```ts
  // Seed search from ?search=... URL param (set by /chats group rows
  // navigating to /messenger?search=<domain>). Runs once on mount only.
  const searchParams = useSearchParams();
  useEffect(() => {
    const fromUrl = searchParams?.get('search');
    if (fromUrl && fromUrl !== searchQuery) {
      setSearchQuery(fromUrl);
      setLocalSearch(fromUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
```

(`useEffect` may already be imported; if not, add it to the import from `'react'`.)

- [ ] **Step 7.2: Type-check**

```bash
npx tsc -p apps/web/tsconfig.json --noEmit
```

Expected: No errors.

- [ ] **Step 7.3: Commit**

```bash
git add apps/web/src/components/messenger/ChatList.tsx
git commit -m "feat(messenger): seed left-panel search from ?search= URL param"
```

---

## Task 8: Manual end-to-end verification

This task uses the seed Gmail chat (`69840d07-da19-451e-8302-f636ac345fa4`) that already has 3 HTML emails from `sarah@acme.example`. Since we have only one chat from `acme.example`, we need at least one more chat from the same domain to actually trigger grouping.

- [ ] **Step 8.1: Inject a second Gmail chat from `acme.example`**

Use a temporary Node script via Bash to insert a second chat with at least one Gmail message whose `fromEmail` is on the same `acme.example` domain. Reuse the same `organizationId` and `importedById` as the existing seed chat.

If `scripts/` does not exist at the repo root, create it (`mkdir scripts`).

Sketch:

```ts
// scripts/seed-extra-acme-chat.ts (temporary, delete after verification)
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ORG_ID = '<copy from existing chat>';
const USER_ID = '<copy from existing chat>';

async function main() {
  const chat = await prisma.chat.create({
    data: {
      organizationId: ORG_ID,
      importedById: USER_ID,
      messenger: 'gmail',
      chatType: 'direct',
      name: 'Q2 Marketing brief',
      externalChatId: `gmail-test-${Date.now()}`,
      status: 'active',
      messageCount: 1,
      lastActivityAt: new Date(),
    },
  });
  await prisma.message.create({
    data: {
      chatId: chat.id,
      organizationId: ORG_ID,
      senderName: 'Sarah Johnson',
      isSelf: false,
      text: 'Hi Anton, here is the brief...',
      subject: 'Q2 Marketing brief',
      htmlBody: '<p>Hi Anton, here is the brief...</p>',
      plainBody: 'Hi Anton, here is the brief...',
      fromEmail: 'sarah@acme.example',
      toEmails: ['anton@omnichannel.dev'],
    },
  });
  console.log('Inserted', chat.id);
}
main().finally(() => prisma.$disconnect());
```

Run:
```bash
cd apps/api && node --env-file=.env ../../node_modules/.bin/tsx ../../scripts/seed-extra-acme-chat.ts
```

- [ ] **Step 8.2: Start dev servers via preview**

If preview servers are not already running, start `web`, `api`, and `worker` from `.claude/launch.json`.

- [ ] **Step 8.3: Open `/chats` and verify grouping appears**

Use `mcp__Claude_Preview__preview_snapshot` to inspect the page. Look for a single row labeled `Sarah Johnson` (or `Acme` if no senderName majority) instead of two separate rows for the seed chat and the new chat.

- [ ] **Step 8.4: Click the group and verify navigation**

Use `mcp__Claude_Preview__preview_click` on the group row's link. Verify:
1. URL becomes `/messenger?search=acme.example`
2. Left-panel search input is prefilled with `acme.example`
3. Left panel shows both threads from `sarah@acme.example`

Take a screenshot via `mcp__Claude_Preview__preview_screenshot`.

- [ ] **Step 8.5: Verify no regression for other messengers**

Use `mcp__Claude_Preview__preview_snapshot` on `/chats` again. Verify Telegram and Slack rows still render normally, with no missing rows or duplicated rows.

- [ ] **Step 8.6: Verify free-mail safeguard**

Insert one more chat from `john@gmail.com` and one from `jane@gmail.com`. Verify they appear as TWO separate rows in `/chats`, NOT collapsed into a "Gmail" group.

- [ ] **Step 8.7: Cleanup**

Delete the temporary seed script from `scripts/`. Optionally delete the test chats via Prisma Studio or a cleanup script — they don't need to persist.

```bash
rm scripts/seed-extra-acme-chat.ts
```

- [ ] **Step 8.8: Final commit**

```bash
git add -A
git commit -m "test: verify gmail chat grouping end-to-end"
```

---

## Risks & Rollback

| Risk | Mitigation |
|---|---|
| `extractDomain` mishandles an exotic TLD | Worst case: a row labeled by a wrong domain. Easy to extend `MULTI_PART_SUFFIXES` |
| `Message.fromEmail` index missing → slow search | Existing `text`-search uses the same nested `some` query without an index. Add `Message_fromEmail_idx` later if metrics show pressure |
| Group rendering breaks bulk-select | Groups have no checkbox; bulk-select continues to work on individual chats |
| `useSearchParams` requires a Suspense boundary in some Next.js setups | If a build error mentions Suspense, wrap `ChatList`'s search-reading effect inside a `<Suspense>` or guard with a `'use client'` directive (already present) |
| User confusion at the new collapsed UI | Group label copies the sender name visually; clicking always navigates somewhere predictable. If feedback negative, add a toggle later (deferred per YAGNI) |

**Rollback:** Revert the merged commit. The DB schema is unchanged, so no migration rollback is needed.

---

## Out of scope (explicitly)

- Server-side grouping
- Pagination of grouped rows
- A toggle to disable grouping
- Bulk operations on groups
- Fixing the pre-existing `?chatId=` link from `/chats` → `/messenger` (the messenger page never read it)
- Adding `Message_fromEmail_idx`
- Updating other messengers' rendering
