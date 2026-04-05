# Chat History Sync — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically sync full message history for all imported chats across all 4 messengers (Telegram, Slack, WhatsApp, Gmail).

**Architecture:** Add `syncStatus`/`syncCursor` fields to Chat model. Update each adapter with paginated `getMessages()`. Rewrite the worker's `processChatHistorySync` to loop through all pages. On startup, recover any incomplete syncs.

**Tech Stack:** Prisma (schema migration), gramjs (Telegram), @slack/web-api (Slack), baileys (WhatsApp), googleapis (Gmail), BullMQ (worker jobs)

---

### Task 1: Schema Migration — Add sync fields to Chat model

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (Chat model, lines ~89-119)

- [ ] **Step 1: Add syncStatus and syncCursor fields**

In `apps/api/prisma/schema.prisma`, add two fields to the `Chat` model, before `messages` relation:

```prisma
  syncStatus       String   @default("pending") // pending | syncing | synced | failed
  syncCursor       String?  // adapter-specific pagination cursor for resumable sync
```

- [ ] **Step 2: Run migration**

```bash
cd apps/api && npx prisma migrate dev --name add-chat-sync-status
```

This will set all existing chats to `syncStatus = 'pending'` by default, which is exactly what we want — worker will pick them up and sync history.

- [ ] **Step 3: Generate Prisma client**

```bash
cd apps/api && npx prisma generate
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/
git commit -m "feat: add syncStatus and syncCursor to Chat model"
```

---

### Task 2: Update adapter interface with paginated getMessages

**Files:**
- Modify: `apps/worker/src/integrations/base.ts`

- [ ] **Step 1: Add HistoryMessage type and getMessages to interface**

Add after the `MessengerError` class at the end of `apps/worker/src/integrations/base.ts`:

```typescript
/** Standard message shape returned by getMessages */
export interface HistoryMessage {
  id: string;
  text: string;
  senderId: string;
  senderName?: string;
  date: Date;
  isSelf: boolean;
}

/** Result of a paginated getMessages call */
export interface GetMessagesResult {
  messages: HistoryMessage[];
  nextCursor?: string;
  hasMore: boolean;
}
```

Add to `MessengerAdapter` interface body (optional method):

```typescript
  /** Fetch message history from a chat with pagination. Returns messages oldest-first. */
  getMessages?(
    externalChatId: string,
    limit: number,
    cursor?: string,
  ): Promise<GetMessagesResult>;
```

- [ ] **Step 2: Commit**

```bash
git add apps/worker/src/integrations/base.ts
git commit -m "feat: add paginated getMessages to MessengerAdapter interface"
```

---

### Task 3: Update Telegram adapter — paginated getMessages

**Files:**
- Modify: `apps/worker/src/integrations/telegram.ts` (lines ~305-334)

- [ ] **Step 1: Update getMessages to support cursor-based pagination**

Replace the existing `getMessages` method (lines ~305-334) with:

```typescript
async getMessages(
  externalChatId: string,
  limit = 100,
  cursor?: string,
): Promise<GetMessagesResult> {
  this.ensureConnected();

  try {
    const peer = await this.resolvePeer(externalChatId);
    const params: Record<string, unknown> = { limit };

    // cursor is the offsetId (oldest message ID from previous batch)
    if (cursor) {
      params.offsetId = parseInt(cursor, 10);
    }

    const rawMessages = await this.client!.getMessages(peer, params);

    const messages: HistoryMessage[] = rawMessages
      .filter((m) => m.id !== undefined)
      .map((m) => ({
        id: m.id.toString(),
        text: m.text || '',
        senderId: m.senderId ? m.senderId.toString() : '',
        date: new Date((m.date ?? 0) * 1000),
        isSelf: m.out ?? false,
      }))
      .reverse(); // oldest first

    // Determine next cursor: the oldest message ID in this batch
    const oldestId = rawMessages.length > 0
      ? Math.min(...rawMessages.filter((m) => m.id !== undefined).map((m) => m.id))
      : undefined;

    return {
      messages,
      nextCursor: oldestId !== undefined ? oldestId.toString() : undefined,
      hasMore: rawMessages.length >= limit,
    };
  } catch (err) {
    throw new MessengerError('telegram', err, 'Failed to get Telegram messages');
  }
}
```

Add import at top of file:

```typescript
import type { HistoryMessage, GetMessagesResult } from './base.js';
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/integrations/telegram.ts
git commit -m "feat: update Telegram getMessages with cursor pagination"
```

