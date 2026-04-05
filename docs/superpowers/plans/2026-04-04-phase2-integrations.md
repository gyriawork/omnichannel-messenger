# Phase 2: Integrations — Complete All 4 Messenger Adapters

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all 4 messenger adapters (Telegram, Slack, WhatsApp, Gmail) so that chats can be imported, messages sent/received/edited/deleted, and webhooks processed for each messenger.

**Architecture:** Each adapter implements `MessengerAdapter` interface (`apps/api/src/integrations/base.ts`). Factory pattern in `factory.ts` routes to correct adapter. Webhook handlers in `apps/api/src/routes/webhooks.ts` process incoming messages.

**Tech Stack:** gramjs (Telegram), @slack/web-api + Events API (Slack), @whiskeysockets/baileys (WhatsApp), googleapis (Gmail)

**Spec Reference:** `docs/superpowers/specs/2026-04-04-user-stories-design.md` — Epics 4, 6

**Dependencies:** Phase 1 (WebSocket events must be wired)

---

## Adapter Interface (Reference)

All adapters implement `MessengerAdapter` from `apps/api/src/integrations/base.ts`:

```typescript
interface MessengerAdapter {
  connect(credentials?: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>>;
  sendMessage(externalChatId: string, text: string, options?: { replyToExternalId?: string; attachments?: Array<{ url: string; filename: string; mimeType: string }> }): Promise<{ externalMessageId: string }>;
  editMessage(externalChatId: string, externalMessageId: string, newText: string): Promise<void>;
  deleteMessage(externalChatId: string, externalMessageId: string): Promise<void>;
  getStatus(): 'connected' | 'disconnected' | 'token_expired' | 'session_expired';
}
```

---

## Task 1: Telegram Adapter — Complete Missing Methods

**Files:**
- Modify: `apps/api/src/integrations/telegram.ts` (currently 424 lines, 50% complete)

Status: `connect()`, `sendMessage()`, `editMessage()`, `deleteMessage()`, `listChats()`, `getMessages()` exist. Missing: webhook receiver, attachment handling fixes.

- [ ] **Step 1: Read current telegram.ts to understand what exists**

- [ ] **Step 2: Add incoming message polling/handler**

Telegram requires either long-polling via gramjs or a webhook via Bot API. Since we're using gramjs (MTProto), we need event handlers:

```typescript
// Add to TelegramAdapter class:
async subscribeToMessages(onMessage: (msg: IncomingMessage) => void): Promise<void> {
  if (!this.client) throw new MessengerError('telegram', null, 'Not connected');

  const { NewMessage } = await import('telegram/events/index.js');

  this.client.addEventHandler((event) => {
    const message = event.message;
    if (!message) return;

    onMessage({
      externalMessageId: String(message.id),
      externalChatId: String(message.chatId ?? message.peerId),
      senderName: '', // Resolved by caller
      senderExternalId: String(message.senderId ?? ''),
      text: message.text ?? '',
      isSelf: message.out ?? false,
      createdAt: new Date(message.date * 1000),
    });
  }, new NewMessage({}));
}
```

- [ ] **Step 3: Improve error handling for 48h edit window**

In `editMessage()`, catch Telegram API error for old messages:

```typescript
async editMessage(externalChatId: string, externalMessageId: string, newText: string): Promise<void> {
  try {
    await this.client!.invoke(/* existing editMessage logic */);
  } catch (err) {
    const errStr = String(err);
    if (errStr.includes('MESSAGE_EDIT_TIME_EXPIRED') || errStr.includes('message is too old')) {
      throw new MessengerError('telegram', err, 'Message too old to edit (48-hour limit)');
    }
    throw new MessengerError('telegram', err, 'Failed to edit message');
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/integrations/telegram.ts
git commit -m "feat: complete Telegram adapter with incoming messages and edit time validation"
```

---

## Task 2: Slack Adapter — Full Implementation

**Files:**
- Modify: `apps/api/src/integrations/slack.ts`

Status: 40% — WebClient initialized, OAuth credentials handled. Missing: all message operations.

- [ ] **Step 1: Read current slack.ts**

- [ ] **Step 2: Implement full SlackAdapter**

