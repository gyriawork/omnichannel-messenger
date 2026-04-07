import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { requireMinRole, getOrgId } from '../middleware/rbac.js';
import { logActivity } from '../lib/activity-logger.js';

// ─── Zod Schemas ───

const updateWorkspaceBodySchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
  timezone: z.string().min(1).max(100).trim().optional(),
  defaultLanguage: z.string().min(2).max(10).trim().optional(),
  chatVisibilityAll: z.boolean().optional(),
});

// ─── Helpers ───

function sendError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.status(statusCode).send({
    error: { code, message, statusCode },
  });
}

// ─── Plugin ───

export default async function workspaceSettingsRoutes(fastify: FastifyInstance): Promise<void> {
  const authPreHandlers = [authenticate];
  const adminPreHandlers = [authenticate, requireMinRole('admin')];

  // ─── GET /settings/workspace ───

  fastify.get(
    '/settings/workspace',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const org = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: {
          id: true,
          name: true,
          logo: true,
          defaultLanguage: true,
          timezone: true,
          chatVisibilityAll: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!org) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Organization not found', 404);
      }

      return reply.send(org);
    },
  );

  // ─── PATCH /settings/workspace ───

  fastify.patch(
    '/settings/workspace',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const parsed = updateWorkspaceBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { name, timezone, defaultLanguage, chatVisibilityAll } = parsed.data;
      if (name === undefined && timezone === undefined && defaultLanguage === undefined && chatVisibilityAll === undefined) {
        return sendError(reply, 'VALIDATION_ERROR', 'At least one field must be provided for update', 422);
      }

      const existing = await prisma.organization.findUnique({
        where: { id: organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Organization not found', 404);
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) updateData.name = name;
      if (timezone !== undefined) updateData.timezone = timezone;
      if (defaultLanguage !== undefined) updateData.defaultLanguage = defaultLanguage;
      if (chatVisibilityAll !== undefined) updateData.chatVisibilityAll = chatVisibilityAll;

      const updated = await prisma.organization.update({
        where: { id: organizationId },
        data: updateData,
        select: {
          id: true,
          name: true,
          logo: true,
          defaultLanguage: true,
          timezone: true,
          chatVisibilityAll: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      // Build change description
      const changedFields = Object.keys(parsed.data).filter(
        (k) => parsed.data[k as keyof typeof parsed.data] !== undefined,
      );

      await logActivity({
        category: 'settings',
        action: 'updated',
        description: `Workspace settings updated: ${changedFields.join(', ')}`,
        targetType: 'organization',
        targetId: organizationId,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
        metadata: { changedFields, previous: { name: existing.name, timezone: existing.timezone, defaultLanguage: existing.defaultLanguage, chatVisibilityAll: existing.chatVisibilityAll } },
      }).catch(() => { /* non-critical */ });

      return reply.send(updated);
    },
  );
}