---

### Task 4: Implement Slack adapter — getMessages

**Files:**
- Modify: `apps/worker/src/integrations/slack.ts`

- [ ] **Step 1: Add getMessages method**

Add import at top:

```typescript
import type { HistoryMessage, GetMessagesResult } from './base.js';
```

Add method to `SlackAdapter` class (after `sendMessage`):

```typescript
async getMessages(
  externalChatId: string,
  limit = 200,
  cursor?: string,
): Promise<GetMessagesResult> {
  this.ensureConnected();

  try {
    const params: Record<string, unknown> = {
      channel: externalChatId,
      limit,
    };
    if (cursor) {
      params.cursor = cursor;
    }

    const result = await this.client!.conversations.history(params);

    const messages: HistoryMessage[] = (result.messages ?? [])
      .filter((m) => m.ts && m.type === 'message')
      .map((m) => ({
        id: m.ts!,
        text: m.text ?? '',
        senderId: m.user ?? m.bot_id ?? '',
        date: new Date(parseFloat(m.ts!) * 1000),
        isSelf: false, // Will be determined by comparing with bot/user ID
      }))
      .reverse(); // oldest first

    const nextCursor = result.response_metadata?.next_cursor || undefined;

    return {
      messages,
      nextCursor: nextCursor && nextCursor.length > 0 ? nextCursor : undefined,
      hasMore: result.has_more ?? false,
    };
  } catch (err) {
    this.handleSlackError(err);
    throw new MessengerError('slack', err, 'Failed to get Slack messages');
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/integrations/slack.ts
git commit -m "feat: implement Slack getMessages with cursor pagination"
```

---

### Task 5: Implement WhatsApp adapter — getMessages

**Files:**
- Modify: `apps/worker/src/integrations/whatsapp.ts`

- [ ] **Step 1: Add getMessages method**

Add import at top:

```typescript
import type { HistoryMessage, GetMessagesResult } from './base.js';
```

Add method to `WhatsAppAdapter` class (after `sendMessage`):

```typescript
async getMessages(
  externalChatId: string,
  limit = 100,
  cursor?: string,
): Promise<GetMessagesResult> {
  this.ensureConnected();

  try {
    const jid = this.normalizeJid(externalChatId);

    // Baileys uses message key for cursor-based pagination
    const cursorMsg = cursor ? JSON.parse(cursor) : undefined;
    const messages = await this.sock!.fetchMessageHistory(
      limit,
      jid,
      cursorMsg,
    );

    if (!messages || messages.length === 0) {
      return { messages: [], hasMore: false };
    }

    const historyMessages: HistoryMessage[] = messages
      .filter((m) => m.message)
      .map((m) => {
        const text =
          m.message?.conversation ??
          m.message?.extendedTextMessage?.text ??
          m.message?.imageMessage?.caption ??
          m.message?.videoMessage?.caption ??
          m.message?.documentMessage?.fileName ??
          '';

        return {
          id: m.key.id ?? `wa_${Date.now()}_${Math.random()}`,
          text,
          senderId: m.key.participant ?? m.key.remoteJid ?? '',
          date: new Date((m.messageTimestamp as number) * 1000),
          isSelf: m.key.fromMe ?? false,
        };
      })
      .reverse(); // oldest first

    // Use the oldest message key as cursor for next batch
    const oldestMsg = messages[messages.length - 1];
    const nextCursorKey = oldestMsg?.key ? JSON.stringify(oldestMsg.key) : undefined;

    return {
      messages: historyMessages,
      nextCursor: nextCursorKey,
      hasMore: messages.length >= limit,
    };
  } catch (err) {
    // WhatsApp history may not be available — treat as empty, not error
    if (String(err).includes('not available') || String(err).includes('Bad Request')) {
      return { messages: [], hasMore: false };
    }
    throw new MessengerError('whatsapp', err, 'Failed to get WhatsApp messages');
  }
}
```

**Note:** Baileys `fetchMessageHistory` availability depends on the WhatsApp protocol version and device state. If the method doesn't exist on the socket, wrap with a check:

```typescript
if (typeof this.sock!.fetchMessageHistory !== 'function') {
  return { messages: [], hasMore: false };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/integrations/whatsapp.ts
git commit -m "feat: implement WhatsApp getMessages with cursor pagination"
```

---

### Task 6: Implement Gmail adapter — getMessages

**Files:**
- Modify: `apps/worker/src/integrations/gmail.ts`

