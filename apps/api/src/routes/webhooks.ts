import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebClient } from '@slack/web-api';
import { google } from 'googleapis';
import prisma from '../lib/prisma.js';
import { decryptCredentials } from '../lib/crypto.js';
import { saveIncomingMessage, ingestReaction } from '../services/message-service.js';
import { slackNameToEmoji } from '../integrations/slack.js';

// ─── Slack user name cache ───
// Maps `${organizationId}:${slackUserId}` → display name.
// Simple in-memory cache; entries never expire (restart clears it).
const slackUserNameCache = new Map<string, string>();

/**
 * Resolve a Slack user ID to a human-readable name.
 * Uses an in-memory cache to avoid repeated API calls.
 * Falls back to the raw user ID if the lookup fails.
 */
async function resolveSlackUserName(
  organizationId: string,
  slackUserId: string,
): Promise<string> {
  const cacheKey = `${organizationId}:${slackUserId}`;
  const cached = slackUserNameCache.get(cacheKey);
  if (cached) return cached;

  try {
    // Find a connected Slack integration for this org
    const integration = await prisma.integration.findFirst({
      where: {
        messenger: 'slack',
        organizationId,
        status: 'connected',
      },
      select: { credentials: true },
    });

    if (!integration) return slackUserId;

    const credentials = decryptCredentials<{ token: string }>(
      integration.credentials as string,
    );
    const client = new WebClient(credentials.token);
    const result = await client.users.info({ user: slackUserId });
    const name =
      result.user?.real_name || result.user?.profile?.display_name || result.user?.name || slackUserId;

    slackUserNameCache.set(cacheKey, name);
    return name;
  } catch {
    // On any failure, fall back to the raw user ID so messages still get saved
    return slackUserId;
  }
}

// ─── Webhook secret verification ───

function verifyTelegramSecret(request: FastifyRequest): boolean {
  const secret = request.headers['x-telegram-bot-api-secret-token'];
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === 'production') return false; // require in production
    return true; // skip check in dev
  }
  if (typeof secret !== 'string') return false;
  // Use timing-safe comparison to prevent timing attacks
  if (secret.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(secret, 'utf8'), Buffer.from(expected, 'utf8'));
  } catch {
    return false;
  }
}

function verifySlackRequest(request: FastifyRequest): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    if (process.env.NODE_ENV === 'production') return false;
    return true; // skip check in dev
  }

  const timestamp = request.headers['x-slack-request-timestamp'] as string;
  const slackSignature = request.headers['x-slack-signature'] as string;

  if (!timestamp || !slackSignature) return false;

  // Reject requests older than 5 minutes to prevent replay attacks
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) return false;

  // Use the actual raw body stored by the content type parser for accurate verification
  const rawBody = (request as unknown as Record<string, unknown>).rawBody as string | undefined;
  if (!rawBody) return false;
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const hmac = createHmac('sha256', signingSecret).update(sigBasestring).digest('hex');
  const computedSignature = `v0=${hmac}`;

  // Timing-safe comparison
  try {
    return timingSafeEqual(
      Buffer.from(computedSignature, 'utf8'),
      Buffer.from(slackSignature, 'utf8'),
    );
  } catch {
    return false;
  }
}

// ─── Routes ───

