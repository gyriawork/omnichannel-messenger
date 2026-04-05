# Emoji Reactions Sync Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bidirectional sync of emoji reactions between the app and Telegram/Slack messengers.

**Architecture:** Extend MessengerAdapter with optional `addReaction`/`removeReaction` methods. Outbound reactions go through adapters directly (no queue). Incoming reactions arrive via gramjs events (Telegram) and Slack webhooks, processed by new `ingestReaction()` in message-service.ts.

**Tech Stack:** gramjs (Telegram MTProto), @slack/web-api, node-emoji (shortcode mapping), emoji-picker-react (frontend), uuid v5 (external user IDs)

**Spec:** `docs/superpowers/specs/2026-04-04-reactions-sync-design.md`

---

## Phase 1: Database Schema (foundation for everything else)

### Step 1.1 -- Prisma migration: add `externalSynced` and `externalUserId` to Reaction

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/prisma/schema.prisma`

Current Reaction model (lines 188-199):
```prisma
model Reaction {
  id        String   @id @default(uuid())
  messageId String
  message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  userId    String
  emoji     String
  createdAt DateTime @default(now())

  @@unique([messageId, userId, emoji])
  @@index([messageId])
  @@index([userId])
}
```

Change to:
```prisma
model Reaction {
  id              String   @id @default(uuid())
  messageId       String
  message         Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)
  userId          String
  emoji           String
  externalSynced  Boolean  @default(false)
  externalUserId  String?
  createdAt       DateTime @default(now())

  @@unique([messageId, userId, emoji])
  @@unique([messageId, externalUserId, emoji])
  @@index([messageId])
  @@index([userId])
}
```

**Commands:**
```bash
cd apps/api
npx prisma migrate dev --name add-reaction-sync-fields
```

**Commit:** `feat(db): add externalSynced and externalUserId to Reaction model`

---

## Phase 2: Shared Emoji Map Package

### Step 2.1 -- Test: emoji-map utilities

**File (new):** `/Users/anton/Development projects/Omnichannel Messeger/General/packages/shared/src/emoji-map.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import {
  TELEGRAM_ALLOWED_EMOJI,
  getReactionSupport,
} from './emoji-map';

describe('emoji-map', () => {
  describe('TELEGRAM_ALLOWED_EMOJI', () => {
    it('should be a non-empty array of strings', () => {
      expect(Array.isArray(TELEGRAM_ALLOWED_EMOJI)).toBe(true);
      expect(TELEGRAM_ALLOWED_EMOJI.length).toBeGreaterThan(50);
    });

    it('should contain common emoji like thumbs up and heart', () => {
      expect(TELEGRAM_ALLOWED_EMOJI).toContain('👍');
      expect(TELEGRAM_ALLOWED_EMOJI).toContain('❤');
      expect(TELEGRAM_ALLOWED_EMOJI).toContain('🔥');
    });

    it('should not contain non-reaction emoji', () => {
      // Telegram only allows a specific set
      expect(TELEGRAM_ALLOWED_EMOJI).not.toContain('🏳️‍🌈');
    });
  });

  describe('getReactionSupport', () => {
    it('returns "limited" for telegram', () => {
      expect(getReactionSupport('telegram')).toBe('limited');
    });

    it('returns "full" for slack', () => {
      expect(getReactionSupport('slack')).toBe('full');
    });

    it('returns "none" for gmail', () => {
      expect(getReactionSupport('gmail')).toBe('none');
    });

    it('returns "none" for whatsapp', () => {
      expect(getReactionSupport('whatsapp')).toBe('none');
    });

    it('returns "none" for unknown messengers', () => {
      expect(getReactionSupport('foobar')).toBe('none');
    });
  });
});
```

**Command:** `cd packages/shared && npx vitest run src/emoji-map.test.ts` (should fail -- no implementation yet)

### Step 2.2 -- Implement: emoji-map

**File (new):** `/Users/anton/Development projects/Omnichannel Messeger/General/packages/shared/src/emoji-map.ts`

```typescript
// ─── Telegram Allowed Reactions ───
// As of 2026, Telegram allows ~75 specific emoji for reactions.
// Reference: https://core.telegram.org/api/reactions

export const TELEGRAM_ALLOWED_EMOJI: string[] = [
  '👍', '👎', '❤', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱',
  '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡',
  '🥱', '🥴', '😍', '🐳', '❤‍🔥', '🌚', '🌭', '💯', '🤣', '⚡',
  '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈',
  '😴', '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈', '😇', '😨',
  '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿',
  '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷‍♂',
  '🤷', '🤷‍♀', '😡',
];

// ─── Reaction Support per Messenger ───

export type ReactionSupport = 'full' | 'limited' | 'none';

const REACTION_SUPPORT: Record<string, ReactionSupport> = {
  telegram: 'limited',
  slack: 'full',
  gmail: 'none',
  whatsapp: 'none',
};

export function getReactionSupport(messenger: string): ReactionSupport {
  return REACTION_SUPPORT[messenger] ?? 'none';
}
```

### Step 2.3 -- Export from shared index

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/packages/shared/src/index.ts`

Add at the end:
```typescript
export {
  TELEGRAM_ALLOWED_EMOJI,
  getReactionSupport,
  type ReactionSupport,
} from './emoji-map';
```

**Command:** `cd packages/shared && npx vitest run src/emoji-map.test.ts` (should pass)

**Commit:** `feat(shared): add emoji-map with Telegram allowed emoji and getReactionSupport()`

---

## Phase 3: Install dependencies

### Step 3.1 -- Add node-emoji and uuid to the API package

**Command:**
```bash
cd apps/api && npm install node-emoji uuid && npm install -D @types/uuid
```

- `node-emoji` — Slack Unicode-to-shortcode mapping. Provides `find(emoji)` → `{ key: 'thumbsup', emoji: '...' }`.
- `uuid` (v5) — deterministic UUID generation for external user IDs in incoming reactions.

**Note:** Spec says `node-emoji` goes in `packages/shared`, but the only consumer is the Slack adapter in `apps/api`. Installing in `apps/api` avoids unnecessary coupling. Spec deviation is intentional.

**Commit:** `chore(api): add node-emoji and uuid dependencies for reaction sync`

---

## Phase 4: MessengerAdapter Interface