- [ ] **Step 1: Add getMessages method**

Add import at top:

```typescript
import type { HistoryMessage, GetMessagesResult } from './base.js';
```

Add method to `GmailAdapter` class (after `sendMessage`):

```typescript
async getMessages(
  externalChatId: string,
  limit = 50,
  cursor?: string,
): Promise<GetMessagesResult> {
  this.ensureConnected();

  try {
    // For Gmail, externalChatId is a thread ID
    // List messages in this thread
    const params: Record<string, unknown> = {
      userId: 'me',
      q: `in:anywhere`,
      maxResults: limit,
    };
    if (cursor) {
      params.pageToken = cursor;
    }

    const listResult = await this.gmail!.users.messages.list(params as Parameters<typeof this.gmail.users.messages.list>[0]);

    const messageIds = listResult.data.messages ?? [];
    if (messageIds.length === 0) {
      return { messages: [], hasMore: false };
    }

    // Fetch each message's content
    const historyMessages: HistoryMessage[] = [];

    for (const msgRef of messageIds) {
      if (!msgRef.id) continue;

      try {
        const msg = await this.gmail!.users.messages.get({
          userId: 'me',
          id: msgRef.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date'],
        });

        const headers = msg.data.payload?.headers ?? [];
        const from = headers.find((h) => h.name === 'From')?.value ?? '';
        const subject = headers.find((h) => h.name === 'Subject')?.value ?? '';
        const dateStr = headers.find((h) => h.name === 'Date')?.value ?? '';
        const snippet = msg.data.snippet ?? '';

        historyMessages.push({
          id: msgRef.id,
          text: snippet || subject,
          senderId: from,
          senderName: from.replace(/<.*>/, '').trim(),
          date: dateStr ? new Date(dateStr) : new Date(),
          isSelf: msg.data.labelIds?.includes('SENT') ?? false,
        });
      } catch {
        // Skip individual message fetch errors
        continue;
      }
    }

    return {
      messages: historyMessages.reverse(), // oldest first
      nextCursor: listResult.data.nextPageToken ?? undefined,
      hasMore: !!listResult.data.nextPageToken,
    };
  } catch (err) {
    this.handleGmailError(err);
    throw new MessengerError('gmail', err, 'Failed to get Gmail messages');
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/integrations/gmail.ts
git commit -m "feat: implement Gmail getMessages with page token pagination"
```

---

### Task 7: Rewrite worker processChatHistorySync with full pagination loop

**Files:**
- Modify: `apps/worker/src/index.ts` (lines ~510-657 and ~757-798)

- [ ] **Step 1: Rewrite processChatHistorySync function**

Replace the entire `processChatHistorySync` function (lines 510-657) with:

