import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebClient } from '@slack/web-api';
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
      const from = message.from as Record<string, unknown>;
      const text = (message.text as string) || (message.caption as string) || '';

      const chatId = String(chat.id);
      const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Unknown';
      const senderId = String(from.id);

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

  // ── WhatsApp Webhook ──
  // WhatsApp (Baileys) uses local session, but if using Business API:
  fastify.post(
    '/webhooks/whatsapp',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;

      // Note: GET-based verification is handled by the separate GET route below

      const entry = (body.entry as Array<Record<string, unknown>>)?.[0];
      const changes = (entry?.changes as Array<Record<string, unknown>>)?.[0];
      const value = changes?.value as Record<string, unknown>;
      const messages = value?.messages as Array<Record<string, unknown>>;

      if (!messages?.length) {
        return reply.send({ ok: true });
      }

      for (const msg of messages) {
        const from = msg.from as string; // phone number
        const text = (msg.text as Record<string, unknown>)?.body as string || '';
        const msgId = msg.id as string;

        const importedChats = await prisma.chat.findMany({
          where: { externalChatId: from, messenger: 'whatsapp' },
          select: { organizationId: true },
        });

        for (const ic of importedChats) {
          await saveIncomingMessage({
            externalChatId: from,
            messenger: 'whatsapp',
            organizationId: ic.organizationId,
            senderName: from,
            senderExternalId: from,
            text,
            externalMessageId: msgId,
          });
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

      // In production: use historyId to fetch new messages via Gmail API
      // Then save them using saveIncomingMessage()
      // This requires the Gmail adapter to fetch the actual message content

      return reply.status(200).send({ ok: true });
    },
  );

  // ── GET verification endpoints (for Slack/WhatsApp setup) ──
  fastify.get(
    '/webhooks/whatsapp',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string>;
      const whatsappVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
      if (!whatsappVerifyToken) {
        fastify.log.error('WHATSAPP_VERIFY_TOKEN environment variable is not set');
        return reply.status(500).send({ error: 'Server misconfiguration' });
      }
      if (query['hub.verify_token'] === whatsappVerifyToken) {
        return reply.send(query['hub.challenge'] || 'OK');
      }
      return reply.status(403).send({ error: 'Invalid verify token' });
    },
  );
}