```typescript
import { WebClient } from '@slack/web-api';
import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

export class SlackAdapter implements MessengerAdapter {
  private client: WebClient | null = null;
  private token: string;
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';

  constructor(credentials: { token: string }) {
    this.token = credentials.token;
  }

  async connect(): Promise<void> {
    try {
      this.client = new WebClient(this.token);
      // Verify token by calling auth.test
      await this.client.auth.test();
      this.status = 'connected';
    } catch (err) {
      const errStr = String(err);
      if (errStr.includes('invalid_auth') || errStr.includes('token_revoked')) {
        this.status = 'token_expired';
      }
      throw new MessengerError('slack', err, 'Failed to connect to Slack');
    }
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.status = 'disconnected';
  }

  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    if (!this.client) throw new MessengerError('slack', null, 'Not connected');

    const chats: Array<{ externalChatId: string; name: string; chatType: string }> = [];

    // Fetch channels
    let cursor: string | undefined;
    do {
      const result = await this.client.conversations.list({
        types: 'public_channel,private_channel,mpim,im',
        limit: 200,
        cursor,
      });

      for (const channel of result.channels ?? []) {
        chats.push({
          externalChatId: channel.id!,
          name: channel.name ?? channel.id ?? 'Unknown',
          chatType: channel.is_im ? 'direct' : channel.is_mpim ? 'group' : 'channel',
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    return chats;
  }

  async sendMessage(
    externalChatId: string,
    text: string,
    options?: { replyToExternalId?: string; attachments?: Array<{ url: string; filename: string; mimeType: string }> },
  ): Promise<{ externalMessageId: string }> {
    if (!this.client) throw new MessengerError('slack', null, 'Not connected');

    try {
      const result = await this.client.chat.postMessage({
        channel: externalChatId,
        text,
        thread_ts: options?.replyToExternalId, // Threaded reply
      });

      return { externalMessageId: result.ts! };
    } catch (err) {
      throw new MessengerError('slack', err, 'Failed to send Slack message');
    }
  }

  async editMessage(externalChatId: string, externalMessageId: string, newText: string): Promise<void> {
    if (!this.client) throw new MessengerError('slack', null, 'Not connected');

    try {
      await this.client.chat.update({
        channel: externalChatId,
        ts: externalMessageId,
        text: newText,
      });
    } catch (err) {
      throw new MessengerError('slack', err, 'Failed to edit Slack message');
    }
  }

  async deleteMessage(externalChatId: string, externalMessageId: string): Promise<void> {
    if (!this.client) throw new MessengerError('slack', null, 'Not connected');

    try {
      await this.client.chat.delete({
        channel: externalChatId,
        ts: externalMessageId,
      });
    } catch (err) {
      throw new MessengerError('slack', err, 'Failed to delete Slack message');
    }
  }

  getStatus() { return this.status; }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/integrations/slack.ts
git commit -m "feat: complete Slack adapter with send, edit, delete, listChats"
```

---

## Task 3: Slack Webhook Handler

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`

Slack sends events via HTTP POST to our webhook URL. Need to handle `message` events.

- [ ] **Step 1: Read current webhooks.ts**

- [ ] **Step 2: Implement Slack event handler**

```typescript
// Inside webhooks route plugin:
fastify.post('/webhooks/slack', async (request, reply) => {
  const body = request.body as Record<string, unknown>;

  // Handle Slack URL verification challenge
  if (body.type === 'url_verification') {
    return reply.send({ challenge: body.challenge });
  }

  // Verify Slack signing secret
  // TODO: Implement signature verification with SLACK_SIGNING_SECRET

  if (body.type === 'event_callback') {
    const event = body.event as Record<string, unknown>;

    if (event.type === 'message' && !event.subtype && !event.bot_id) {
      const externalChatId = event.channel as string;
      const text = event.text as string;
      const senderExternalId = event.user as string;
      const externalMessageId = event.ts as string;
      const threadTs = event.thread_ts as string | undefined;

      // Find chat in our DB
      const chat = await prisma.chat.findFirst({
        where: { externalChatId, messenger: 'slack' },
        select: { id: true, organizationId: true },
      });

      if (chat) {
        // Create message record
        const message = await prisma.message.create({
          data: {
            chatId: chat.id,
            externalMessageId,
            senderName: senderExternalId, // Resolve name later
            senderExternalId,
            isSelf: false,
            text: text ?? '',
            deliveryStatus: 'delivered',
          },
        });

        // Update chat activity
        await prisma.chat.update({
          where: { id: chat.id },
          data: { messageCount: { increment: 1 }, lastActivityAt: new Date() },
        });

        // Emit to WebSocket
        try {
          getIO().to(`chat:${chat.id}`).emit('new_message', { chatId: chat.id, message });
        } catch {}
      }
    }
  }

  return reply.status(200).send({ ok: true });
});
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/webhooks.ts
git commit -m "feat: implement Slack webhook handler for incoming messages"
```

---

## Task 4: WhatsApp Adapter — Full Implementation

**Files:**
- Modify: `apps/api/src/integrations/whatsapp.ts`

Status: 30% — Baileys installed, session management structure exists.

- [ ] **Step 1: Read current whatsapp.ts**

- [ ] **Step 2: Implement WhatsAppAdapter with Baileys**

Key implementation points:
- `connect()`: Initialize Baileys socket, restore session from encrypted credentials
- `listChats()`: Fetch groups and DMs from Baileys store
- `sendMessage()`: Use `sock.sendMessage(jid, { text })` with reply support
- `editMessage()`: Use `sock.sendMessage(jid, { edit: key, text })` — 15-minute window
- `deleteMessage()`: Use `sock.sendMessage(jid, { delete: key })`
- Session persistence: serialize Baileys auth state to encrypted JSON, store in Integration.credentials
- QR code flow: emit QR to WebSocket `user:{userId}` room for scanning

```typescript
// Core pattern for WhatsApp with Baileys:
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';