```typescript
async function processChatHistorySync(job: Job<MessageSyncPayload>): Promise<void> {
  const { chatIds, integrationId, organizationId, messenger } = job.data;
  log.info('Processing sync:chat-history', { integrationId, chatCount: chatIds.length });

  // Load integration credentials
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { credentials: true, messenger: true },
  });

  if (!integration) {
    log.warn('Integration not found, skipping history sync', { integrationId });
    return;
  }

  const credentials = decryptCredentials<Record<string, unknown>>(integration.credentials as string);
  const adapter = await createAdapter(messenger, credentials);

  try {
    await adapter.connect();
  } catch (err) {
    log.error('Failed to connect adapter for history sync', { error: String(err) });
    // Mark all chats as failed
    await prisma.chat.updateMany({
      where: { id: { in: chatIds } },
      data: { syncStatus: 'failed' },
    });
    return;
  }

  // Check if adapter supports getMessages
  if (!adapter.getMessages) {
    log.info(`Adapter for ${messenger} does not support history fetch, marking as synced`);
    await prisma.chat.updateMany({
      where: { id: { in: chatIds } },
      data: { syncStatus: 'synced' },
    });
    try { await adapter.disconnect(); } catch {}
    return;
  }

  for (const chatId of chatIds) {
    try {
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { id: true, externalChatId: true, syncCursor: true, syncStatus: true },
      });

      if (!chat) continue;

      // Skip already synced chats
      if (chat.syncStatus === 'synced') continue;

      // Mark as syncing
      await prisma.chat.update({
        where: { id: chat.id },
        data: { syncStatus: 'syncing' },
      });

      log.info(`Syncing full history for chat ${chat.externalChatId}`, { chatId });

      let cursor = chat.syncCursor ?? undefined;
      let totalSynced = 0;
      let batchNumber = 0;

      // Pagination loop — fetch all history
      while (true) {
        batchNumber++;
        let result;

        try {
          result = await adapter.getMessages!(chat.externalChatId, 100, cursor);
        } catch (err) {
          const errMsg = String(err);
          if (errMsg.includes('FloodWait') || errMsg.includes('FLOOD_WAIT')) {
            const waitMatch = errMsg.match(/(\d+)/);
            const waitSeconds = waitMatch ? parseInt(waitMatch[1]!, 10) : 30;
            log.warn(`FloodWait: waiting ${waitSeconds}s`, { chatId, batch: batchNumber });
            await sleep(Math.min(waitSeconds, 120));
            continue; // retry same cursor
          }
          log.error(`Failed to fetch batch ${batchNumber} for chat ${chatId}`, { error: errMsg });
          break; // stop pagination for this chat
        }

        if (result.messages.length === 0) {
          log.info(`No more messages in batch ${batchNumber}`, { chatId });
          break;
        }

        // Bulk insert with deduplication
        await prisma.message.createMany({
          data: result.messages.map((m) => ({
            chatId: chat.id,
            externalMessageId: m.id,
            senderName: m.senderName ?? 'Unknown',
            senderExternalId: m.senderId,
            isSelf: m.isSelf,
            text: m.text,
            createdAt: m.date,
          })),
          skipDuplicates: true,
        });

        totalSynced += result.messages.length;

        // Save cursor for resume capability
        await prisma.chat.update({
          where: { id: chat.id },
          data: { syncCursor: result.nextCursor ?? null },
        });

        // Notify frontend every batch
        pubClient.publish('ws:events', JSON.stringify({
          event: 'chat_updated',
          room: `org:${organizationId}`,
          data: { chatId: chat.id },
        })).catch(() => {});

        log.info(`Batch ${batchNumber}: synced ${result.messages.length} messages (total: ${totalSynced})`, { chatId });

        // Check if we've exhausted history
        if (!result.hasMore || !result.nextCursor) {
          break;
        }

        cursor = result.nextCursor;

        // Small delay between batches to avoid rate limiting
        await sleep(1);
      }

      // Update chat metadata
      const totalMessages = await prisma.message.count({ where: { chatId: chat.id } });
      const latestMessage = await prisma.message.findFirst({
        where: { chatId: chat.id },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      await prisma.chat.update({
        where: { id: chat.id },
        data: {
          syncStatus: 'synced',
          syncCursor: null,
          messageCount: totalMessages,
          lastActivityAt: latestMessage?.createdAt ?? new Date(),
        },
      });

      // Final frontend notification
      pubClient.publish('ws:events', JSON.stringify({
        event: 'chat_updated',
        room: `org:${organizationId}`,
        data: { chatId: chat.id },
      })).catch(() => {});

      log.info(`History sync complete for chat ${chatId}: ${totalSynced} messages synced`);
    } catch (err) {
      log.error(`Error syncing chat ${chatId}`, { error: String(err) });
      await prisma.chat.update({
        where: { id: chatId },
        data: { syncStatus: 'failed' },
      }).catch(() => {});
    }
  }

  // Disconnect adapter
  try {
    await adapter.disconnect();
  } catch {}

  log.info('Chat history sync job complete', { chatCount: chatIds.length });
}
```

- [ ] **Step 2: Add startup recovery for pending chat syncs**

After the existing `recoverOverdueScheduledBroadcasts` function (line ~791), add:

