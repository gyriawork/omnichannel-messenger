import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import prisma from '../lib/prisma.js';

// ─── Env helpers ───

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return secret;
}

function getJwtRefreshSecret(): string {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is not set');
  return secret;
}

// ─── Token generation ───

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

interface TokenUser {
  id: string;
  email: string;
  name: string;
  role: string;
  organizationId: string | null;
}

function generateAccessToken(user: TokenUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
    },
    getJwtSecret(),
    { expiresIn: ACCESS_TOKEN_EXPIRY },
  );
}

function generateRefreshToken(): string {
  return randomUUID();
}

async function storeRefreshToken(userId: string, token: string): Promise<void> {
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_SECONDS * 1000);
  await prisma.refreshToken.create({
    data: { token, userId, expiresAt },
  });
}

// ─── Validation schemas ───

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required'),
  inviteToken: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ─── Helpers ───

function validationError(reply: FastifyReply, message: string) {
  return reply.status(422).send({
    error: {
      code: 'VALIDATION_ERROR',
      message,
      statusCode: 422,
    },
  });
}

function userResponse(user: { id: string; email: string; name: string; role: string }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  };
}

// ─── Plugin ───

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // Apply stricter rate limit to all auth routes (10 req/min)
  fastify.addHook('onRoute', (routeOptions) => {
    routeOptions.config = {
      ...routeOptions.config,
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
      },
    };
  });

  // ── POST /register ──

  fastify.post(
    '/register',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = registerSchema.safeParse(request.body);
      if (!parsed.success) {
        const firstError = parsed.error.errors[0]?.message ?? 'Invalid input';
        return validationError(reply, firstError);
      }

      const { email, password, name } = parsed.data;

      // Check email uniqueness
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.status(409).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'A user with this email already exists',
            statusCode: 409,
          },
        });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          name,
          passwordHash,
          role: 'user',
          status: 'active',
        },
      });

      // Generate tokens
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken();
      await storeRefreshToken(user.id, refreshToken);

      return reply.status(201).send({
        accessToken,
        refreshToken,
        user: userResponse(user),
      });
    },
  );

  // ── POST /login ──

  fastify.post(
    '/login',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        const firstError = parsed.error.errors[0]?.message ?? 'Invalid input';
        return validationError(reply, firstError);
      }

      const { email, password } = parsed.data;

      // Find user
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return reply.status(401).send({
          error: {
            code: 'AUTH_INVALID_CREDENTIALS',
            message: 'Invalid email or password',
            statusCode: 401,
          },
        });
      }

      // Check password
      const passwordValid = await bcrypt.compare(password, user.passwordHash);
      if (!passwordValid) {
        return reply.status(401).send({
          error: {
            code: 'AUTH_INVALID_CREDENTIALS',
            message: 'Invalid email or password',
            statusCode: 401,
          },
        });
      }

      // Check user status
      if (user.status === 'deactivated') {
        return reply.status(403).send({
          error: {
            code: 'AUTH_INSUFFICIENT_PERMISSIONS',
            message: 'This account has been deactivated',
            statusCode: 403,
          },
        });
      }

      // Update lastActiveAt
      await prisma.user.update({
        where: { id: user.id },
        data: { lastActiveAt: new Date() },
      });

      // Generate tokens
      const accessToken = generateAccessToken(user);
      const refreshToken = generateRefreshToken();
      await storeRefreshToken(user.id, refreshToken);

      return reply.status(200).send({
        accessToken,
        refreshToken,
        user: userResponse(user),
      });
    },
  );

  // ── POST /refresh ──

  fastify.post(
    '/refresh',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = refreshSchema.safeParse(request.body);
      if (!parsed.success) {
        const firstError = parsed.error.errors[0]?.message ?? 'Invalid input';
        return validationError(reply, firstError);
      }

      const { refreshToken } = parsed.data;

      // Find stored token
      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
        include: { user: true },
      });

      if (!storedToken) {
        return reply.status(401).send({
          error: {
            code: 'AUTH_TOKEN_EXPIRED',
            message: 'Invalid refresh token',
            statusCode: 401,
          },
        });
      }

      // Check expiry
      if (storedToken.expiresAt < new Date()) {
        // Clean up expired token
        await prisma.refreshToken.delete({ where: { id: storedToken.id } });
        return reply.status(401).send({
          error: {
            code: 'AUTH_TOKEN_EXPIRED',
            message: 'Refresh token has expired',
            statusCode: 401,
          },
        });
      }

      // Generate new access token
      const accessToken = generateAccessToken(storedToken.user);

      return reply.status(200).send({ accessToken });
    },
  );

  // ── POST /logout ──

  fastify.post(
    '/logout',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = logoutSchema.safeParse(request.body);
      if (!parsed.success) {
        const firstError = parsed.error.errors[0]?.message ?? 'Invalid input';
        return validationError(reply, firstError);
      }

      const { refreshToken } = parsed.data;

      // Delete refresh token (ignore if not found -- idempotent)
      await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });

      return reply.status(200).send({ success: true });
    },
  );
}
