import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * CSRF protection via Origin/Referer header validation.
 * Since this is an API-first app with CORS enforced, we validate
 * that the Origin header matches the allowed APP_URL.
 * This is defense-in-depth alongside SameSite cookies.
 */
export function csrfProtection(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  // Skip for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    return done();
  }

  // Skip for webhook endpoints (no cookies involved)
  if (request.url.startsWith('/api/webhooks/')) {
    return done();
  }

  const origin = request.headers.origin;
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  // If Origin header present, validate it
  if (origin) {
    const allowedOrigins = [appUrl, 'http://localhost:3000'];
    if (!allowedOrigins.some(allowed => origin === allowed)) {
      return reply.status(403).send({
        error: {
          code: 'CSRF_VALIDATION_FAILED',
          message: 'Cross-origin request blocked',
          statusCode: 403,
        },
      });
    }
  }

  done();
}
