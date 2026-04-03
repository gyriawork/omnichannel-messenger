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

  // If Origin header is absent on a state-changing request, only allow if
  // the request carries a Bearer token (i.e. an API client, not a browser form).
  if (!origin) {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(403).send({
        error: {
          code: 'CSRF_VALIDATION_FAILED',
          message: 'Origin header required for cookie-based requests',
          statusCode: 403,
        },
      });
    }
    return done();
  }

  // Origin header present — validate it
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

  done();
}