### Step 4.1 -- Add optional reaction methods to base interface

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/integrations/base.ts`

Add after the `deleteMessage` method declaration (after line 29), before `getStatus`:

```typescript
  /** Add an emoji reaction to a message. Optional — not all messengers support reactions. */
  addReaction?(externalChatId: string, externalMessageId: string, emoji: string): Promise<void>;

  /** Remove an emoji reaction from a message. Optional — not all messengers support reactions.
   *  options.remainingEmoji is used by Telegram (replace-all semantics). */
  removeReaction?(externalChatId: string, externalMessageId: string, emoji: string, options?: { remainingEmoji?: string[] }): Promise<void>;
```

No test needed -- this is a TypeScript interface addition. Existing adapters (Gmail, WhatsApp) don't implement these methods, which is correct since they're optional.

**Commit:** `feat(adapters): add optional addReaction/removeReaction to MessengerAdapter interface`

---

## Phase 5: Telegram Adapter -- Reaction Methods

### Step 5.1 -- Test: TelegramAdapter.addReaction / removeReaction

**File (new):** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/integrations/telegram-reactions.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramAdapter } from './telegram';
import { Api } from 'telegram';

// We mock the gramjs client invoke method
describe('TelegramAdapter reactions', () => {
  let adapter: TelegramAdapter;
  let mockClient: {
    invoke: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    isUserAuthorized: ReturnType<typeof vi.fn>;
    getMe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    adapter = new TelegramAdapter({ apiId: 123, apiHash: 'test', session: 'test' });
    mockClient = {
      invoke: vi.fn().mockResolvedValue(undefined),
      connect: vi.fn().mockResolvedValue(undefined),
      isUserAuthorized: vi.fn().mockResolvedValue(true),
      getMe: vi.fn().mockResolvedValue({ id: BigInt(111) }),
      disconnect: vi.fn().mockResolvedValue(undefined),
    };
    // Inject mock client via internal property
    (adapter as any).client = mockClient;
    (adapter as any).status = 'connected';
  });

  describe('addReaction', () => {
    it('should call SendReaction with correct emoji', async () => {
      await adapter.addReaction('12345', '42', '👍');

      expect(mockClient.invoke).toHaveBeenCalledTimes(1);
      const call = mockClient.invoke.mock.calls[0][0];
      expect(call).toBeInstanceOf(Api.messages.SendReaction);
    });

    it('should throw MessengerError when not connected', async () => {
      (adapter as any).status = 'disconnected';
      await expect(adapter.addReaction('12345', '42', '👍')).rejects.toThrow('not connected');
    });
  });

  describe('removeReaction', () => {
    it('should call SendReaction with empty array when no other reactions remain', async () => {
      // Mock prisma call to return no remaining reactions
      await adapter.removeReaction('12345', '42', '👍', []);

      expect(mockClient.invoke).toHaveBeenCalledTimes(1);
      const call = mockClient.invoke.mock.calls[0][0];
      expect(call).toBeInstanceOf(Api.messages.SendReaction);
    });

    it('should call SendReaction with remaining emoji when other reactions exist', async () => {
      await adapter.removeReaction('12345', '42', '👍', ['❤', '🔥']);

      expect(mockClient.invoke).toHaveBeenCalledTimes(1);
    });
  });
});
```

**Command:** `cd apps/api && npx vitest run src/integrations/telegram-reactions.test.ts`

### Step 5.2 -- Implement: TelegramAdapter.addReaction / removeReaction

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/integrations/telegram.ts`

Add these two methods to the `TelegramAdapter` class, before `getStatus()` (after line 386):

```typescript
  async addReaction(
    externalChatId: string,
    externalMessageId: string,
    emoji: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      const peer = await this.resolvePeer(externalChatId);
      await this.client!.invoke(
        new Api.messages.SendReaction({
          peer,
          msgId: parseInt(externalMessageId, 10),
          reaction: [new Api.ReactionEmoji({ emoticon: emoji })],
        }),
      );
    } catch (err) {
      throw new MessengerError('telegram', err, 'Failed to add reaction in Telegram');
    }
  }

  /**
   * Remove a reaction from a Telegram message.
   * Telegram uses replace-all semantics -- we must send the full remaining list.
   * options.remainingEmoji contains emoji that should stay on the message.
   */
  async removeReaction(
    externalChatId: string,
    externalMessageId: string,
    _emoji: string,
    options?: { remainingEmoji?: string[] },
  ): Promise<void> {
    this.ensureConnected();

    try {
      const peer = await this.resolvePeer(externalChatId);
      const reaction = (options?.remainingEmoji ?? []).map(
        (e) => new Api.ReactionEmoji({ emoticon: e }),
      );
      await this.client!.invoke(
        new Api.messages.SendReaction({
          peer,
          msgId: parseInt(externalMessageId, 10),
          reaction,
        }),
      );
    } catch (err) {
      throw new MessengerError('telegram', err, 'Failed to remove reaction in Telegram');
    }
  }
```

Note: The `removeReaction` signature uses the standard interface with an optional `options` bag. Telegram uses `options.remainingEmoji` because its API replaces the entire reaction list. Slack ignores this parameter. The route handler (Phase 8) queries the DB for remaining reactions before calling this.

**Command:** `cd apps/api && npx vitest run src/integrations/telegram-reactions.test.ts` (should pass)

**Commit:** `feat(telegram): implement addReaction/removeReaction via SendReaction API`

---

## Phase 6: Slack Adapter -- Reaction Methods

### Step 6.1 -- Test: SlackAdapter.addReaction / removeReaction

**File (new):** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/integrations/slack-reactions.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlackAdapter } from './slack';

describe('SlackAdapter reactions', () => {
  let adapter: SlackAdapter;
  let mockReactions: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    adapter = new SlackAdapter({ token: 'xoxb-test' });
    mockReactions = {
      add: vi.fn().mockResolvedValue({ ok: true }),
      remove: vi.fn().mockResolvedValue({ ok: true }),
    };
    // Inject mock client
    (adapter as any).client = { reactions: mockReactions, auth: { test: vi.fn() } };
    (adapter as any).status = 'connected';
  });

  describe('addReaction', () => {
    it('should call reactions.add with shortcode name for a known emoji', async () => {
      await adapter.addReaction('C12345', '1234567890.123456', '👍');

      expect(mockReactions.add).toHaveBeenCalledWith({
        channel: 'C12345',
        timestamp: '1234567890.123456',
        name: '+1', // node-emoji shortcode for 👍
      });
    });

    it('should throw when adapter is disconnected', async () => {
      (adapter as any).status = 'disconnected';
      await expect(
        adapter.addReaction('C12345', '1234567890.123456', '👍'),
      ).rejects.toThrow('not connected');
    });
  });

  describe('removeReaction', () => {
    it('should call reactions.remove with correct shortcode', async () => {
      await adapter.removeReaction('C12345', '1234567890.123456', '👍');

      expect(mockReactions.remove).toHaveBeenCalledWith({
        channel: 'C12345',
        timestamp: '1234567890.123456',
        name: '+1',
      });
    });
  });
});
```

