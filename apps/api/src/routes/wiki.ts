import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import prisma from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { requireMinRole, getOrgId } from '../middleware/rbac.js';
import { logActivity } from '../lib/activity-logger.js';
import { cacheGet, cacheSet, cacheInvalidate, cacheKey } from '../lib/cache.js';

// ─── Cyrillic transliteration map ───

const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh',
  з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

function generateSlug(text: string): string {
  return text
    .toLowerCase()
    .split('')
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

async function uniqueSlug(
  baseSlug: string,
  organizationId: string,
  model: 'wikiCategory' | 'wikiArticle',
  excludeId?: string,
): Promise<string> {
  let slug = baseSlug;
  let counter = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const where: Record<string, unknown> = { slug, organizationId };
    if (excludeId) where.id = { not: excludeId };
    const exists = await (prisma[model] as any).findFirst({ where, select: { id: true } });
    if (!exists) return slug;
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

// ─── Zod Schemas ───

const idParamSchema = z.object({
  id: z.string().uuid(),
});

const slugParamSchema = z.object({
  slug: z.string().min(1),
});

// Categories
const createCategorySchema = z.object({
  name: z.string().min(1).max(100).trim(),
  parentId: z.string().uuid().optional(),
  icon: z.string().max(10).optional(),
  description: z.string().max(500).trim().optional(),
});

const updateCategorySchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  icon: z.string().max(10).optional(),
  description: z.string().max(500).trim().optional(),
  order: z.number().int().min(0).optional(),
  parentId: z.string().uuid().nullable().optional(),
});

// Articles
const listArticlesSchema = z.object({
  categoryId: z.string().uuid().optional(),
  type: z.enum(['article', 'case_study']).optional(),
  status: z.enum(['draft', 'published']).optional(),
  search: z.string().optional(),
  tagId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const createArticleSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  content: z.any(),
  categoryId: z.string().uuid(),
  type: z.enum(['article', 'case_study']).default('article'),
  status: z.enum(['draft', 'published']).default('draft'),
  caseProblem: z.string().max(2000).trim().optional(),
  caseSolution: z.string().max(2000).trim().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
}).refine(
  (data) => data.type !== 'case_study' || (data.caseProblem && data.caseSolution),
  { message: 'caseProblem and caseSolution are required for case_study type', path: ['caseProblem'] },
);

const updateArticleSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  content: z.any().optional(),
  categoryId: z.string().uuid().optional(),
  type: z.enum(['article', 'case_study']).optional(),
  status: z.enum(['draft', 'published']).optional(),
  caseProblem: z.string().max(2000).trim().nullable().optional(),
  caseSolution: z.string().max(2000).trim().nullable().optional(),
  tagIds: z.array(z.string().uuid()).optional(),
});