```typescript
async function recoverPendingChatSyncs(): Promise<void> {
  try {
    const messageSyncQueue = new Queue('message-sync', { connection });

    // Find all chats that need syncing (grouped by org + messenger)
    const pendingChats = await prisma.chat.findMany({
      where: {
        syncStatus: { in: ['pending', 'syncing', 'failed'] },
        deletedAt: null,
      },
      select: { id: true, organizationId: true, messenger: true },
    });

    if (pendingChats.length === 0) {
      await messageSyncQueue.close();
      return;
    }

    log.info(`Recovering ${pendingChats.length} chat(s) needing history sync`);

    // Group by org + messenger to find matching integrations
    const groups = new Map<string, { orgId: string; messenger: string; chatIds: string[] }>();
    for (const chat of pendingChats) {
      const key = `${chat.organizationId}:${chat.messenger}`;
      if (!groups.has(key)) {
        groups.set(key, { orgId: chat.organizationId, messenger: chat.messenger, chatIds: [] });
      }
      groups.get(key)!.chatIds.push(chat.id);
    }

    for (const [, group] of groups) {
      // Find the connected integration for this org + messenger
      const integration = await prisma.integration.findFirst({
        where: {
          organizationId: group.orgId,
          messenger: group.messenger,
          status: 'connected',
        },
        select: { id: true },
      });

      if (!integration) {
        log.warn(`No connected integration for ${group.messenger} in org ${group.orgId}, skipping sync`);
        continue;
      }

      const jobId = `sync-recovery-${group.orgId}-${group.messenger}-${Date.now()}`;
      await messageSyncQueue.add(
        'sync:chat-history',
        {
          chatIds: group.chatIds,
          integrationId: integration.id,
          organizationId: group.orgId,
          messenger: group.messenger,
        },
        { jobId },
      );
      log.info(`Queued history sync for ${group.chatIds.length} ${group.messenger} chats in org ${group.orgId}`);
    }

    await messageSyncQueue.close();
  } catch (err) {
    log.error('Failed to recover pending chat syncs', { error: String(err) });
  }
}
```

Update the startup setTimeout block to also call the new function:

```typescript
setTimeout(() => {
  recoverOverdueScheduledBroadcasts().catch((err) => {
    log.error('Startup recovery error', { error: String(err) });
  });
  recoverPendingChatSyncs().catch((err) => {
    log.error('Chat sync recovery error', { error: String(err) });
  });
}, 5000);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd apps/worker && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/index.ts
git commit -m "feat: rewrite chat history sync with full pagination and startup recovery"
```

---

### Task 8: Return syncStatus from chat API endpoints

**Files:**
- Modify: `apps/api/src/routes/chats.ts`

- [ ] **Step 1: Include syncStatus in chat list and detail responses**

In the GET /chats list endpoint (lines ~92-196), find where chat fields are mapped in the response and add `syncStatus` to the returned object.

In the GET /chats/:id detail endpoint (lines ~281-352), add `syncStatus` to the response.

Search for the pattern where `id: chat.id` is used in the response mapping and add `syncStatus: chat.syncStatus` alongside the other fields.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/api && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/chats.ts
git commit -m "feat: return syncStatus in chat API responses"
```

---

### Task 9: Show sync indicator on chat list UI

**Files:**
- Modify: `apps/web/src/components/messenger/ChatList.tsx` (ChatItem component, lines ~45-197)

- [ ] **Step 1: Add sync indicator to ChatItem**

Add `Loader2` to the lucide-react import at the top of the file.

In the `ChatItem` component, after the messenger dot indicator (around line 100), add a sync status indicator:

```tsx
{/* Sync indicator */}
{chat.syncStatus && chat.syncStatus !== 'synced' && (
  <span className="absolute -top-0.5 -left-0.5">
    <Loader2 className="h-3 w-3 animate-spin text-accent" />
  </span>
)}
```

Also, in the chat name area (around line 112), add a subtle "Syncing..." text when syncing:

```tsx
{chat.syncStatus === 'syncing' && (
  <span className="ml-1 text-[10px] text-accent">Syncing...</span>
)}
```

- [ ] **Step 2: Update Chat type if needed**

Check `apps/web/src/types/chat.ts` — ensure the `Chat` interface includes `syncStatus?: string`. If not, add it.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/messenger/ChatList.tsx apps/web/src/types/chat.ts
git commit -m "feat: show sync status indicator on chat list items"
```

---

### Task 10: Final integration test and deploy

- [ ] **Step 1: Run full TypeScript check across all apps**

```bash
cd apps/api && npx tsc --noEmit
cd apps/worker && npx tsc --noEmit
cd apps/web && npx tsc --noEmit -p tsconfig.json
```

- [ ] **Step 2: Create final commit with all changes**

```bash
git add -A
git commit -m "feat: full chat history sync across all messengers

- Add syncStatus/syncCursor to Chat model with migration
- Implement paginated getMessages for Telegram, Slack, WhatsApp, Gmail
- Rewrite worker history sync with pagination loop and resume capability
- Add startup recovery for pending/failed chat syncs
- Show sync indicator in chat list UI"
```

- [ ] **Step 3: Deploy**

```bash
# Frontend
cd apps/web && npx netlify deploy --prod

# API + Worker
cd apps/api && railway up
cd apps/worker && railway up
```