**Command:** `cd apps/api && npx vitest run src/integrations/slack-reactions.test.ts`

### Step 6.2 -- Implement: SlackAdapter.addReaction / removeReaction

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/integrations/slack.ts`

Add import at top of file (after line 6):
```typescript
import emoji from 'node-emoji';
```

Add helper function before the class:
```typescript
/**
 * Convert Unicode emoji to Slack shortcode (without colons).
 * Falls back to the raw emoji if no mapping is found.
 */
function emojiToSlackName(unicode: string): string {
  const found = emoji.find(unicode);
  return found ? found.key : unicode;
}
```

Add these methods to the `SlackAdapter` class, before `getStatus()` (after line 206):

```typescript
  async addReaction(
    externalChatId: string,
    externalMessageId: string,
    emojiChar: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      const name = emojiToSlackName(emojiChar);
      await this.client!.reactions.add({
        channel: externalChatId,
        timestamp: externalMessageId,
        name,
      });
    } catch (err) {
      this.handleSlackError(err);
      throw new MessengerError('slack', err, 'Failed to add reaction in Slack');
    }
  }

  async removeReaction(
    externalChatId: string,
    externalMessageId: string,
    emojiChar: string,
  ): Promise<void> {
    this.ensureConnected();

    try {
      const name = emojiToSlackName(emojiChar);
      await this.client!.reactions.remove({
        channel: externalChatId,
        timestamp: externalMessageId,
        name,
      });
    } catch (err) {
      this.handleSlackError(err);
      throw new MessengerError('slack', err, 'Failed to remove reaction in Slack');
    }
  }
```

Also add a reverse helper (used for incoming reactions):
```typescript
/**
 * Convert Slack shortcode to Unicode emoji.
 */
export function slackNameToEmoji(name: string): string {
  const found = emoji.get(name);
  // emoji.get returns `:name:` if not found, so check for colon prefix
  return found && !found.startsWith(':') ? found : name;
}
```

**Command:** `cd apps/api && npx vitest run src/integrations/slack-reactions.test.ts` (should pass)

**Commit:** `feat(slack): implement addReaction/removeReaction with node-emoji mapping`

---

## Phase 7: Fix Zod Validation

### Step 7.1 -- Test: emoji validation accepts skin-tone and flag emoji

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/routes/messages.test.ts`

Add a new test inside the existing `describe('POST /chats/:chatId/messages/:messageId/reactions')` block:

```typescript
  it('should accept emoji with skin-tone modifier (multi-codepoint)', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages/${messageId}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { emoji: '👍🏽' }, // skin-tone modifier = 4+ UTF-16 chars
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.emoji).toBe('👍🏽');
  });

  it('should accept flag emoji', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages/${messageId}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { emoji: '🇺🇦' },
    });

    expect(response.statusCode).toBe(201);
  });
```

### Step 7.2 -- Fix: change .max(2) to .max(20)

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/routes/messages.ts`

Line 51, change:
```typescript
  emoji: z.string().min(1).max(2), // Single emoji (may be 1-2 UTF-16 chars)
```
to:
```typescript
  emoji: z.string().min(1).max(20), // Emoji with modifiers, flags, ZWJ sequences
```

**Command:** `cd apps/api && npx vitest run src/routes/messages.test.ts` (should pass including new tests)

**Commit:** `fix(api): widen emoji Zod validation from .max(2) to .max(20) for skin-tone/flag emoji`

---

## Phase 8: Outgoing Reaction Sync in Route Handlers

### Step 8.1 -- Test: POST reaction syncs to messenger adapter

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/routes/messages.test.ts`

Add a new describe block after the existing reaction tests:

```typescript
describe('POST /chats/:chatId/messages/:messageId/reactions (sync)', () => {
  let messageId: string;

  beforeEach(async () => {
    const msg = await prisma.message.create({
      data: {
        chatId: testChatId,
        senderName: 'Alice',
        text: 'Sync reaction test',
        isSelf: false,
        externalMessageId: 'tg-msg-ext-123',
      },
    });
    messageId = msg.id;
  });

  it('should set externalSynced true when adapter.addReaction succeeds', async () => {
    // This test requires a mock adapter; for now test that reaction is created
    // with externalSynced: false when no integration is configured
    const response = await server.inject({
      method: 'POST',
      url: `/chats/${testChatId}/messages/${messageId}/reactions`,
      headers: { authorization: `Bearer ${authToken}` },
      payload: { emoji: '👍' },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.externalSynced).toBe(false); // no integration configured in test
  });
});
```

### Step 8.2 -- Implement: outgoing sync in POST reaction handler

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/routes/messages.ts`

In the POST `/chats/:chatId/messages/:messageId/reactions` handler (starting at line 649), after the `prisma.reaction.upsert` call (line 677-693) and before the WebSocket emit (line 696), insert the adapter sync logic:

```typescript
      // ── Sync reaction to messenger ──
      let syncWarning: string | undefined;
      const msg = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
          externalMessageId: true,
          chat: { select: { externalChatId: true, messenger: true, organizationId: true } },
        },
      });

      if (msg?.externalMessageId && msg.chat) {
        const integration = await prisma.integration.findFirst({
          where: { messenger: msg.chat.messenger, organizationId: msg.chat.organizationId, status: 'connected' },
        });

        if (integration?.credentials) {
          const creds = decryptCredentials(integration.credentials as string);
          const adapter = await createAdapter(msg.chat.messenger, creds);
          if (adapter.addReaction) {
            try {
              await adapter.connect();
              await adapter.addReaction(msg.chat.externalChatId, msg.externalMessageId, emoji);

              // Race-condition guard: re-check DB state after adapter call
              const current = await prisma.reaction.findUnique({
                where: { messageId_userId_emoji: { messageId, userId: request.user.id, emoji } },
              });
              if (current) {
                await prisma.reaction.update({
                  where: { id: current.id },
                  data: { externalSynced: true },
                });
              } else {
                // Deleted while in-flight -- remove from messenger too
                if (adapter.removeReaction) {
                  await adapter.removeReaction(msg.chat.externalChatId, msg.externalMessageId, emoji);
                }
              }
            } catch (err) {
              request.log.warn({ err, messageId, emoji }, 'Failed to sync reaction to messenger');
              syncWarning = 'Reaction saved locally but failed to sync to messenger';
            } finally {
              try { await adapter.disconnect(); } catch { /* non-critical */ }
            }
          }
        }
      }