// Wiki tags
const createWikiTagSchema = z.object({
  name: z.string().min(1).max(50).trim(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
});

// ─── Helpers ───

function sendError(reply: FastifyReply, code: string, message: string, statusCode: number) {
  return reply.status(statusCode).send({
    error: { code, message, statusCode },
  });
}

const isAdmin = (request: FastifyRequest) =>
  request.user.role === 'admin' || request.user.role === 'superadmin';

// ─── Plugin ───

export default async function wikiRoutes(fastify: FastifyInstance): Promise<void> {
  const authPreHandlers = [authenticate];
  const adminPreHandlers = [authenticate, requireMinRole('admin')];

  // ═══════════════════════════════════════════════════
  //  CATEGORIES
  // ═══════════════════════════════════════════════════

  // ─── GET /wiki/categories ───

  fastify.get(
    '/wiki/categories',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const ck = cacheKey(organizationId, 'wiki-categories');
      const cached = await cacheGet(ck);
      if (cached) return reply.send(cached);

      const categories = await prisma.wikiCategory.findMany({
        where: { organizationId },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { articles: true } },
        },
      });

      // Build tree: root categories with nested children
      const roots = categories.filter((c) => !c.parentId);
      const tree = roots.map((root) => ({
        ...root,
        children: categories
          .filter((c) => c.parentId === root.id)
          .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
      }));

      const response = { categories: tree };
      await cacheSet(ck, response, 60);
      return reply.send(response);
    },
  );

  // ─── POST /wiki/categories ───

  fastify.post(
    '/wiki/categories',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const parsed = createCategorySchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { name, parentId, icon, description } = parsed.data;

      // Validate depth: parent must be a root category
      if (parentId) {
        const parent = await prisma.wikiCategory.findFirst({
          where: { id: parentId, organizationId },
        });
        if (!parent) {
          return sendError(reply, 'RESOURCE_NOT_FOUND', 'Parent category not found', 404);
        }
        if (parent.parentId) {
          return sendError(reply, 'VALIDATION_ERROR', 'Cannot nest deeper than 2 levels', 422);
        }
      }

      const slug = await uniqueSlug(generateSlug(name), organizationId, 'wikiCategory');

      const category = await prisma.wikiCategory.create({
        data: { name, slug, icon, description, parentId, organizationId },
      });

      await cacheInvalidate(cacheKey(organizationId, 'wiki-categories'));

      await logActivity({
        category: 'wiki',
        action: 'category_created',
        description: `Wiki category "${name}" created`,
        targetType: 'wiki_category',
        targetId: category.id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
      }).catch(() => {});

      return reply.status(201).send(category);
    },
  );

  // ─── PATCH /wiki/categories/:id ───

  fastify.patch(
    '/wiki/categories/:id',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid category id', 422);
      }

      const bodyParsed = updateCategorySchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', bodyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.wikiCategory.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Category not found', 404);
      }

      const { name, icon, description, order, parentId } = bodyParsed.data;

      // Validate depth if parentId is changing
      if (parentId !== undefined && parentId !== null) {
        const parent = await prisma.wikiCategory.findFirst({
          where: { id: parentId, organizationId },
        });
        if (!parent) {
          return sendError(reply, 'RESOURCE_NOT_FOUND', 'Parent category not found', 404);
        }
        if (parent.parentId) {
          return sendError(reply, 'VALIDATION_ERROR', 'Cannot nest deeper than 2 levels', 422);
        }
        // Cannot make parent of itself
        if (parentId === id) {
          return sendError(reply, 'VALIDATION_ERROR', 'Category cannot be its own parent', 422);
        }
      }

      const updateData: Record<string, unknown> = {};
      if (name !== undefined) {
        updateData.name = name;
        updateData.slug = await uniqueSlug(generateSlug(name), organizationId, 'wikiCategory', id);
      }
      if (icon !== undefined) updateData.icon = icon;
      if (description !== undefined) updateData.description = description;
      if (order !== undefined) updateData.order = order;
      if (parentId !== undefined) updateData.parentId = parentId;

      const updated = await prisma.wikiCategory.update({
        where: { id },
        data: updateData,
      });

      await cacheInvalidate(cacheKey(organizationId, 'wiki-categories'));

      await logActivity({
        category: 'wiki',
        action: 'category_updated',
        description: `Wiki category "${updated.name}" updated`,
        targetType: 'wiki_category',
        targetId: id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
      }).catch(() => {});

      return reply.send(updated);
    },
  );

  // ─── DELETE /wiki/categories/:id ───

  fastify.delete(
    '/wiki/categories/:id',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid category id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.wikiCategory.findFirst({
        where: { id, organizationId },
        include: {
          _count: { select: { articles: true, children: true } },
        },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Category not found', 404);
      }

      if (existing._count.articles > 0 || existing._count.children > 0) {
        return sendError(reply, 'VALIDATION_ERROR', 'Cannot delete category that contains articles or subcategories', 422);
      }

      await prisma.wikiCategory.delete({ where: { id } });

      await cacheInvalidate(cacheKey(organizationId, 'wiki-categories'));

      await logActivity({
        category: 'wiki',
        action: 'category_deleted',
        description: `Wiki category "${existing.name}" deleted`,
        targetType: 'wiki_category',
        targetId: id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
      }).catch(() => {});

      return reply.status(204).send();
    },
  );

  // ═══════════════════════════════════════════════════
  //  ARTICLES
  // ═══════════════════════════════════════════════════

  // ─── GET /wiki/articles ───

  fastify.get(
    '/wiki/articles',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const parsed = listArticlesSchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { categoryId, type, status, search, tagId, page, limit } = parsed.data;

      const where: Record<string, unknown> = { organizationId, deletedAt: null };
      if (categoryId) where.categoryId = categoryId;
      if (type) where.type = type;
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { title: { contains: search, mode: 'insensitive' } },
          { caseProblem: { contains: search, mode: 'insensitive' } },
          { caseSolution: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (tagId) {
        where.tags = { some: { tagId } };
      }

      const skip = (page - 1) * limit;

      const [articles, total] = await Promise.all([
        prisma.wikiArticle.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }],
          skip,
          take: limit,
          include: {
            author: { select: { id: true, name: true } },
            category: { select: { id: true, name: true, slug: true, parentId: true, parent: { select: { id: true, name: true, slug: true } } } },
            tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
          },
        }),
        prisma.wikiArticle.count({ where }),
      ]);

      return reply.send({
        articles: articles.map((a) => ({
          ...a,
          tags: a.tags.map((t) => t.tag),
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    },
  );

  // ─── GET /wiki/articles/:slug ───

  fastify.get(
    '/wiki/articles/:slug',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const paramsParsed = slugParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid slug', 422);
      }

      const { slug } = paramsParsed.data;

      const article = await prisma.wikiArticle.findFirst({
        where: { slug, organizationId, deletedAt: null },
        include: {
          author: { select: { id: true, name: true } },
          updatedBy: { select: { id: true, name: true } },
          category: {
            select: {
              id: true, name: true, slug: true, parentId: true,
              parent: { select: { id: true, name: true, slug: true } },
            },
          },
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        },
      });

      if (!article) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Article not found', 404);
      }

      // Increment view count (fire and forget)
      prisma.wikiArticle.update({
        where: { id: article.id },
        data: { viewCount: { increment: 1 } },
      }).catch(() => {});

      return reply.send({
        ...article,
        tags: article.tags.map((t) => t.tag),
      });
    },
  );

  // ─── POST /wiki/articles ───

  fastify.post(
    '/wiki/articles',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const parsed = createArticleSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { title, content, categoryId, type, status, caseProblem, caseSolution, tagIds } = parsed.data;

      // Verify category belongs to org
      const category = await prisma.wikiCategory.findFirst({
        where: { id: categoryId, organizationId },
      });
      if (!category) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Category not found', 404);
      }

      const slug = await uniqueSlug(generateSlug(title), organizationId, 'wikiArticle');

      const article = await prisma.wikiArticle.create({
        data: {
          title,
          slug,
          content,
          type,
          status,
          caseProblem: type === 'case_study' ? caseProblem : null,
          caseSolution: type === 'case_study' ? caseSolution : null,
          categoryId,
          authorId: request.user.id,
          organizationId,
          ...(tagIds?.length ? {
            tags: {
              create: tagIds.map((tagId) => ({ tagId })),
            },
          } : {}),
        },
        include: {
          author: { select: { id: true, name: true } },
          category: { select: { id: true, name: true, slug: true } },
          tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
        },
      });

      await logActivity({
        category: 'wiki',
        action: 'article_created',
        description: `Wiki ${type === 'case_study' ? 'case' : 'article'} "${title}" created`,
        targetType: 'wiki_article',
        targetId: article.id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
      }).catch(() => {});

      return reply.status(201).send({
        ...article,
        tags: article.tags.map((t) => t.tag),
      });
    },
  );

  // ─── PATCH /wiki/articles/:id ───

  fastify.patch(
    '/wiki/articles/:id',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid article id', 422);
      }

      const bodyParsed = updateArticleSchema.safeParse(request.body);
      if (!bodyParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', bodyParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.wikiArticle.findFirst({
        where: { id, organizationId, deletedAt: null },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Article not found', 404);
      }

      // Permission check: author or admin
      if (!isAdmin(request) && existing.authorId !== request.user.id) {
        return sendError(reply, 'AUTH_INSUFFICIENT_PERMISSIONS', 'You can only edit your own articles', 403);
      }

      const { title, content, categoryId, type, status, caseProblem, caseSolution, tagIds } = bodyParsed.data;

      // Verify category if changing
      if (categoryId && categoryId !== existing.categoryId) {
        const cat = await prisma.wikiCategory.findFirst({ where: { id: categoryId, organizationId } });
        if (!cat) {
          return sendError(reply, 'RESOURCE_NOT_FOUND', 'Category not found', 404);
        }
      }

      const updateData: Record<string, unknown> = { updatedById: request.user.id };
      if (title !== undefined) updateData.title = title;
      // Slug stays the same — immutable after creation
      if (content !== undefined) updateData.content = content;
      if (categoryId !== undefined) updateData.categoryId = categoryId;
      if (type !== undefined) updateData.type = type;
      if (status !== undefined) updateData.status = status;
      if (caseProblem !== undefined) updateData.caseProblem = caseProblem;
      if (caseSolution !== undefined) updateData.caseSolution = caseSolution;

      const updated = await prisma.$transaction(async (tx) => {
        if (tagIds !== undefined) {
          await tx.wikiArticleTag.deleteMany({ where: { articleId: id } });
          if (tagIds.length > 0) {
            await tx.wikiArticleTag.createMany({
              data: tagIds.map((tagId) => ({ articleId: id, tagId })),
              skipDuplicates: true,
            });
          }
        }

        return tx.wikiArticle.update({
          where: { id },
          data: updateData,
          include: {
            author: { select: { id: true, name: true } },
            category: { select: { id: true, name: true, slug: true } },
            tags: { include: { tag: { select: { id: true, name: true, color: true } } } },
          },
        });
      });

      await logActivity({
        category: 'wiki',
        action: 'article_updated',
        description: `Wiki article "${updated.title}" updated`,
        targetType: 'wiki_article',
        targetId: id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
      }).catch(() => {});

      return reply.send({
        ...updated,
        tags: updated.tags.map((t) => t.tag),
      });
    },
  );

  // ─── DELETE /wiki/articles/:id ───

  fastify.delete(
    '/wiki/articles/:id',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid article id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.wikiArticle.findFirst({
        where: { id, organizationId, deletedAt: null },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Article not found', 404);
      }

      // Soft delete
      await prisma.wikiArticle.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      await logActivity({
        category: 'wiki',
        action: 'article_deleted',
        description: `Wiki article "${existing.title}" deleted`,
        targetType: 'wiki_article',
        targetId: id,
        userId: request.user.id,
        userName: request.user.name,
        organizationId,
      }).catch(() => {});

      return reply.status(204).send();
    },
  );

  // ═══════════════════════════════════════════════════
  //  WIKI TAGS
  // ═══════════════════════════════════════════════════

  // ─── GET /wiki/tags ───

  fastify.get(
    '/wiki/tags',
    { preHandler: authPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const tags = await prisma.wikiTag.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
      });

      return reply.send({ tags });
    },
  );

  // ─── POST /wiki/tags ───

  fastify.post(
    '/wiki/tags',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const parsed = createWikiTagSchema.safeParse(request.body);
      if (!parsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '), 422);
      }

      const { name, color } = parsed.data;

      // Check uniqueness
      const existing = await prisma.wikiTag.findFirst({
        where: { name, organizationId },
      });
      if (existing) {
        return sendError(reply, 'VALIDATION_ERROR', `Tag "${name}" already exists`, 422);
      }

      const tag = await prisma.wikiTag.create({
        data: { name, color, organizationId },
      });

      return reply.status(201).send(tag);
    },
  );

  // ─── DELETE /wiki/tags/:id ───

  fastify.delete(
    '/wiki/tags/:id',
    { preHandler: adminPreHandlers },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const paramsParsed = idParamSchema.safeParse(request.params);
      if (!paramsParsed.success) {
        return sendError(reply, 'VALIDATION_ERROR', 'Invalid tag id', 422);
      }

      const { id } = paramsParsed.data;
      const organizationId = getOrgId(request);
      if (!organizationId) {
        return sendError(reply, 'VALIDATION_ERROR', 'Organization context is required', 400);
      }

      const existing = await prisma.wikiTag.findFirst({
        where: { id, organizationId },
      });
      if (!existing) {
        return sendError(reply, 'RESOURCE_NOT_FOUND', 'Tag not found', 404);
      }

      await prisma.wikiTag.delete({ where: { id } });

      return reply.status(204).send();
    },
  );
}
