import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes } from 'node:crypto';
import IORedis from 'ioredis';
import { google } from 'googleapis';
import prisma from '../lib/prisma.js';
import { encryptCredentials } from '../lib/crypto.js';
import { authenticate } from '../middleware/auth.js';
import { createAdapter } from '../integrations/factory.js';
import { MessengerError } from '../integrations/base.js';

// ─── Redis client for OAuth state storage ───

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }
  return redis;
}

// ─── Helpers ───

function getOrgId(request: FastifyRequest): string | null {
  if (request.user.role === 'superadmin') {
    const query = request.query as Record<string, string>;
    return query.organizationId ?? request.user.organizationId;
  }
  return request.user.organizationId;
}

function getAppUrl(): string {
  return process.env.APP_URL ?? 'http://localhost:3000';
}

function getApiUrl(): string {
  return process.env.API_URL ?? `http://localhost:${process.env.PORT ?? '3001'}`;
}

function slackOAuthConfigured(): boolean {
  return !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET);
}

/**
 * Custom auth handler for OAuth authorize endpoints.
 * Since the user is redirected via browser (not AJAX), the JWT
 * may come as a query parameter `?token=...` instead of an Authorization header.
 * We inject it into the Authorization header so the standard authenticate middleware works.
 */
async function authenticateOAuthRedirect(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const query = request.query as Record<string, string | undefined>;
  const tokenFromQuery = query.token;

  // If no Authorization header but token in query, inject it
  if (!request.headers.authorization && tokenFromQuery) {
    request.headers.authorization = `Bearer ${tokenFromQuery}`;
  }

  // Delegate to the standard authenticate middleware
  return authenticate(request, reply);
}

function gmailOAuthConfigured(): boolean {
  return !!(
    (process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID) &&
    (process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET)
  );
}

function getGmailOAuthConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  const clientId = process.env.GMAIL_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!;
  const redirectUri =
    process.env.GMAIL_REDIRECT_URI ?? `${getApiUrl()}/api/oauth/gmail/callback`;
  return { clientId, clientSecret, redirectUri };
}

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

// ─── Plugin ───