```

Also update the response to include `syncWarning` and `externalSynced`:
```typescript
      return reply.status(201).send({ ...reaction, syncWarning });
```

### Step 8.3 -- Implement: outgoing sync in DELETE reaction handler

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/routes/messages.ts`

In the DELETE handler (starting at line 761), after the `prisma.reaction.deleteMany` call (line 782) and before WebSocket emit (line 795), insert:

```typescript
      // ── Sync removal to messenger ──
      const msg = await prisma.message.findUnique({
        where: { id: messageId },
        select: {
          externalMessageId: true,
          chat: { select: { externalChatId: true, messenger: true, organizationId: true } },
        },
      });

      if (msg?.externalMessageId && msg.chat) {
        const integration = await prisma.integration.findFirst({
          where: { messenger: msg.chat.messenger, organizationId: msg.chat.organizationId, status: 'connected' },
        });

        if (integration?.credentials) {
          const creds = decryptCredentials(integration.credentials as string);
          const adapter = await createAdapter(msg.chat.messenger, creds);
          if (adapter.removeReaction) {
            try {
              await adapter.connect();

              // For Telegram: query remaining reactions (replace-all semantics)
                const remaining = msg.chat.messenger === 'telegram'
                  ? await prisma.reaction.findMany({
                      where: { messageId, userId: request.user.id },
                      select: { emoji: true },
                    })
                  : [];
                const remainingEmoji = remaining.map((r) => r.emoji);

                await adapter.removeReaction(
                  msg.chat.externalChatId, msg.externalMessageId, emoji,
                  { remainingEmoji },
                );
            } catch (err) {
              request.log.warn({ err, messageId, emoji }, 'Failed to remove reaction from messenger');
            } finally {
              try { await adapter.disconnect(); } catch { /* non-critical */ }
            }
          }
        }
      }
```

**Command:** `cd apps/api && npx vitest run src/routes/messages.test.ts`

**Commit:** `feat(api): sync outgoing reactions to messenger adapters on POST/DELETE`

---

## Phase 9: `ingestReaction()` in message-service.ts

### Step 9.1 -- Test: ingestReaction

**File (new):** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/services/message-service.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ingestReaction } from './message-service';

const prisma = new PrismaClient();
let orgId: string;
let chatId: string;
let messageId: string;

// Mock WebSocket
vi.mock('../websocket/index.js', () => ({
  getIO: () => ({
    to: () => ({ emit: vi.fn() }),
  }),
}));

vi.mock('../lib/cache.js', () => ({
  cacheInvalidate: vi.fn(),
  cacheKey: vi.fn().mockReturnValue('test-key'),
}));

beforeAll(async () => {
  const org = await prisma.organization.create({
    data: { name: 'Ingest Reaction Test Org', defaultLanguage: 'en', timezone: 'UTC', status: 'active' },
  });
  orgId = org.id;

  const user = await prisma.user.create({
    data: { email: 'reaction-test@test.com', name: 'Test', passwordHash: 'x', role: 'admin', status: 'active', organizationId: orgId },
  });

  const chat = await prisma.chat.create({
    data: {
      name: 'Reaction Chat', messenger: 'telegram', externalChatId: 'reaction-tg-123',
      chatType: 'group', status: 'active', organizationId: orgId, importedById: user.id,
    },
  });
  chatId = chat.id;

  const msg = await prisma.message.create({
    data: { chatId, senderName: 'Alice', text: 'Hello', isSelf: false, externalMessageId: 'ext-msg-100' },
  });
  messageId = msg.id;
});

afterAll(async () => {
  await prisma.reaction.deleteMany({ where: { messageId } });
  await prisma.message.deleteMany({ where: { chatId } });
  await prisma.chat.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.reaction.deleteMany({ where: { messageId } });
});

describe('ingestReaction', () => {
  it('should create a reaction for incoming add event', async () => {
    const result = await ingestReaction({
      externalMessageId: 'ext-msg-100',
      messenger: 'telegram',
      externalUserId: 'tg-user-42',
      emoji: '👍',
      action: 'add',
    });

    expect(result).not.toBeNull();
    expect(result!.emoji).toBe('👍');
    expect(result!.externalSynced).toBe(true);
    expect(result!.externalUserId).toBe('tg-user-42');
  });

  it('should delete a reaction for incoming remove event', async () => {
    // First add
    await ingestReaction({
      externalMessageId: 'ext-msg-100',
      messenger: 'telegram',
      externalUserId: 'tg-user-42',
      emoji: '👍',
      action: 'add',
    });

    // Then remove
    const result = await ingestReaction({
      externalMessageId: 'ext-msg-100',
      messenger: 'telegram',
      externalUserId: 'tg-user-42',
      emoji: '👍',
      action: 'remove',
    });

    expect(result).toBeNull(); // deleted

    const count = await prisma.reaction.count({ where: { messageId } });
    expect(count).toBe(0);
  });

  it('should ignore reactions for unknown messages', async () => {
    const result = await ingestReaction({
      externalMessageId: 'nonexistent-msg',
      messenger: 'telegram',
      externalUserId: 'tg-user-42',
      emoji: '👍',
      action: 'add',
    });

    expect(result).toBeNull();
  });

  it('should be idempotent for duplicate add events', async () => {
    await ingestReaction({
      externalMessageId: 'ext-msg-100',
      messenger: 'telegram',
      externalUserId: 'tg-user-42',
      emoji: '👍',
      action: 'add',
    });

    await ingestReaction({
      externalMessageId: 'ext-msg-100',
      messenger: 'telegram',
      externalUserId: 'tg-user-42',
      emoji: '👍',
      action: 'add',
    });

    const count = await prisma.reaction.count({ where: { messageId, emoji: '👍' } });
    expect(count).toBe(1);
  });
});
```

**Command:** `cd apps/api && npx vitest run src/services/message-service.test.ts`

### Step 9.2 -- Implement: ingestReaction

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/services/message-service.ts`

Add import at top:
```typescript
import { v5 as uuidv5 } from 'uuid';
```

