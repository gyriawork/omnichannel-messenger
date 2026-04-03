import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { requireMinRole, getOrgId } from '../middleware/rbac.js';
import { logActivity } from '../lib/activity-logger.js';
import { cacheGet, cacheSet, cacheInvalidate, cacheKey } from '../lib/cache.js';

// ─── Zod Schemas ───

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const listQuerySchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createTemplateBodySchema = z.object({
  name: z.string().min(1).max(255).trim(),
  messageText: z.string().min(1).max(10000).trim(),
});

const updateTemplateBodySchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  messageText: z.string().min(1).max(10000).trim().optional(),
});

// ─── Helpers ───

function sendError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.status(statusCode).send({
    error: { code, message, statusCode },
  });
}

// ─── Plugin ───

export default async function templateRoutes(fastify: FastifyInstance): Promise<void> {
  const authPreHandlers = [authenticate];
  const adminPreHandlers = [authenticate, requireMinRole('admin')];

  // ─── GET /templates ───

  fastify.get(
    '/templates',
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

      const { search, page, limit } = parsed.data;

      const ck = cacheKey(organizationId, 'templates', `p${page}`, `l${limit}`, search ?? '');
      const cached = await cacheGet(ck);
      if (cached) {
        return reply.send(cached);
      }

      const skip = (page - 1) * limit;

      const where: Record<string, unknown> = { organizationId };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { messageText: { contains: search, mode: 'insensitive' } },
        ];
      }

      const [templates, total] = await Promise.all([
        prisma.template.findMany({
          where,
          orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
          skip,
          take: limit,
          include: {
            createdBy: { select: { id: true, name: true } },
          },
        }),
        prisma.template.count({ where }),
      ]);

      const response = {
        templates,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
      await cacheSet(ck, response, 300);

      return reply.send(response);
    },
  );

  // ─── POST /templates ───

  fastify.post(
    '/templates',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const parsed = createTemplateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { name, messageText } = parsed.data;

      const template = await prisma.template.create({
        data: {
          name,
          messageText,
          organizationId,
          createdById: request.user.id,
        },
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      });

      await cacheInvalidate(cacheKey(organizationId, 'templates') + '*');

      await logActivity({
        category: 'templates',
        action: 'created',
        description: `Template "${name}" created`,
        targetType: 'template',
        targetId: template.id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
      }).catch(() => { /* non-critical */ });

      return reply.status(201).send(template);
    },
  );

  // ─── PATCH /templates/:id ───

  fastify.patch(
    '/templates/:id',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid template id', 422);
      }

      const bodyParsed = updateTemplateBodySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', bodyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { name, messageText } = bodyParsed.data;
      if (name === undefined && messageText === undefined) {
        return sendError(reply, 'VALIDATION_ERROR', 'At least one field must be provided for update', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.template.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Template with id ${id} not found`, 404);
      }

      // Non-admin users can only edit their own templates
      const isAdmin = request.user.role === 'admin' || request.user.role === 'superadmin';
      if (!isAdmin && existing.createdById !== request.user.id) {
        return sendError(reply, 'AUTH_INSUFFICIENT_PERMISSIONS', 'You can only edit your own templates', 403);
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (messageText !== undefined) updateData.messageText = messageText;

      const updated = await prisma.template.update({
        where: { id },
        data: updateData,
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      });

      await cacheInvalidate(cacheKey(organizationId, 'templates') + '*');

      await logActivity({
        category: 'templates',
        action: 'updated',
        description: `Template "${updated.name}" updated`,
        targetType: 'template',
        targetId: id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
      }).catch(() => { /* non-critical */ });

      return reply.send(updated);
    },
  );

  // ─── DELETE /templates/:id ───

  fastify.delete(
    '/templates/:id',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid template id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.template.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Template with id ${id} not found`, 404);
      }

      // Non-admin users can only delete their own templates
      const isAdmin = request.user.role === 'admin' || request.user.role === 'superadmin';
      if (!isAdmin && existing.createdById !== request.user.id) {
        return sendError(reply, 'AUTH_INSUFFICIENT_PERMISSIONS', 'You can only delete your own templates', 403);
      }

      await prisma.template.delete({ where: { id } });

      await cacheInvalidate(cacheKey(organizationId, 'templates') + '*');

      await logActivity({
        category: 'templates',
        action: 'deleted',
        description: `Template "${existing.name}" deleted`,
        targetType: 'template',
        targetId: id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
      }).catch(() => { /* non-critical */ });

      return reply.status(204).send();
    },
  );

  // ─── POST /templates/:id/duplicate ───

  fastify.post(
    '/templates/:id/duplicate',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid template id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.template.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Template with id ${id} not found`, 404);
      }

      const duplicate = await prisma.template.create({
        data: {
          name: `${existing.name} (Copy)`,
          messageText: existing.messageText,
          usageCount: 0,
          organizationId,
          createdById: request.user.id,
        },
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      });

      await cacheInvalidate(cacheKey(organizationId, 'templates') + '*');

      await logActivity({
        category: 'templates',
        action: 'duplicated',
        description: `Template "${existing.name}" duplicated as "${duplicate.name}"`,
        targetType: 'template',
        targetId: duplicate.id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
        metadata: { sourceTemplateId: id },
      }).catch(() => { /* non-critical */ });

      return reply.status(201).send(duplicate);
    },
  );

  // ─── POST /templates/:id/use ───

  fastify.post(
    '/templates/:id/use',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid template id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.template.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', `Template with id ${id} not found`, 404);
      }

      const updated = await prisma.template.update({
        where: { id },
        data: { usageCount: { increment: 1 } },
        include: {
          createdBy: { select: { id: true, name: true } },
        },
      });

      return reply.send(updated);
    },
  );
}