export class WhatsAppAdapter implements MessengerAdapter {
  private sock: ReturnType<typeof makeWASocket> | null = null;
  private authState: string | undefined;
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';

  constructor(credentials: { authState?: string; phoneNumber?: string }) {
    this.authState = credentials.authState;
  }

  async connect(): Promise<void> {
    // Restore or create auth state from stored credentials
    // Connect via Baileys makeWASocket
    // Handle connection events, QR code generation
    this.status = 'connected';
  }

  async sendMessage(externalChatId: string, text: string, options?: { replyToExternalId?: string }): Promise<{ externalMessageId: string }> {
    if (!this.sock) throw new MessengerError('whatsapp', null, 'Not connected');

    const msg = await this.sock.sendMessage(externalChatId, {
      text,
    }, options?.replyToExternalId ? {
      quoted: { key: { id: options.replyToExternalId, remoteJid: externalChatId } } as any,
    } : undefined);

    return { externalMessageId: msg!.key.id! };
  }

  async editMessage(externalChatId: string, externalMessageId: string, newText: string): Promise<void> {
    if (!this.sock) throw new MessengerError('whatsapp', null, 'Not connected');

    // WhatsApp 15-minute edit window
    await this.sock.sendMessage(externalChatId, {
      text: newText,
      edit: { remoteJid: externalChatId, id: externalMessageId, participant: undefined } as any,
    });
  }

  async deleteMessage(externalChatId: string, externalMessageId: string): Promise<void> {
    if (!this.sock) throw new MessengerError('whatsapp', null, 'Not connected');

    await this.sock.sendMessage(externalChatId, {
      delete: { remoteJid: externalChatId, id: externalMessageId, participant: undefined } as any,
    });
  }

  // ... listChats, disconnect, getStatus
}
```

- [ ] **Step 3: Add WhatsApp incoming message handler in connect()**

Baileys emits events via `sock.ev.on('messages.upsert', ...)`. Hook this to save incoming messages to DB and emit WebSocket events.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/integrations/whatsapp.ts
git commit -m "feat: complete WhatsApp adapter with Baileys (send, edit, delete, receive)"
```

---

## Task 5: Gmail Adapter — Full Implementation

**Files:**
- Modify: `apps/api/src/integrations/gmail.ts`

Status: 20% — googleapis installed but barely integrated.

- [ ] **Step 1: Read current gmail.ts**

- [ ] **Step 2: Implement GmailAdapter**

