import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import authRoutes from '../routes/auth.js';
import type { FastifyInstance } from 'fastify';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cookie);

  // Register error handler matching production
  app.setErrorHandler((error, _request, reply) => {
    if (error.statusCode === 429) {
      return reply.status(429).send({
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests', statusCode: 429 },
      });
    }
    return reply.status(error.statusCode ?? 500).send({
      error: { code: 'INTERNAL_ERROR', message: error.message, statusCode: error.statusCode ?? 500 },
    });
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

export function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}