export default async function webhookRoutes(fastify: FastifyInstance): Promise<void> {

  // ── Telegram Webhook ──
  // Telegram sends updates as POST to this endpoint
  fastify.post(
    '/webhooks/telegram',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!verifyTelegramSecret(request)) {
        return reply.status(403).send({ error: 'Invalid secret' });
      }

      const body = request.body as Record<string, unknown>;

      // Handle message update
      const message = body.message as Record<string, unknown> | undefined;
      if (!message) {
        return reply.send({ ok: true }); // Not a message update
      }

      const chat = message.chat as Record<string, unknown>;
      const from = (message.from as Record<string, unknown>) || {};
      const senderChat = message.sender_chat as Record<string, unknown> | undefined;
      const text = (message.text as string) || (message.caption as string) || '';

      const chatId = String(chat.id);
      const senderName =
        [from.first_name, from.last_name].filter(Boolean).join(' ') ||
        (senderChat?.title as string) ||
        (chat.title as string) ||
        'Unknown';
      const senderId = String(from.id ?? (senderChat?.id ?? chat.id));

      // Find all orgs that have this chat imported
      const importedChats = await prisma.chat.findMany({
        where: { externalChatId: chatId, messenger: 'telegram' },
        select: { organizationId: true },
      });

      for (const ic of importedChats) {
        console.log(`[Telegram webhook] Saving message: chatId=${chatId}, sender=${senderName}, text=${text.slice(0, 50)}`);
        await saveIncomingMessage({
          externalChatId: chatId,
          messenger: 'telegram',
          organizationId: ic.organizationId,
          senderName,
          senderExternalId: senderId,
          text,
          externalMessageId: String(message.message_id),
        });
      }

      if (importedChats.length === 0) {
        console.log(`[Telegram webhook] No imported chats found for externalChatId=${chatId}`);
      }

      return reply.send({ ok: true });
    },
  );

  // ── Slack Event Webhook ──
  // Slack sends events to this endpoint
  fastify.post(
    '/webhooks/slack',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;

      // Always verify Slack signature first — even for url_verification challenges
      if (!verifySlackRequest(request)) {
        return reply.status(403).send({ error: 'Invalid Slack signature' });
      }

      // Handle Slack URL verification challenge (after signature is verified)
      if (body.type === 'url_verification') {
        return reply.send({ challenge: body.challenge });
      }

      if (body.type !== 'event_callback') {
        return reply.send({ ok: true });
      }

      const event = body.event as Record<string, unknown>;
      if (!event) {
        return reply.send({ ok: true });
      }

      // Handle reaction events
      if (event.type === 'reaction_added' || event.type === 'reaction_removed') {
        const emoji = slackNameToEmoji(event.reaction as string);
        const externalMessageId = (event.item as Record<string, unknown>)?.ts as string | undefined;
        const externalUserId = event.user as string | undefined;

        if (externalMessageId && externalUserId && emoji) {
          await ingestReaction({
            externalMessageId,
            messenger: 'slack',
            externalUserId,
            emoji,
            action: event.type === 'reaction_added' ? 'add' : 'remove',
          });
        }

        return reply.send({ ok: true });
      }

      if (event.type !== 'message' || event.subtype) {
        return reply.send({ ok: true }); // Not a regular message
      }

      const channelId = event.channel as string;
      const userId = event.user as string;
      const text = (event.text as string) || '';
      const ts = event.ts as string;

      const importedChats = await prisma.chat.findMany({
        where: { externalChatId: channelId, messenger: 'slack' },
        select: { organizationId: true },
      });

      for (const ic of importedChats) {
        // Resolve the Slack user ID to a real display name (cached per org)
        const senderName = await resolveSlackUserName(ic.organizationId, userId);

        await saveIncomingMessage({
          externalChatId: channelId,
          messenger: 'slack',
          organizationId: ic.organizationId,
          senderName,
          senderExternalId: userId,
          text,
          externalMessageId: ts,
        });
      }

      return reply.send({ ok: true });
    },
  );

  // ── WAHA Webhook (WhatsApp) ──
  // WAHA posts incoming messages and session status changes here.
  fastify.post(
    '/webhooks/waha',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Note: WAHA does not send X-Api-Key in webhook requests by default.
      // On Railway, the webhook URL is only known by our WAHA service.
      // For additional security, a custom header can be configured in WAHA
      // webhook config if needed.

      const body = request.body as {
        event: string;
        session: string;
        payload?: {
          id?: string;
          body?: string;
          from?: string;
          to?: string;
          fromMe?: boolean;
          timestamp?: number;
          _data?: { notifyName?: string };
          chatId?: string;
        };
        me?: { id?: string };
      };

      const { event, session: sessionName } = body;

      // Handle incoming message
      if (event === 'message' && body.payload) {
        const payload = body.payload;
        // Skip outgoing messages
        if (payload.fromMe) {
          return reply.send({ ok: true });
        }

        const chatId = payload.from || payload.chatId || '';
        const text = payload.body || '';
        const msgId = payload.id || `waha_${Date.now()}`;
        const senderName = payload._data?.notifyName || payload.from || 'Unknown';

        // Find imported chats matching this external chat ID
        const importedChats = await prisma.chat.findMany({
          where: { externalChatId: chatId, messenger: 'whatsapp' },
          select: { organizationId: true },
        });

        for (const ic of importedChats) {
          await saveIncomingMessage({
            externalChatId: chatId,
            messenger: 'whatsapp',
            organizationId: ic.organizationId,
            senderName,
            senderExternalId: payload.from || chatId,
            text,
            externalMessageId: msgId,
          });
        }
      }

      // Handle session status changes
      if (event === 'session.status') {
        const status = (body.payload as { status?: string })?.status;
        if (status === 'FAILED' || status === 'STOPPED') {
          // Extract orgId and userId from session name (format: wa-{orgId8}-{userId8})
          // Find the integration and mark as disconnected
          const integration = await prisma.integration.findFirst({
            where: {
              messenger: 'whatsapp',
              credentials: { path: ['wahaSessionName'], equals: sessionName },
            },
          });

          if (integration) {
            await prisma.integration.update({
              where: { id: integration.id },
              data: { status: 'session_expired' },
            });
          }
        }
      }

      return reply.send({ ok: true });
    },
  );

  // ── Gmail Push Notification ──
  // Google Pub/Sub sends notifications when new emails arrive
  fastify.post(
    '/webhooks/gmail',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify the request comes from Google Pub/Sub via Bearer token
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing authorization' });
      }

      // In production, verify the JWT token audience matches our project
      // For now, check that the subscription name matches our expected one
      const gmailWebhookToken = process.env.GMAIL_WEBHOOK_TOKEN;
      if (gmailWebhookToken) {
        const token = authHeader.slice(7);
        if (token !== gmailWebhookToken) {
          return reply.status(403).send({ error: 'Invalid webhook token' });
        }
      } else if (process.env.NODE_ENV === 'production') {
        return reply.status(403).send({ error: 'Gmail webhook not configured' });
      }

      const body = request.body as Record<string, unknown>;
      const message = body.message as Record<string, unknown>;

      if (!message?.data) {
        return reply.send({ ok: true });
      }

      // Decode base64 notification data
      const decoded = JSON.parse(
        Buffer.from(message.data as string, 'base64').toString(),
      ) as { emailAddress: string; historyId: string };

      fastify.log.info(
        { email: decoded.emailAddress, historyId: decoded.historyId },
        'Gmail push notification received',
      );

      // Find integration by email address
      // Gmail integrations don't store email directly, so search by messenger + status
      const gmailIntegrations = await prisma.integration.findMany({
        where: { messenger: 'gmail', status: 'connected' },
        select: { id: true, credentials: true, organizationId: true, userId: true, settings: true },
      });

      // Find matching integration by decrypting creds and checking email
      for (const integration of gmailIntegrations) {
        try {
          const credentials = decryptCredentials<{
            clientId: string;
            clientSecret: string;
            refreshToken: string;
          }>(integration.credentials as string);

          const oauth2Client = new google.auth.OAuth2(
            credentials.clientId,
            credentials.clientSecret,
          );
          oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });

          const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

          // Check if this integration's email matches the notification
          const profile = await gmail.users.getProfile({ userId: 'me' });
          const integrationEmail = profile.data.emailAddress ?? '';

          if (integrationEmail !== decoded.emailAddress) continue;

          // Get the stored historyId from integration metadata
          const metadata = (integration.settings ?? {}) as Record<string, unknown>;
          const lastHistoryId = metadata.lastHistoryId as string | undefined;

          if (!lastHistoryId) {
            // No history tracking yet — just save the new historyId
            await prisma.integration.update({
              where: { id: integration.id },
              data: { settings: { ...metadata, lastHistoryId: decoded.historyId } },
            });
            break;
          }

          // Fetch history changes since last known historyId
          let historyResponse;
          try {
            historyResponse = await gmail.users.history.list({
              userId: 'me',
              startHistoryId: lastHistoryId,
              historyTypes: ['messageAdded'],
            });
          } catch (err) {
            const errMsg = String(err);
            if (errMsg.includes('404') || errMsg.includes('notFound')) {
              // historyId too old — just update and skip
              await prisma.integration.update({
                where: { id: integration.id },
                data: { settings: { ...metadata, lastHistoryId: decoded.historyId } },
              });
              break;
            }
            throw err;
          }

          const histories = historyResponse.data.history ?? [];

          // Collect unique thread IDs from new messages
          const newThreadIds = new Set<string>();
          for (const history of histories) {
            for (const added of history.messagesAdded ?? []) {
              const threadId = added.message?.threadId;
              if (threadId) newThreadIds.add(threadId);
            }
          }

          // Process each new thread
          for (const threadId of newThreadIds) {
            try {
              const thread = await gmail.users.threads.get({
                userId: 'me',
                id: threadId,
                format: 'metadata',
                metadataHeaders: ['Subject', 'From', 'Date'],
              });

              const messages = thread.data.messages ?? [];
              if (messages.length === 0) continue;

              const firstHeaders = messages[0]?.payload?.headers ?? [];
              const subject = firstHeaders.find((h) => h.name === 'Subject')?.value ?? '(no subject)';
              const from = firstHeaders.find((h) => h.name === 'From')?.value ?? '';
              const fromMatch = from.match(/^(.+?)\s*<(.+?)>$/);
              const senderName = fromMatch ? fromMatch[1]!.replace(/^["']|["']$/g, '') : from;
              const senderEmail = fromMatch ? fromMatch[2]! : from;
              const isSelfThread = senderEmail === integrationEmail;
              const chatName = isSelfThread ? subject : `${senderName} — ${subject}`;

              // Upsert chat
              const chat = await prisma.chat.upsert({
                where: {
                  externalChatId_messenger_organizationId: {
                    externalChatId: threadId,
                    messenger: 'gmail',
                    organizationId: integration.organizationId,
                  },
                },
                create: {
                  externalChatId: threadId,
                  messenger: 'gmail',
                  name: chatName,
                  chatType: 'direct',
                  organizationId: integration.organizationId,
                  importedById: integration.userId,
                  syncStatus: 'synced',
                  messageCount: messages.length,
                },
                update: {},
              });

              // Save only the newest message(s) that triggered the notification
              const lastMsg = messages[messages.length - 1];
              if (lastMsg?.id) {
                const msgHeaders = lastMsg.payload?.headers ?? [];
                const msgFrom = msgHeaders.find((h) => h.name === 'From')?.value ?? '';
                const msgFromMatch = msgFrom.match(/^(.+?)\s*<(.+?)>$/);
                const msgSenderName = msgFromMatch ? msgFromMatch[1]!.replace(/^["']|["']$/g, '') : msgFrom;
                const msgSenderEmail = msgFromMatch ? msgFromMatch[2]! : msgFrom;

                await saveIncomingMessage({
                  externalChatId: threadId,
                  messenger: 'gmail',
                  organizationId: integration.organizationId,
                  senderName: msgSenderName || 'Unknown',
                  senderExternalId: msgSenderEmail,
                  text: lastMsg.snippet ?? '',
                  externalMessageId: lastMsg.id,
                });
              }
            } catch (err) {
              fastify.log.error({ threadId, error: String(err) }, 'Failed to process Gmail thread');
            }
          }

          // Update lastHistoryId
          await prisma.integration.update({
            where: { id: integration.id },
            data: { settings: { ...metadata, lastHistoryId: decoded.historyId } },
          });

          break; // Found matching integration, done
        } catch (err) {
          fastify.log.error({ integrationId: integration.id, error: String(err) }, 'Error processing Gmail webhook for integration');
        }
      }

      return reply.status(200).send({ ok: true });
    },
  );

  // ── GET verification endpoints (for Slack setup) ──
}