export default async function oauthRoutes(fastify: FastifyInstance): Promise<void> {
  // ═══════════════════════════════════════════════════════════════
  // ─── Slack OAuth Routes ───
  // ═══════════════════════════════════════════════════════════════

  // ─── GET /oauth/slack/authorize ───
  // Initiates Slack OAuth flow. Requires authentication so we know which user is connecting.
  // Generates a random state token, stores it in Redis with userId + orgId, and redirects to Slack.

  fastify.get(
    '/oauth/slack/authorize',
    { preHandler: [authenticateOAuthRedirect] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!slackOAuthConfigured()) {
        return reply.redirect(
          `${getAppUrl()}/settings?integration=slack&status=error&error=oauth_not_configured`,
        );
      }

      const organizationId = getOrgId(request);
      if (!organizationId) {
        return reply.redirect(
          `${getAppUrl()}/settings?integration=slack&status=error&error=no_organization`,
        );
      }

      // Generate a cryptographically random state token
      const state = randomBytes(32).toString('hex');

      // Store state in Redis with user context (TTL: 10 minutes)
      const stateData = JSON.stringify({
        userId: request.user.id,
        organizationId,
      });
      await getRedis().set(`oauth:slack:state:${state}`, stateData, 'EX', 600);

      // Build the Slack OAuth authorization URL
      // Bot scopes — needed for reading channels, history, and user info
      const botScopes = [
        'channels:read',
        'chat:write',
        'users:read',
        'channels:history',
        'groups:read',
        'groups:history',
        'im:read',
        'im:history',
        'mpim:read',
        'mpim:history',
      ].join(',');

      // User scopes — needed for sending messages AS the user (not the bot)
      const userScopes = [
        'chat:write',
        'channels:read',
        'channels:history',
        'groups:read',
        'groups:history',
        'im:read',
        'im:history',
        'mpim:read',
        'mpim:history',
        'files:write',
      ].join(',');

      const redirectUri = `${getApiUrl()}/api/oauth/slack/callback`;

      const slackAuthUrl = new URL('https://slack.com/oauth/v2/authorize');
      slackAuthUrl.searchParams.set('client_id', process.env.SLACK_CLIENT_ID!);
      slackAuthUrl.searchParams.set('scope', botScopes);
      slackAuthUrl.searchParams.set('user_scope', userScopes);
      slackAuthUrl.searchParams.set('redirect_uri', redirectUri);
      slackAuthUrl.searchParams.set('state', state);

      return reply.redirect(slackAuthUrl.toString());
    },
  );

  // ─── GET /oauth/slack/callback ───
  // Slack redirects here after the user authorizes (or denies).
  // This route does NOT require auth middleware — the state token carries the user context.

  fastify.get(
    '/oauth/slack/callback',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;
      const { code, state, error: slackError } = query;

      const appUrl = getAppUrl();

      // Handle user denying authorization
      if (slackError) {
        return reply.redirect(
          `${appUrl}/settings?integration=slack&status=error&error=${encodeURIComponent(slackError)}`,
        );
      }

      // Validate required params
      if (!code || !state) {
        return reply.redirect(
          `${appUrl}/settings?integration=slack&status=error&error=missing_params`,
        );
      }

      // Validate state token from Redis
      const redisKey = `oauth:slack:state:${state}`;
      const stateDataRaw = await getRedis().get(redisKey);

      if (!stateDataRaw) {
        return reply.redirect(
          `${appUrl}/settings?integration=slack&status=error&error=invalid_or_expired_state`,
        );
      }

      // Delete state token immediately (one-time use)
      await getRedis().del(redisKey);

      let stateData: { userId: string; organizationId: string };
      try {
        stateData = JSON.parse(stateDataRaw);
      } catch {
        return reply.redirect(
          `${appUrl}/settings?integration=slack&status=error&error=corrupted_state`,
        );
      }

      const { userId, organizationId } = stateData;

      // Exchange the authorization code for an access token
      const redirectUri = `${getApiUrl()}/api/oauth/slack/callback`;

      let tokenResponse: Response;
      try {
        tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: process.env.SLACK_CLIENT_ID!,
            client_secret: process.env.SLACK_CLIENT_SECRET!,
            code,
            redirect_uri: redirectUri,
          }),
        });
      } catch (err) {
        fastify.log.error(err, 'Failed to exchange Slack OAuth code');
        return reply.redirect(
          `${appUrl}/settings?integration=slack&status=error&error=token_exchange_failed`,
        );
      }

      const tokenData = (await tokenResponse.json()) as {
        ok: boolean;
        access_token?: string;
        team?: { id: string; name: string };
        authed_user?: { id: string; access_token?: string };
        error?: string;
      };

      if (!tokenData.ok || !tokenData.access_token) {
        const errorCode = tokenData.error ?? 'unknown_slack_error';
        fastify.log.warn({ errorCode }, 'Slack OAuth token exchange failed');
        return reply.redirect(
          `${appUrl}/settings?integration=slack&status=error&error=${encodeURIComponent(errorCode)}`,
        );
      }

      const botToken = tokenData.access_token;
      const userToken = tokenData.authed_user?.access_token;

      // Prefer user token for sending messages AS the user; fall back to bot token
      const primaryToken = userToken || botToken;

      // Verify the token works by connecting with the adapter
      const credentials = { token: primaryToken };
      const adapter = await createAdapter('slack', credentials);
      try {
        await adapter.connect();
      } catch (err) {
        const message =
          err instanceof MessengerError ? err.message : 'Failed to verify Slack token';
        fastify.log.warn({ message }, 'Slack OAuth token verification failed');
        return reply.redirect(
          `${appUrl}/settings?integration=slack&status=error&error=token_verification_failed`,
        );
      }

      // Encrypt and store credentials (keep both tokens for flexibility)
      const encryptedCredentials = encryptCredentials({
        token: primaryToken,
        botToken,
        userToken: userToken ?? null,
        team: tokenData.team,
        authedUser: tokenData.authed_user,
        oauthFlow: true, // Mark that this was connected via OAuth
      });

      // Upsert the integration record
      const existing = await prisma.integration.findUnique({
        where: {
          messenger_organizationId_userId: {
            messenger: 'slack',
            organizationId,
            userId,
          },
        },
      });

      if (existing) {
        await prisma.integration.update({
          where: { id: existing.id },
          data: {
            credentials: encryptedCredentials,
            status: 'connected',
            connectedAt: new Date(),
          },
        });
      } else {
        await prisma.integration.create({
          data: {
            messenger: 'slack',
            status: 'connected',
            credentials: encryptedCredentials,
            organizationId,
            userId,
            connectedAt: new Date(),
          },
        });
      }

      // Redirect back to frontend with success
      return reply.redirect(
        `${appUrl}/settings?integration=slack&status=connected`,
      );
    },
  );

  // ─── GET /oauth/slack/status ───
  // Returns whether Slack OAuth is configured (so frontend knows to show button vs form).

  fastify.get(
    '/oauth/slack/status',
    { preHandler: [authenticate] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        oauthConfigured: slackOAuthConfigured(),
      });
    },
  );

  // ═══════════════════════════════════════════════════════════════
  // ─── Gmail OAuth Routes ───
  // ═══════════════════════════════════════════════════════════════

  // ─── GET /oauth/gmail/available ───
  // Check whether server-side Gmail OAuth is configured.
  // Frontend uses this to decide whether to show "Connect with Google" or manual form.

  fastify.get(
    '/oauth/gmail/available',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({ available: gmailOAuthConfigured() });
    },
  );

  // ─── GET /oauth/gmail/authorize ───
  // Starts the Gmail OAuth flow. Requires authentication so we know which user is connecting.
  // Generates a state token, stores it in Redis, then redirects to Google consent screen.

  fastify.get(
    '/oauth/gmail/authorize',
    { preHandler: [authenticateOAuthRedirect] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (!gmailOAuthConfigured()) {
        return reply.redirect(
          `${getAppUrl()}/settings?integration=gmail&status=error&error=oauth_not_configured`,
        );
      }

      const organizationId = getOrgId(request);
      if (!organizationId) {
        return reply.redirect(
          `${getAppUrl()}/settings?integration=gmail&status=error&error=no_organization`,
        );
      }

      // Generate a cryptographically random state token
      const state = randomBytes(32).toString('hex');

      // Store state in Redis with user context (TTL: 10 minutes)
      const stateData = JSON.stringify({
        userId: request.user.id,
        organizationId,
      });
      await getRedis().set(`oauth:gmail:state:${state}`, stateData, 'EX', 600);

      // Build Google OAuth authorization URL
      const config = getGmailOAuthConfig();
      const oauth2Client = new google.auth.OAuth2(
        config.clientId,
        config.clientSecret,
        config.redirectUri,
      );

      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // Force consent to always get refresh_token
        scope: GMAIL_SCOPES,
        state,
      });

      return reply.redirect(authUrl);
    },
  );

  // ─── GET /oauth/gmail/callback ───
  // Google redirects here after the user authorizes (or denies).
  // This route does NOT require auth middleware — the state token carries the user context.

  fastify.get(
    '/oauth/gmail/callback',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as Record<string, string | undefined>;
      const { code, state, error: googleError } = query;

      const appUrl = getAppUrl();

      // Handle user denying authorization
      if (googleError) {
        fastify.log.warn(`Gmail OAuth denied: ${googleError}`);
        return reply.redirect(
          `${appUrl}/settings?integration=gmail&status=error&error=${encodeURIComponent(googleError)}`,
        );
      }

      // Validate required params
      if (!code || !state) {
        return reply.redirect(
          `${appUrl}/settings?integration=gmail&status=error&error=missing_params`,
        );
      }

      // Validate state token from Redis
      const redisKey = `oauth:gmail:state:${state}`;
      const stateDataRaw = await getRedis().get(redisKey);

      if (!stateDataRaw) {
        return reply.redirect(
          `${appUrl}/settings?integration=gmail&status=error&error=invalid_or_expired_state`,
        );
      }

      // Delete state token immediately (one-time use)
      await getRedis().del(redisKey);

      let stateData: { userId: string; organizationId: string };
      try {
        stateData = JSON.parse(stateDataRaw);
      } catch {
        return reply.redirect(
          `${appUrl}/settings?integration=gmail&status=error&error=corrupted_state`,
        );
      }

      const { userId, organizationId } = stateData;

      // Exchange authorization code for tokens
      const config = getGmailOAuthConfig();
      const oauth2Client = new google.auth.OAuth2(
        config.clientId,
        config.clientSecret,
        config.redirectUri,
      );

      let tokens: { access_token?: string | null; refresh_token?: string | null };
      try {
        const { tokens: exchangedTokens } = await oauth2Client.getToken(code);
        tokens = exchangedTokens;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        fastify.log.error(`Gmail OAuth token exchange failed: ${errMsg}`);
        return reply.redirect(
          `${appUrl}/settings?integration=gmail&status=error&error=token_exchange_failed`,
        );
      }

      if (!tokens.refresh_token) {
        fastify.log.error('Gmail OAuth: No refresh_token returned');
        return reply.redirect(
          `${appUrl}/settings?integration=gmail&status=error&error=no_refresh_token`,
        );
      }

      // Build credentials object matching what GmailAdapter expects
      const gmailCredentials = {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        refreshToken: tokens.refresh_token,
      };

      // Encrypt and store credentials
      const encryptedCredentials = encryptCredentials(gmailCredentials);

      // Upsert the integration record
      const existing = await prisma.integration.findUnique({
        where: {
          messenger_organizationId_userId: {
            messenger: 'gmail',
            organizationId,
            userId,
          },
        },
      });

      if (existing) {
        await prisma.integration.update({
          where: { id: existing.id },
          data: {
            credentials: encryptedCredentials,
            status: 'connected',
            connectedAt: new Date(),
          },
        });
      } else {
        await prisma.integration.create({
          data: {
            messenger: 'gmail',
            status: 'connected',
            credentials: encryptedCredentials,
            organizationId,
            userId,
            connectedAt: new Date(),
          },
        });
      }

      fastify.log.info(`Gmail OAuth connected for user ${userId} in org ${organizationId}`);

      return reply.redirect(
        `${appUrl}/settings?integration=gmail&status=connected`,
      );
    },
  );
}
