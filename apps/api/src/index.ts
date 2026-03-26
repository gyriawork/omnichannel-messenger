import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import prisma from './lib/prisma.js';
import authRoutes from './routes/auth.js';
import organizationRoutes from './routes/organizations.js';
import userRoutes from './routes/users.js';
import messageRoutes from './routes/messages.js';
import chatRoutes from './routes/chats.js';
import chatPreferenceRoutes from './routes/chat-preferences.js';
import tagRoutes from './routes/tags.js';
import integrationRoutes from './routes/integrations.js';
import broadcastRoutes from './routes/broadcasts.js';
import settingsRoutes from './routes/settings.js';
import templateRoutes from './routes/templates.js';
import activityRoutes from './routes/activity.js';
import workspaceRoutes from './routes/workspace-settings.js';
import uploadRoutes from './routes/uploads.js';
import webhookRoutes from './routes/webhooks.js';
import oauthRoutes from './routes/oauth.js';
import { createWebSocketServer } from './websocket/index.js';
import { validateEnv } from './lib/env.js';

const env = validateEnv();

// ─── Create server ───

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
  },
});

// ─── Plugins ───

await fastify.register(cors, {
  origin: (origin, cb) => {
    const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
    if (!origin || origin === appUrl || origin.endsWith('--omnichannel-messenger.netlify.app') || origin === 'http://localhost:3000') {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
  credentials: true,
});

await fastify.register(helmet, {
  contentSecurityPolicy: false, // CSP handled by frontend
});

await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
});

await fastify.register(cookie);

await fastify.register(multipart, {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ─── Body size limit ───

fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'string', bodyLimit: 10 * 1024 * 1024 }, // 10 MB
  (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch (err) {
      done(err as Error, undefined);
    }
  },
);

// ─── Routes ───

// Webhooks registered first — they don't require auth
await fastify.register(webhookRoutes, { prefix: '/api' });

await fastify.register(authRoutes, { prefix: '/api/auth' });
await fastify.register(organizationRoutes, { prefix: '/api/organizations' });
await fastify.register(userRoutes, { prefix: '/api/users' });
await fastify.register(messageRoutes, { prefix: '/api' });
await fastify.register(chatRoutes, { prefix: '/api' });
await fastify.register(chatPreferenceRoutes, { prefix: '/api' });
await fastify.register(tagRoutes, { prefix: '/api' });
await fastify.register(integrationRoutes, { prefix: '/api' });
await fastify.register(broadcastRoutes, { prefix: '/api' });
await fastify.register(settingsRoutes, { prefix: '/api' });
await fastify.register(templateRoutes, { prefix: '/api' });
await fastify.register(activityRoutes, { prefix: '/api' });
await fastify.register(workspaceRoutes, { prefix: '/api' });
await fastify.register(uploadRoutes, { prefix: '/api' });
await fastify.register(oauthRoutes, { prefix: '/api' });

// Health check
fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

// ─── Error handler ───

fastify.setErrorHandler((error, _request, reply) => {
  // Rate limit errors
  if (error.statusCode === 429) {
    return reply.status(429).send({
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
        statusCode: 429,
      },
    });
  }

  // Validation errors from Fastify schema
  if (error.validation) {
    return reply.status(422).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: error.message,
        statusCode: 422,
      },
    });
  }

  // Log unexpected errors
  fastify.log.error(error);

  return reply.status(error.statusCode ?? 500).send({
    error: {
      code: 'INTERNAL_ERROR',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Internal server error',
      statusCode: error.statusCode ?? 500,
    },
  });
});

// ─── Start ───

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

try {
  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`Server listening on ${HOST}:${PORT}`);

  // Attach Socket.io to the same HTTP server
  const httpServer = fastify.server;
  const io = createWebSocketServer(httpServer);
  fastify.log.info('WebSocket server attached');
} catch (err) {
  fastify.log.fatal(err);
  process.exit(1);
}

// ─── Graceful shutdown ───

async function shutdown(signal: string) {
  fastify.log.info(`Received ${signal}, shutting down gracefully`);
  await fastify.close();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
