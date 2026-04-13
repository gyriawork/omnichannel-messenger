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

// ─── Slack channel name cache ───
const slackChannelNameCache = new Map<string, string>();

/**
 * Resolve a Slack channel ID to a human-readable name.
 * For DMs, resolves the user's display name instead.
 */
async function resolveSlackChannelName(
  organizationId: string,
  channelId: string,
): Promise<string> {
  const cacheKey = `${organizationId}:ch:${channelId}`;
  const cached = slackChannelNameCache.get(cacheKey);
  if (cached) return cached;

  try {
    const integration = await prisma.integration.findFirst({
      where: { messenger: 'slack', organizationId, status: 'connected' },
      select: { credentials: true },
    });
    if (!integration) return channelId;

    const credentials = decryptCredentials<{ token: string }>(
      integration.credentials as string,
    );
    const client = new WebClient(credentials.token);
    const convInfo = await client.conversations.info({ channel: channelId });
    const channel = convInfo.channel as Record<string, unknown> | undefined;

    let name: string = (channel?.name as string) || channelId;

    // For DMs, resolve the user name
    if (channel?.is_im) {
      const userId = channel.user as string | undefined;
      if (userId) {
        const userInfo = await client.users.info({ user: userId });
        name = userInfo.user?.real_name
          || userInfo.user?.profile?.display_name
          || userInfo.user?.name
          || channelId;
      }
    }

    slackChannelNameCache.set(cacheKey, name);
    return name;
  } catch {
    return channelId;
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
  // Telegram sends updates as POST to this endpoint. The path carries the
  // integration id so each bot's updates land in exactly one tenant — no
  // cross-tenant fan-out. V1.1 primarily uses user-session (gramjs in the
  // worker); this bot-webhook path is a fallback for bot-only setups.
  fastify.post(
    '/webhooks/telegram/:integrationId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!verifyTelegramSecret(request)) {
        return reply.status(403).send({ error: 'Invalid secret' });
      }

      const { integrationId } = request.params as { integrationId: string };

      const integration = await prisma.integration.findUnique({
        where: { id: integrationId },
        select: { id: true, messenger: true, organizationId: true, userId: true, status: true },
      });

      if (!integration || integration.messenger !== 'telegram') {
        return reply.status(404).send({ error: 'Integration not found' });
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
      let text = (message.text as string) || (message.caption as string) || '';
      // Detect media type for preview when message has no text
      if (!text) {
        if (message.photo) text = '📷 Photo';
        else if (message.sticker) text = '🏷 Sticker';
        else if (message.animation) text = 'GIF';
        else if (message.video) text = '🎬 Video';
        else if (message.video_note) text = '🎥 Video message';
        else if (message.voice) text = '🎤 Voice message';
        else if (message.audio) text = '🎵 Audio';
        else if (message.document) text = '📎 File';
        else if (message.location || message.venue) text = '📍 Location';
        else if (message.contact) text = '👤 Contact';
        else if (message.poll) text = '📊 Poll';
      }

      const chatId = String(chat.id);
      const senderName =
        [from.first_name, from.last_name].filter(Boolean).join(' ') ||
        (senderChat?.title as string) ||
        (chat.title as string) ||
        (from.username ? `@${from.username}` : '') ||
        'Anonymous';
      const senderId = String(from.id ?? (senderChat?.id ?? chat.id));
      const chatTitle = (chat.title as string) || senderName;
      const chatTypeRaw = (chat.type as string) || 'private';
      const chatType: 'direct' | 'group' | 'channel' =
        chatTypeRaw === 'private' ? 'direct' : chatTypeRaw === 'channel' ? 'channel' : 'group';

      await saveIncomingMessage({
        externalChatId: chatId,
        messenger: 'telegram',
        organizationId: integration.organizationId,
        importedById: integration.userId,
        senderName,
        senderExternalId: senderId,
        text,
        externalMessageId: String(message.message_id),
        chatName: chatTitle,
        chatType,
      });

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

      // Resolve the correct org via Slack team_id (each Slack workspace maps to
      // one Integration per-org). Without this we'd either drop multi-tenancy
      // or fan messages out to every Slack integration in the database.
      const teamId = (body.team_id as string) || ((event as Record<string, unknown>).team as string);
      const slackIntegrations = await prisma.integration.findMany({
        where: { messenger: 'slack', status: 'connected' },
        select: { organizationId: true, userId: true, credentials: true },
      });

      const matchedIntegrations = slackIntegrations.filter((integration) => {
        try {
          const creds = decryptCredentials<{ teamId?: string; team?: { id?: string } }>(
            integration.credentials as string,
          );
          return creds.teamId === teamId || creds.team?.id === teamId;
        } catch {
          return false;
        }
      });

      // No fan-out: if we cannot resolve the Slack workspace to exactly one
      // tenant, drop the event rather than leak data across organizations.
      // Older integrations missing teamId must be re-connected to route events.
      if (matchedIntegrations.length === 0) {
        request.log.warn(
          { teamId },
          '[webhooks/slack] No integration matched team_id — dropping event',
        );
        return reply.send({ ok: true });
      }

      for (const integration of matchedIntegrations) {
        const [senderName, chatName] = await Promise.all([
          resolveSlackUserName(integration.organizationId, userId),
          resolveSlackChannelName(integration.organizationId, channelId),
        ]);

        await saveIncomingMessage({
          externalChatId: channelId,
          messenger: 'slack',
          organizationId: integration.organizationId,
          importedById: integration.userId,
          senderName,
          senderExternalId: userId,
          text,
          externalMessageId: ts,
          chatName,
          chatType: 'channel',
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
          id?: unknown; // WAHA may return string or {_serialized, fromMe, remote, id}
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
        // WAHA may return id as object {_serialized: "...", ...} — extract string
        const rawId = payload.id;
        const msgId = typeof rawId === 'object' && rawId !== null
          ? (rawId as Record<string, unknown>)._serialized as string ?? JSON.stringify(rawId)
          : String(rawId || `waha_${Date.now()}`);
        let senderName = payload._data?.notifyName as string | undefined;
        if (!senderName && payload.from) {
          // payload.from is like "79123456789@c.us" — format as phone number
          const phone = String(payload.from).split('@')[0];
          senderName = phone ? (phone.startsWith('+') ? phone : `+${phone}`) : undefined;
        }
        senderName = senderName || 'Unknown';

        // Resolve the owning integration via WAHA session name stored in settings.
        // Fallback: if no match by settings (legacy integrations before settings field),
        // find any connected WhatsApp integration (works for single-session WAHA Free).
        let integration = await prisma.integration.findFirst({
          where: {
            messenger: 'whatsapp',
            settings: { path: ['wahaSessionName'], equals: sessionName },
          },
          select: { organizationId: true, userId: true },
        });
        if (!integration) {
          integration = await prisma.integration.findFirst({
            where: { messenger: 'whatsapp', status: 'connected' },
            select: { organizationId: true, userId: true },
          });
        }

        if (integration) {
          await saveIncomingMessage({
            externalChatId: chatId,
            messenger: 'whatsapp',
            organizationId: integration.organizationId,
            importedById: integration.userId,
            senderName,
            senderExternalId: payload.from || chatId,
            text,
            externalMessageId: msgId,
            chatName: senderName,
            chatType: chatId.endsWith('@g.us') ? 'group' : 'direct',
          });
        } else {
          console.warn(`[WAHA Webhook] No integration found for session "${sessionName}"`);
        }
      }

      // Handle session status changes
      if (event === 'session.status') {
        const status = (body.payload as { status?: string })?.status;
        if (status === 'FAILED' || status === 'STOPPED') {
          let statusIntegration = await prisma.integration.findFirst({
            where: {
              messenger: 'whatsapp',
              settings: { path: ['wahaSessionName'], equals: sessionName },
            },
          });
          if (!statusIntegration) {
            statusIntegration = await prisma.integration.findFirst({
              where: { messenger: 'whatsapp', status: 'connected' },
            });
          }
          const integration = statusIntegration;

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
        // Use timing-safe comparison to prevent timing attacks (matches Slack/Telegram pattern)
        if (token.length !== gmailWebhookToken.length) {
          return reply.status(403).send({ error: 'Invalid webhook token' });
        }
        try {
          const valid = timingSafeEqual(
            Buffer.from(token, 'utf8'),
            Buffer.from(gmailWebhookToken, 'utf8'),
          );
          if (!valid) {
            return reply.status(403).send({ error: 'Invalid webhook token' });
          }
        } catch {
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
                  importedById: integration.userId,
                  senderName: msgSenderName || 'Unknown',
                  senderExternalId: msgSenderEmail,
                  text: lastMsg.snippet ?? '',
                  externalMessageId: lastMsg.id,
                  chatName: chatName,
                  chatType: 'direct',
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
