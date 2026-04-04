# Chat History Sync — Design Spec

**Date:** 2026-04-04
**Status:** Approved

## Problem

When users import chats, they only see messages from the moment of import. Previous conversation history is not loaded, making the messenger feel empty and losing important context.

## Solution

Automatically sync full message history for all imported chats in the background. No user action required — history loads automatically for both new and existing chats.

## Architecture

### Flow

1. User imports chat → Chat record created with `syncStatus = 'pending'`
2. Worker picks up `sync:chat-history` job (already exists, triggered on import)
3. Worker loads history in batches (100-200 messages), newest first
4. After each batch: messages saved to DB, Redis pub/sub notifies frontend
5. Frontend shows new messages appearing in real-time
6. When complete: `syncStatus = 'synced'`

### For existing chats

- Database migration sets all existing chats to `syncStatus = 'pending'`
- Worker on startup checks for `pending` chats and queues sync jobs
- No manual button needed — everything is automatic

### Schema Change

Add to `Chat` model in `schema.prisma`:

```prisma
syncStatus String @default("pending") // pending | syncing | synced | failed
syncCursor String? // adapter-specific pagination cursor (offsetId, cursor token, etc.)
```

`syncCursor` stores the last position so sync can resume after interruption.

### Per-Messenger Implementation

#### Telegram
- **API:** `client.getMessages(peer, { limit: 100, offsetId })` (gramjs)
- **Pagination:** Use `offsetId` of oldest fetched message to get next batch
- **Rate limiting:** Respect FloodWait errors with exponential backoff
- **Termination:** Stop when API returns fewer messages than `limit`

#### Slack
- **API:** `conversations.history({ channel, limit: 200, cursor })` (WebClient)
- **Pagination:** Use `response_metadata.next_cursor` for next page
- **Rate limiting:** Slack Tier 3 — ~50 req/min, add 1.5s delay between requests
- **Termination:** Stop when `has_more === false`

#### WhatsApp
- **API:** `fetchMessageHistory(jid, count)` (baileys)
- **Limitation:** History availability depends on device — typically last ~3-6 months
- **Pagination:** Fetch in batches, use earliest message key as cursor
- **Termination:** Stop when no more messages returned

#### Gmail
- **API:** `messages.list({ q: 'in:anywhere', maxResults: 100 })` + `messages.get()` (googleapis)
- **Pagination:** Use `nextPageToken` from list response
- **Rate limiting:** Gmail API quota — 250 units/sec, add small delay
- **Termination:** Stop when no `nextPageToken` returned

### Message Deduplication

Use existing pattern: `externalMessageId` is unique per chat. `prisma.message.createMany({ skipDuplicates: true })` handles conflicts.

### Worker Job Processing

```
processChatHistorySync(job):
  1. Load chat + integration credentials
  2. Set chat.syncStatus = 'syncing'
  3. Create adapter, connect
  4. Loop:
     a. Fetch batch using adapter.getMessages(externalChatId, limit, cursor)
     b. Map to Message records, createMany with skipDuplicates
     c. Update chat.syncCursor to last position
     d. Publish 'chat_updated' via Redis pub/sub
     e. If batch < limit or no cursor → break (history exhausted)
     f. Small delay between batches (rate limiting)
  5. Set chat.syncStatus = 'synced', update messageCount
  6. On error: set syncStatus = 'failed', log error
```

### Startup Recovery

Worker startup adds a job:
```
Check all chats WHERE syncStatus IN ('pending', 'syncing', 'failed')
Queue sync:chat-history job for each
```

This ensures interrupted syncs resume automatically after deploys/restarts.

### Adapter Interface Change

Extend `MessengerAdapter` in `base.ts`:

```typescript
/** Fetch message history from a chat. Returns messages oldest-first. */
getMessages?(
  externalChatId: string,
  limit: number,
  cursor?: string,
): Promise<{
  messages: Array<{
    id: string;
    text: string;
    senderId: string;
    senderName?: string;
    date: Date;
    isSelf: boolean;
    attachments?: Array<{ url: string; filename: string; mimeType: string; size: number }>;
  }>;
  nextCursor?: string;
  hasMore: boolean;
}>;
```

Method is optional (`?`) — adapters that don't implement it skip history sync.

### Frontend

- Chat list item shows small spinner icon + "Syncing..." text when `syncStatus !== 'synced'`
- Messages appear in conversation as they load (React Query invalidation via WebSocket event)
- No new pages, modals, or buttons needed

## Files to Change

| File | Action |
|------|--------|
| `apps/api/prisma/schema.prisma` | Add `syncStatus`, `syncCursor` to Chat model |
| `apps/worker/src/integrations/base.ts` | Add `getMessages` to interface |
| `apps/worker/src/integrations/telegram.ts` | Update `getMessages` with pagination + cursor |
| `apps/worker/src/integrations/slack.ts` | Implement `getMessages` |
| `apps/worker/src/integrations/whatsapp.ts` | Implement `getMessages` |
| `apps/worker/src/integrations/gmail.ts` | Implement `getMessages` |
| `apps/worker/src/index.ts` | Update `processChatHistorySync` with loop + cursor + startup recovery |
| `apps/web/src/components/messenger/ChatListItem.tsx` | Show sync indicator |
| `apps/api/src/routes/chats.ts` | Return `syncStatus` in chat responses |

## Risk

🟡 Medium — changes adapter interface and worker processing. Each messenger has different pagination API. Core risk: rate limiting from messengers during bulk history fetch.

## Testing

1. Import a Telegram chat → verify full history loads in background
2. Import a Slack channel → verify conversations.history pagination works
3. Restart worker mid-sync → verify it resumes from cursor
4. Import chat with 1000+ messages → verify batching and no timeouts