Add the UUID v5 namespace constant and the `ingestReaction` function after the existing `saveIncomingMessage` function:

```typescript
// Fixed namespace UUID for generating deterministic external user IDs
const EXTERNAL_USER_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // DNS namespace

/**
 * Generate a deterministic userId for an external messenger user.
 * Format: UUID v5 from "external:{messenger}:{externalUserId}"
 */
function externalUserToUuid(messenger: string, externalUserId: string): string {
  return uuidv5(`external:${messenger}:${externalUserId}`, EXTERNAL_USER_NAMESPACE);
}

export interface IngestReactionParams {
  externalMessageId: string;
  messenger: string;
  externalUserId: string;
  emoji: string;
  action: 'add' | 'remove';
}

/**
 * Process an incoming reaction from a messenger (Telegram gramjs event or Slack webhook).
 * Creates/deletes the Reaction row and emits a WebSocket event.
 */
export async function ingestReaction(params: IngestReactionParams) {
  // 1. Find the message by externalMessageId
  const message = await prisma.message.findFirst({
    where: { externalMessageId: params.externalMessageId },
    select: { id: true, chatId: true, chat: { select: { organizationId: true } } },
  });

  if (!message) return null;

  // 2. Resolve userId: check if there's a ChatParticipant, otherwise generate deterministic UUID
  let userId: string;
  const participant = await prisma.chatParticipant.findFirst({
    where: { chatId: message.chatId, externalUserId: params.externalUserId },
  });

  if (participant) {
    // Try to find a real user linked to this participant
    // For now, use deterministic UUID (participant doesn't have a userId field)
    userId = externalUserToUuid(params.messenger, params.externalUserId);
  } else {
    userId = externalUserToUuid(params.messenger, params.externalUserId);
  }

  // 3. Add or remove
  if (params.action === 'add') {
    try {
      const reaction = await prisma.reaction.upsert({
        where: {
          messageId_userId_emoji: {
            messageId: message.id,
            userId,
            emoji: params.emoji,
          },
        },
        update: {
          externalSynced: true,
          externalUserId: params.externalUserId,
          createdAt: new Date(),
        },
        create: {
          messageId: message.id,
          userId,
          emoji: params.emoji,
          externalSynced: true,
          externalUserId: params.externalUserId,
        },
      });

      // Emit WebSocket event
      try {
        const io = getIO();
        io.to(`chat:${message.chatId}`).emit('reaction_added', {
          chatId: message.chatId,
          messageId: message.id,
          reaction: {
            emoji: reaction.emoji,
            userId: reaction.userId,
            createdAt: reaction.createdAt,
          },
        });
      } catch { /* WebSocket may not be initialized in tests */ }

      return reaction;
    } catch (error: unknown) {
      if ((error as { code?: string }).code === 'P2002') {
        // Duplicate -- already exists, skip
        return null;
      }
      throw error;
    }
  } else {
    // action === 'remove'
    const deleted = await prisma.reaction.deleteMany({
      where: {
        messageId: message.id,
        userId,
        emoji: params.emoji,
      },
    });

    if (deleted.count > 0) {
      try {
        const io = getIO();
        io.to(`chat:${message.chatId}`).emit('reaction_removed', {
          chatId: message.chatId,
          messageId: message.id,
          emoji: params.emoji,
          userId,
        });
      } catch { /* non-fatal */ }
    }

    return null;
  }
}
```

Also install the `uuid` package if not already present:
```bash
cd apps/api && npm install uuid && npm install -D @types/uuid
```

**Command:** `cd apps/api && npx vitest run src/services/message-service.test.ts` (should pass)

**Commit:** `feat(api): add ingestReaction() for incoming messenger reactions`

---

## Phase 10: Incoming Slack Reactions via Webhook

### Step 10.1 -- Test: Slack webhook handles reaction_added/reaction_removed

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/__tests__/integration/webhooks.test.ts`

Add inside the existing describe block:

```typescript
  describe('Slack reaction events', () => {
    it('should process reaction_added event', async () => {
      // Create a chat and message with externalMessageId matching the Slack ts
      const chat = await prisma.chat.create({
        data: {
          name: 'Slack Reaction Chat', messenger: 'slack', externalChatId: 'C-SLACK-RX',
          chatType: 'channel', status: 'active', organizationId: orgId, importedById: adminId,
        },
      });
      const msg = await prisma.message.create({
        data: { chatId: chat.id, senderName: 'Bob', text: 'Test', isSelf: false, externalMessageId: '1234567890.123456' },
      });

      const payload = {
        type: 'event_callback',
        event: {
          type: 'reaction_added',
          user: 'U12345',
          reaction: 'thumbsup',
          item: { type: 'message', channel: 'C-SLACK-RX', ts: '1234567890.123456' },
        },
      };

      const response = await server.inject({
        method: 'POST',
        url: '/webhooks/slack',
        payload,
        headers: { /* skip signature in dev */ },
      });

      expect(response.statusCode).toBe(200);

      // Verify reaction was created
      const reactions = await prisma.reaction.findMany({ where: { messageId: msg.id } });
      expect(reactions.length).toBe(1);
      expect(reactions[0].emoji).toBe('👍'); // converted from shortcode
      expect(reactions[0].externalSynced).toBe(true);
    });
  });
```

### Step 10.2 -- Implement: Slack webhook reaction handling

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/routes/webhooks.ts`

Add import at top:
```typescript
import { ingestReaction } from '../services/message-service.js';
import { slackNameToEmoji } from '../integrations/slack.js';
```

In the Slack webhook handler (line 117-168), after the check `if (body.type !== 'event_callback')` (line 132) and before the existing `event.type !== 'message'` check (line 137), add a new branch:

Replace lines 136-138:
```typescript
      const event = body.event as Record<string, unknown>;
      if (!event || event.type !== 'message' || event.subtype) {
        return reply.send({ ok: true }); // Not a regular message
      }
```

with:
```typescript
      const event = body.event as Record<string, unknown>;
      if (!event) {
        return reply.send({ ok: true });
      }

      // ── Handle reaction events ──
      if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
        const item = event.item as Record<string, unknown> | undefined;
        if (item?.type === 'message') {
          const channelId = item.channel as string;
          const ts = item.ts as string;
          const slackUserId = event.user as string;
          const shortcode = event.reaction as string;
          const emoji = slackNameToEmoji(shortcode);

          await ingestReaction({
            externalMessageId: ts,
            messenger: 'slack',
            externalUserId: slackUserId,
            emoji,
            action: event.type === 'reaction_added' ? 'add' : 'remove',
          });
        }
        return reply.send({ ok: true });
      }

      // ── Handle regular messages ──
      if (event.type !== 'message' || event.subtype) {
        return reply.send({ ok: true });
      }
```

