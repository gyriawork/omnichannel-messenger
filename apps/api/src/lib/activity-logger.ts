import type { Prisma } from '@prisma/client';
import prisma from './prisma.js';

interface LogActivityParams {
  category: string;
  action: string;
  description: string;
  targetType?: string;
  targetId?: string;
  userId?: string;
  userName?: string;
  organizationId: string;
  metadata?: Record<string, unknown>;
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  const { metadata, ...rest } = params;
  await prisma.activityLog.create({
    data: {
      ...rest,
      metadata: metadata ? (metadata as Prisma.InputJsonValue) : undefined,
    },
  });
}
