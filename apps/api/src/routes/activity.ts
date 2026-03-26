import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { getOrgId } from '../middleware/rbac.js';

// ─── Zod Schemas ───

const listQuerySchema = z.object({
  category: z.string().optional(),
  userId: z.string().uuid().optional(),
  startDate: z.string().datetime({ offset: true }).optional(),
  endDate: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Helpers ───

function sendError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.status(statusCode).send({
    error: { code, message, statusCode },
  });
}

// ─── Plugin ───

export default async function activityRoutes(fastify: FastifyInstance): Promise<void> {
  const authPreHandlers = [authenticate];

  // ─── GET /activity ───

  fastify.get(
    '/activity',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const parsed = listQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { category, userId, startDate, endDate, page, limit } = parsed.data;
      const skip = (page - 1) * limit;

      const where: Record<string, unknown> = { organizationId };
      if (category) where.category = category;
      if (userId) where.userId = userId;

      if (startDate || endDate) {
        const createdAt: Record<string, unknown> = {};
        if (startDate) createdAt.gte = new Date(startDate);
        if (endDate) createdAt.lte = new Date(endDate);
        where.createdAt = createdAt;
      }

      const [entries, total] = await Promise.all([
        prisma.activityLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        prisma.activityLog.count({ where }),
      ]);

      return reply.send({
        data: entries,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );
}