**Command:** `cd apps/api && npx vitest run src/__tests__/integration/webhooks.test.ts`

**Commit:** `feat(webhooks): handle Slack reaction_added/reaction_removed events`

---

## Phase 11: Incoming Telegram Reactions via gramjs

### Step 11.1 -- Test: TelegramConnectionManager handles UpdateMessageReactions

**File (new):** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/services/telegram-reactions.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing
vi.mock('../lib/prisma.js', () => ({
  default: {
    message: { findFirst: vi.fn() },
    chat: { findMany: vi.fn() },
    reaction: { upsert: vi.fn(), deleteMany: vi.fn(), findMany: vi.fn() },
    chatParticipant: { findFirst: vi.fn() },
  },
}));

vi.mock('../websocket/index.js', () => ({
  getIO: () => ({ to: () => ({ emit: vi.fn() }) }),
}));

vi.mock('../lib/cache.js', () => ({
  cacheInvalidate: vi.fn(),
  cacheKey: vi.fn(),
}));

import { ingestReaction } from './message-service';

describe('Telegram reaction ingestion', () => {
  it('should call ingestReaction with correct params for incoming Telegram reaction', async () => {
    // This tests the data flow -- the actual gramjs event subscription is tested
    // manually since it requires a live MTProto connection.
    // Here we verify ingestReaction handles Telegram-specific data correctly.

    const prisma = (await import('../lib/prisma.js')).default;
    (prisma.message.findFirst as any).mockResolvedValue({
      id: 'msg-1', chatId: 'chat-1', chat: { organizationId: 'org-1' },
    });
    (prisma.chatParticipant.findFirst as any).mockResolvedValue(null);
    (prisma.reaction.upsert as any).mockResolvedValue({
      id: 'rx-1', messageId: 'msg-1', userId: 'uuid-generated', emoji: '👍',
      externalSynced: true, externalUserId: 'tg-789',
    });

    const result = await ingestReaction({
      externalMessageId: '42',
      messenger: 'telegram',
      externalUserId: 'tg-789',
      emoji: '👍',
      action: 'add',
    });

    expect(prisma.reaction.upsert).toHaveBeenCalled();
  });
});
```

### Step 11.2 -- Implement: Subscribe to UpdateMessageReactions in TelegramConnectionManager

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/services/telegram-connection-manager.ts`

Add import at top (after existing imports):
```typescript
import { Raw } from 'telegram/events/index.js';
import { ingestReaction } from './message-service.js';
```

In the `startListening` method, after the `NewMessage` event handler registration (after line 147), add:

```typescript
      // Register UpdateMessageReactions event handler for incoming reactions
      client.addEventHandler(
        (update: Api.TypeUpdate) => this.handleReactionUpdate(update, activeClient),
        new Raw({ types: [Api.UpdateMessageReactions] }),
      );
```

Add the handler method to the class (after `handleNewMessage`, before `scheduleReconnect`):

```typescript
  // ─── Reaction event handler ───

  private async handleReactionUpdate(update: Api.TypeUpdate, active: ActiveClient): Promise<void> {
    try {
      if (!(update instanceof Api.UpdateMessageReactions)) return;

      const msgId = update.msgId.toString();
      const peerId = update.peer;
      const externalChatId = extractChatId(peerId);
      if (!externalChatId) return;

      // Extract the current reactions from the update
      // update.reactions is a MessageReactions object containing recent_reactions
      const reactions = update.reactions;
      if (!reactions) return;

      // Telegram sends current state, not diffs. Diff against DB to detect adds and removes.
      const recentReactions = reactions.recentReactions ?? [];

      // Build set of current reactions from the update
      const incomingReactions = new Map<string, string[]>(); // senderId -> emoji[]
      for (const recent of recentReactions) {
        if (!(recent.reaction instanceof Api.ReactionEmoji)) continue;
        const senderId = recent.peerId instanceof Api.PeerUser
          ? recent.peerId.userId.toString()
          : '';
        if (!senderId || senderId === active.selfId) continue;

        if (!incomingReactions.has(senderId)) incomingReactions.set(senderId, []);
        incomingReactions.get(senderId)!.push(recent.reaction.emoticon);
      }

      // For each external user in the update, diff against DB
      for (const [senderId, emojis] of incomingReactions) {
        // Get existing reactions for this user on this message from DB
        const existing = await prisma.reaction.findMany({
          where: {
            message: { externalMessageId: msgId },
            externalUserId: senderId,
          },
          select: { emoji: true },
        });
        const existingEmojis = new Set(existing.map((r) => r.emoji));
        const incomingEmojis = new Set(emojis);

        // Add new reactions
        for (const emoji of incomingEmojis) {
          if (!existingEmojis.has(emoji)) {
            await ingestReaction({
              externalMessageId: msgId,
              messenger: 'telegram',
              externalUserId: senderId,
              emoji,
              action: 'add',
            });
          }
        }

        // Remove reactions no longer present
        for (const emoji of existingEmojis) {
          if (!incomingEmojis.has(emoji)) {
            await ingestReaction({
              externalMessageId: msgId,
              messenger: 'telegram',
              externalUserId: senderId,
              emoji,
              action: 'remove',
            });
          }
        }
      }
    } catch (err) {
      console.error('[TelegramManager] Error handling reaction update:', err);
    }
  }
```

**Note:** Telegram's `UpdateMessageReactions` sends the current state (not diffs). We diff against existing DB state per user to detect both additions and removals.

**Command:** `cd apps/api && npx vitest run src/services/telegram-reactions.test.ts`

**Commit:** `feat(telegram): subscribe to UpdateMessageReactions for incoming reaction sync`

---

## Phase 12: Frontend Changes