```typescript
import { google, gmail_v1 } from 'googleapis';
import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

export class GmailAdapter implements MessengerAdapter {
  private gmail: gmail_v1.Gmail | null = null;
  private clientId: string;
  private clientSecret: string;
  private refreshToken: string;
  private status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';

  constructor(credentials: { clientId: string; clientSecret: string; refreshToken: string }) {
    this.clientId = credentials.clientId;
    this.clientSecret = credentials.clientSecret;
    this.refreshToken = credentials.refreshToken;
  }

  async connect(): Promise<void> {
    try {
      const oauth2Client = new google.auth.OAuth2(this.clientId, this.clientSecret);
      oauth2Client.setCredentials({ refresh_token: this.refreshToken });

      this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });

      // Verify connection
      await this.gmail.users.getProfile({ userId: 'me' });
      this.status = 'connected';
    } catch (err) {
      this.status = 'token_expired';
      throw new MessengerError('gmail', err, 'Failed to connect to Gmail');
    }
  }

  async disconnect(): Promise<void> {
    this.gmail = null;
    this.status = 'disconnected';
  }

  async listChats(): Promise<Array<{ externalChatId: string; name: string; chatType: string }>> {
    if (!this.gmail) throw new MessengerError('gmail', null, 'Not connected');

    // List threads as "chats"
    const response = await this.gmail.users.threads.list({
      userId: 'me',
      maxResults: 100,
    });

    const chats: Array<{ externalChatId: string; name: string; chatType: string }> = [];

    for (const thread of response.data.threads ?? []) {
      // Get thread details for subject
      const detail = await this.gmail.users.threads.get({
        userId: 'me',
        id: thread.id!,
        format: 'metadata',
        metadataHeaders: ['Subject', 'From'],
      });

      const headers = detail.data.messages?.[0]?.payload?.headers ?? [];
      const subject = headers.find((h) => h.name === 'Subject')?.value ?? 'No Subject';
      const from = headers.find((h) => h.name === 'From')?.value ?? 'Unknown';

      chats.push({
        externalChatId: thread.id!,
        name: `${subject} (${from})`,
        chatType: 'direct',
      });
    }

    return chats;
  }

  async sendMessage(
    externalChatId: string,
    text: string,
    options?: { replyToExternalId?: string },
  ): Promise<{ externalMessageId: string }> {
    if (!this.gmail) throw new MessengerError('gmail', null, 'Not connected');

    // Get thread to find recipients and subject
    const thread = await this.gmail.users.threads.get({
      userId: 'me',
      id: externalChatId,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Message-ID'],
    });

    const lastMessage = thread.data.messages?.slice(-1)[0];
    const headers = lastMessage?.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === 'Subject')?.value ?? '';
    const to = headers.find((h) => h.name === 'From')?.value ?? '';
    const messageId = headers.find((h) => h.name === 'Message-ID')?.value;

    // Build RFC 2822 email
    const emailLines = [
      `To: ${to}`,
      `Subject: Re: ${subject.replace(/^Re:\s*/i, '')}`,
      `In-Reply-To: ${messageId ?? ''}`,
      `References: ${messageId ?? ''}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      text,
    ];

    const raw = Buffer.from(emailLines.join('\r\n')).toString('base64url');

    const result = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw,
        threadId: externalChatId,
      },
    });

    return { externalMessageId: result.data.id! };
  }

  async editMessage(): Promise<void> {
    throw new MessengerError('gmail', null, 'Edit not supported for Gmail');
  }

  async deleteMessage(): Promise<void> {
    throw new MessengerError('gmail', null, 'Delete not supported for Gmail');
  }

  getStatus() { return this.status; }
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/integrations/gmail.ts
git commit -m "feat: complete Gmail adapter with send, listChats (threads), and status"
```

---

## Task 6: Gmail Webhook — Push Notifications

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`
- Modify: `apps/api/src/routes/oauth.ts` (set up Gmail watch)

Gmail uses Cloud Pub/Sub for push notifications. On new email, Google posts to our webhook.

- [ ] **Step 1: Implement Gmail webhook handler**

```typescript
fastify.post('/webhooks/gmail', async (request, reply) => {
  const body = request.body as { message?: { data?: string } };

  if (!body.message?.data) {
    return reply.status(200).send({ ok: true });
  }

  // Decode base64 notification
  const decoded = JSON.parse(Buffer.from(body.message.data, 'base64').toString());
  const { emailAddress, historyId } = decoded;

  // Find integration by email
  // Process new messages via Gmail API history.list
  // Save to DB + emit WebSocket events

  return reply.status(200).send({ ok: true });
});
```

- [ ] **Step 2: Add Gmail watch setup in OAuth callback**

After successful Gmail OAuth, call `gmail.users.watch()` to register push notifications.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/webhooks.ts apps/api/src/routes/oauth.ts
git commit -m "feat: implement Gmail push notification webhook and watch setup"
```

---

## Task 7: Telegram Webhook Handler Completion

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`

