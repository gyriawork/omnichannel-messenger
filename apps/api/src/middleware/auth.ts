import type { FastifyRequest, FastifyReply } from 'fastify';
import jwt from 'jsonwebtoken';

interface JwtPayload {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string | null;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set in environment variables');
  }
  return secret;
}

/**
 * Fastify preHandler that verifies the JWT access token from the
 * `Authorization: Bearer <token>` header and populates `request.user`.
 *
 * Usage:
 *   fastify.get('/me', { preHandler: [authenticate] }, handler)
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({
      error: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Missing or malformed Authorization header',
        statusCode: 401,
      },
    });
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] }) as JwtPayload;

    request.user = {
      id: payload.id,
      email: payload.email,
      name: payload.name,
      role: payload.role as 'superadmin' | 'admin' | 'user',
      organizationId: payload.organizationId,
    };
  } catch (err) {
    const isExpired = err instanceof jwt.TokenExpiredError;
    const code = isExpired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_INVALID_CREDENTIALS';
    const message = isExpired ? 'Access token has expired' : 'Invalid access token';

    return reply.status(401).send({
      error: {
        code,
        message,
        statusCode: 401,
      },
    });
  }
}