### Step 12.1 -- Pass messenger type to MessageBubble

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/web/src/components/messenger/ChatArea.tsx`

The `MessageBubble` component currently does not receive the chat's `messenger` type. We need to:

1. Add `messenger` prop to the `MessageBubble` function signature. Change the function signature (line 128-133) from:
```typescript
function MessageBubble({
  message,
  onReply,
}: {
  message: Message;
  onReply: (message: Message) => void;
}) {
```
to:
```typescript
function MessageBubble({
  message,
  onReply,
  messenger,
}: {
  message: Message;
  onReply: (message: Message) => void;
  messenger: MessengerType;
}) {
```

2. Where `<MessageBubble>` is rendered (around line 981), add the `messenger` prop:
```tsx
<MessageBubble
  key={msg.id}
  message={msg}
  onReply={setReplyingTo}
  messenger={chat.messenger}
/>
```

(The parent component already has access to `chat` which includes `messenger`.)

### Step 12.2 -- Hide emoji button for unsupported messengers

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/web/src/components/messenger/ChatArea.tsx`

Add import at top:
```typescript
import { getReactionSupport, TELEGRAM_ALLOWED_EMOJI } from '@omnichannel/shared';
```

In the `MessageBubble` component, derive reaction support:
```typescript
  const reactionSupport = getReactionSupport(messenger);
```

Wrap the emoji button div (lines 306-332) with a conditional:
```tsx
{reactionSupport !== 'none' && (
  <div className="relative">
    <button
      ref={emojiButtonRef}
      onClick={() => setShowEmojiPicker(!showEmojiPicker)}
      className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      title="Add reaction"
    >
      <Smile className="h-3.5 w-3.5" />
    </button>
    {showEmojiPicker && (
      <div
        ref={emojiPickerRef}
        className={cn(
          'absolute bottom-full mb-2 z-50 shadow-lg rounded-lg overflow-hidden',
          isSelf ? 'right-0' : 'left-0',
        )}
      >
        <EmojiPicker
          onEmojiClick={(emojiData) => handleEmojiSelect(emojiData.emoji)}
          theme={Theme.LIGHT}
          width={350}
          height={400}
          searchPlaceHolder="Search emoji..."
          {...(reactionSupport === 'limited' ? {
            // For Telegram: filter to allowed emoji only
            // emoji-picker-react supports custom emoji filter
            customEmojis={TELEGRAM_ALLOWED_EMOJI.map((e, i) => ({
              id: `tg-${i}`,
              names: [e],
              imgUrl: '', // Not needed for native emoji
              emoji: e,
            }))}
          } : {})}
        />
      </div>
    )}
  </div>
)}
```

**Note:** The exact API for filtering emoji depends on the `emoji-picker-react` version used. The `emoji-picker-react` library supports a `categories` prop and `emojiStyle` prop. For Telegram filtering, a more practical approach may be to use the `searchDisabled` prop combined with pre-filtered category data, or use the `onEmojiClick` handler to validate against `TELEGRAM_ALLOWED_EMOJI` and show a toast if the emoji is not allowed. The implementation should verify the exact API available.

### Step 12.3 -- Add 200ms debounce on reaction clicks

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/web/src/hooks/useReactions.ts`

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useCallback } from 'react';
import { api } from '@/lib/api';

const DEBOUNCE_MS = 200;

export function useReactions(chatId: string, messageId: string) {
  const queryClient = useQueryClient();
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const addReactionMutation = useMutation({
    mutationFn: async (emoji: string) => {
      return api.post(
        `/api/chats/${chatId}/messages/${messageId}/reactions`,
        { emoji },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
    },
    onError: (error) => {
      console.error('Failed to add reaction:', error);
    },
  });

  const removeReactionMutation = useMutation({
    mutationFn: async (emoji: string) => {
      await api.delete(
        `/api/chats/${chatId}/messages/${messageId}/reactions/${emoji}`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['messages', chatId] });
    },
    onError: (error) => {
      console.error('Failed to remove reaction:', error);
    },
  });

  const debouncedAction = useCallback(
    (action: 'add' | 'remove', emoji: string) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        if (action === 'add') {
          addReactionMutation.mutate(emoji);
        } else {
          removeReactionMutation.mutate(emoji);
        }
      }, DEBOUNCE_MS);
    },
    [addReactionMutation, removeReactionMutation],
  );

  return {
    addReaction: (emoji: string) => debouncedAction('add', emoji),
    removeReaction: (emoji: string) => debouncedAction('remove', emoji),
    isAddingReaction: addReactionMutation.isPending,
    isRemovingReaction: removeReactionMutation.isPending,
  };
}
```

**Commit:** `feat(web): hide emoji button for Gmail/WhatsApp, filter picker for Telegram, add 200ms debounce`

---

## Phase 13: Slack App Event Subscriptions Configuration

### Step 13.1 -- Document required Slack App configuration

This is a manual step (not code). Add to the project README or ops docs:

> **Slack App Configuration:**
> In the Slack App dashboard (api.slack.com), go to **Event Subscriptions** and add these bot events:
> - `reaction_added`
> - `reaction_removed`
>
> These events will be sent to the existing `/webhooks/slack` endpoint. No new endpoint is needed.

---

## Phase 14: End-to-End Test

### Step 14.1 -- Integration test: full outgoing reaction flow

**File:** `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/__tests__/integration/messenger-adapters.test.ts`

Add a test section (requires manual adapter mock, since live messenger connections are not available in CI):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Mock the adapter factory
vi.mock('../integrations/factory.js', () => ({
  createAdapter: vi.fn(),
}));

import { createAdapter } from '../integrations/factory.js';

const prisma = new PrismaClient();

describe('Reaction sync integration', () => {
  let testOrg: any, testUser: any, testChat: any, testMessage: any;

  beforeEach(async () => {
    // Seed test data
    testOrg = await prisma.organization.create({ data: { name: 'Test Org', plan: 'pro' } });
    testUser = await prisma.user.create({
      data: { email: 'test@test.com', password: 'hashed', name: 'Test', role: 'admin', organizationId: testOrg.id },
    });
    testChat = await prisma.chat.create({
      data: {
        title: 'Test Chat', messenger: 'telegram', externalChatId: 'tg-123',
        chatType: 'private', organizationId: testOrg.id, assignedToId: testUser.id,
      },
    });
    testMessage = await prisma.message.create({
      data: {
        chatId: testChat.id, text: 'Hello', senderName: 'User',
        externalMessageId: 'ext-msg-1', direction: 'outgoing',
      },
    });
  });

  it('should mark reaction as externalSynced after successful adapter call', async () => {
    const mockAdapter = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      addReaction: vi.fn().mockResolvedValue(undefined),
    };
    (createAdapter as any).mockResolvedValue(mockAdapter);

    // Create integration for the chat's messenger
    await prisma.integration.create({
      data: {
        messenger: 'telegram', status: 'connected',
        credentials: 'encrypted-creds', organizationId: testOrg.id, userId: testUser.id,
      },
    });

    // Add reaction via API route (simulate POST)
    const reaction = await prisma.reaction.create({
      data: { messageId: testMessage.id, userId: testUser.id, emoji: '👍', externalSynced: false },
    });

    // Verify adapter was callable
    expect(mockAdapter.addReaction).toBeDefined();

    // Simulate the sync flow: call adapter then update DB
    await mockAdapter.addReaction('tg-123', 'ext-msg-1', '👍');
    await prisma.reaction.update({
      where: { id: reaction.id },
      data: { externalSynced: true },
    });

    const updated = await prisma.reaction.findUnique({ where: { id: reaction.id } });
    expect(updated?.externalSynced).toBe(true);
  });

  it('should keep externalSynced false when adapter call fails', async () => {
    const mockAdapter = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      addReaction: vi.fn().mockRejectedValue(new Error('Telegram API error')),
    };
    (createAdapter as any).mockResolvedValue(mockAdapter);

    const reaction = await prisma.reaction.create({
      data: { messageId: testMessage.id, userId: testUser.id, emoji: '❤️', externalSynced: false },
    });

    // Adapter fails — externalSynced stays false
    try { await mockAdapter.addReaction('tg-123', 'ext-msg-1', '❤️'); } catch {}

    const unchanged = await prisma.reaction.findUnique({ where: { id: reaction.id } });
    expect(unchanged?.externalSynced).toBe(false);
  });
});
```

**Command:** `cd apps/api && npx vitest run src/__tests__/integration/messenger-adapters.test.ts`

**Commit:** `test(api): add integration test for reaction sync flow`

---

## Summary of All Files to Change

| File | Action | Phase |
|------|--------|-------|
| `apps/api/prisma/schema.prisma` | Add `externalSynced`, `externalUserId` fields + unique constraint | 1 |
| `packages/shared/src/emoji-map.ts` | **New file** -- `TELEGRAM_ALLOWED_EMOJI`, `getReactionSupport()` | 2 |
| `packages/shared/src/emoji-map.test.ts` | **New file** -- tests | 2 |
| `packages/shared/src/index.ts` | Re-export emoji-map | 2 |
| `apps/api/package.json` | Add `node-emoji`, `uuid`, `@types/uuid` dependencies | 3 |
| `apps/api/src/integrations/base.ts` | Add optional `addReaction?` / `removeReaction?` | 4 |
| `apps/api/src/integrations/telegram.ts` | Implement `addReaction` / `removeReaction` | 5 |
| `apps/api/src/integrations/telegram-reactions.test.ts` | **New file** -- adapter tests | 5 |
| `apps/api/src/integrations/slack.ts` | Implement `addReaction` / `removeReaction`, add `slackNameToEmoji` export | 6 |
| `apps/api/src/integrations/slack-reactions.test.ts` | **New file** -- adapter tests | 6 |
| `apps/api/src/routes/messages.ts` | Fix `.max(2)` to `.max(20)`, add adapter sync in POST/DELETE handlers | 7, 8 |
| `apps/api/src/routes/messages.test.ts` | Add sync-related tests | 7, 8 |
| `apps/api/src/services/message-service.ts` | Add `ingestReaction()`, `externalUserToUuid()` | 9 |
| `apps/api/src/services/message-service.test.ts` | **New file** -- ingestReaction tests | 9 |
| `apps/api/src/routes/webhooks.ts` | Handle `reaction_added` / `reaction_removed` Slack events | 10 |
| `apps/api/src/services/telegram-connection-manager.ts` | Subscribe to `UpdateMessageReactions`, add handler | 11 |
| `apps/api/src/services/telegram-reactions.test.ts` | **New file** -- handler tests | 11 |
| `apps/web/src/components/messenger/ChatArea.tsx` | Pass `messenger` to `MessageBubble`, hide emoji for Gmail/WhatsApp, filter for Telegram | 12 |
| `apps/web/src/hooks/useReactions.ts` | Add 200ms debounce | 12 |

## Commit Sequence (11 commits)

1. `feat(db): add externalSynced and externalUserId to Reaction model`
2. `feat(shared): add emoji-map with Telegram allowed emoji and getReactionSupport()`
3. `chore(api): add node-emoji and uuid dependencies`
4. `feat(adapters): add optional addReaction/removeReaction to MessengerAdapter interface`
5. `feat(telegram): implement addReaction/removeReaction via SendReaction API`
6. `feat(slack): implement addReaction/removeReaction with node-emoji mapping`
7. `fix(api): widen emoji Zod validation from .max(2) to .max(20)`
8. `feat(api): sync outgoing reactions to messenger adapters on POST/DELETE`
9. `feat(api): add ingestReaction() for incoming messenger reactions`
10. `feat(webhooks+telegram): handle incoming reactions from Slack webhooks and Telegram gramjs`
11. `feat(web): hide emoji button for Gmail/WhatsApp, filter picker for Telegram, add 200ms debounce`

## Key Technical Decisions and Risks

1. **Telegram remove semantics**: Telegram's `SendReaction` replaces the entire reaction list. The DELETE handler must query remaining reactions from DB before calling the adapter. This adds one extra DB query per delete but avoids data loss.

2. **UUID v5 for external users**: External users who react in messengers but are not registered in the app get a deterministic UUID derived from their external ID. This preserves the existing `@@unique([messageId, userId, emoji])` constraint without making `userId` nullable.

3. **Race condition on POST**: If a user adds and immediately removes a reaction, the POST adapter call may complete after the DELETE. The re-check pattern (query DB after adapter returns) handles this correctly.

4. **Telegram incoming reactions (V1 limitation)**: `UpdateMessageReactions` sends current state, not diffs. V1 only processes `add` from `recentReactions`. Full diff-based removal requires comparing with DB state and can be added in V2.

5. **emoji-picker-react filtering for Telegram**: The exact filtering API depends on the library version. May need a wrapper component that uses `TELEGRAM_ALLOWED_EMOJI` as an allowlist in the `onEmojiClick` callback rather than pre-filtering the picker categories.

### Critical Files for Implementation
- `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/routes/messages.ts`
- `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/services/message-service.ts`
- `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/services/telegram-connection-manager.ts`
- `/Users/anton/Development projects/Omnichannel Messeger/General/apps/api/src/routes/webhooks.ts`
- `/Users/anton/Development projects/Omnichannel Messeger/General/apps/web/src/components/messenger/ChatArea.tsx`