- [ ] **Step 1: Read current Telegram webhook handler**

- [ ] **Step 2: Complete incoming message processing**

When Telegram sends updates (via gramjs event handler or webhook), save message to DB, update chat, emit WebSocket.

Pattern (same as Slack handler in Task 3):
1. Find chat by `externalChatId` + `messenger=telegram`
2. Create message record
3. Update chat `messageCount` and `lastActivityAt`
4. Emit `new_message` via WebSocket

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/webhooks.ts
git commit -m "feat: complete Telegram webhook handler for incoming messages"
```

---

## Task 8: WhatsApp Webhook Handler

**Files:**
- Modify: `apps/api/src/routes/webhooks.ts`

WhatsApp with Baileys handles incoming messages via the socket event handler (inside `connect()`), not via HTTP webhooks. However, we need a way to bridge Baileys events to our API's message storage.

- [ ] **Step 1: Create message ingestion helper**

```typescript
// apps/api/src/integrations/message-ingestion.ts
import prisma from '../lib/prisma.js';
import { getIO } from '../websocket/index.js';

export async function ingestIncomingMessage(params: {
  externalChatId: string;
  messenger: string;
  externalMessageId: string;
  senderName: string;
  senderExternalId: string;
  text: string;
  createdAt: Date;
}): Promise<void> {
  const chat = await prisma.chat.findFirst({
    where: { externalChatId: params.externalChatId, messenger: params.messenger },
    select: { id: true, organizationId: true },
  });

  if (!chat) return; // Chat not imported, ignore

  // Dedup check
  const existing = await prisma.message.findFirst({
    where: { chatId: chat.id, externalMessageId: params.externalMessageId },
  });
  if (existing) return;

  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      externalMessageId: params.externalMessageId,
      senderName: params.senderName,
      senderExternalId: params.senderExternalId,
      isSelf: false,
      text: params.text,
      deliveryStatus: 'delivered',
      createdAt: params.createdAt,
    },
  });

  await prisma.chat.update({
    where: { id: chat.id },
    data: { messageCount: { increment: 1 }, lastActivityAt: new Date() },
  });

  try {
    getIO().to(`chat:${chat.id}`).emit('new_message', { chatId: chat.id, message });
    getIO().to(`org:${chat.organizationId}`).emit('chat_updated', { chatId: chat.id });
  } catch {}
}
```

- [ ] **Step 2: Use ingestion helper in WhatsApp adapter's connect()**

Call `ingestIncomingMessage()` from Baileys `messages.upsert` event handler.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/integrations/message-ingestion.ts apps/api/src/integrations/whatsapp.ts
git commit -m "feat: create message ingestion helper and wire WhatsApp incoming messages"
```

---

## Task 9: OAuth Flow Completion

**Files:**
- Modify: `apps/api/src/routes/oauth.ts`
- Modify: `apps/web/src/components/settings/IntegrationsTab.tsx`

- [ ] **Step 1: Read current oauth.ts**

- [ ] **Step 2: Complete OAuth callbacks for Slack and Gmail**

Each OAuth callback should:
1. Exchange code for tokens
2. Encrypt tokens via `encryptCredentials()`
3. Upsert Integration record with status `connected`
4. Log activity `integration_connected`
5. Redirect back to settings page

- [ ] **Step 3: Wire frontend IntegrationsTab to start OAuth flows**

Each card's "Connect" button should call `POST /api/integrations/:type/oauth/start` and redirect to the returned URL.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/oauth.ts apps/web/src/components/settings/IntegrationsTab.tsx
git commit -m "feat: complete OAuth flows for Slack and Gmail integrations"
```

---

## Verification

1. **Telegram:** Connect via API credentials → import chats → send message → verify delivery
2. **Slack:** Connect via OAuth → import channels → send message → verify in Slack
3. **WhatsApp:** Connect via QR → import groups → send message → verify on phone
4. **Gmail:** Connect via OAuth → import threads → send reply → verify in Gmail
5. **Incoming messages:** Send a message from each messenger → verify it appears in our UI via WebSocket
6. **Broadcasts:** Create broadcast targeting all 4 messengers → verify sequential delivery with antiban delays

```bash
# Test adapter factory
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/integrations/telegram/status
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/integrations/slack/status
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/integrations/whatsapp/status
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/integrations/gmail/status
```
