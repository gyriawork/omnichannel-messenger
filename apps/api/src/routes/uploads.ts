import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../middleware/auth.js';
import { requireOrganization, getOrgId } from '../middleware/rbac.js';
import { uploadFile, getSignedDownloadUrl, deleteFile } from '../lib/storage.js';

export default async function uploadRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /uploads — upload a file
  fastify.post(
    '/uploads',
    { preHandler: [authenticate, requireOrganization()] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const orgId = getOrgId(request);

      const data = await request.file();
      if (!data) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'No file provided', statusCode: 400 },
        });
      }

      // Validate file size (10MB max)
      const buffer = await data.toBuffer();
      if (buffer.length > 10 * 1024 * 1024) {
        return reply.status(413).send({
          error: { code: 'VALIDATION_ERROR', message: 'File too large (max 10MB)', statusCode: 413 },
        });
      }

      // Validate mime type
      const allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
        'application/pdf',
        'text/plain', 'text/csv',
        'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/zip', 'application/gzip',
        'video/mp4', 'audio/mpeg', 'audio/ogg',
      ];

      const mimeType = data.mimetype || 'application/octet-stream';
      if (!allowedTypes.includes(mimeType) && !mimeType.startsWith('text/')) {
        return reply.status(415).send({
          error: { code: 'VALIDATION_ERROR', message: `File type ${mimeType} not allowed`, statusCode: 415 },
        });
      }

      try {
        const result = await uploadFile(buffer, data.filename, mimeType, orgId);

        return reply.status(201).send({
          file: {
            key: result.key,
            url: result.url,
            size: result.size,
            mimeType: result.mimeType,
            originalName: result.originalName,
          },
        });
      } catch (err) {
        fastify.log.error(err, 'File upload failed');
        return reply.status(502).send({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to upload file', statusCode: 502 },
        });
      }
    },
  );

  // GET /uploads/signed-url — get signed download URL
  fastify.get(
    '/uploads/signed-url',
    { preHandler: [authenticate] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { key } = request.query as { key: string };

      if (!key) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'File key is required', statusCode: 400 },
        });
      }

      try {
        const url = await getSignedDownloadUrl(key);
        return reply.send({ url });
      } catch (err) {
        return reply.status(404).send({
          error: { code: 'RESOURCE_NOT_FOUND', message: 'File not found', statusCode: 404 },
        });
      }
    },
  );

  // DELETE /uploads — delete a file
  fastify.delete(
    '/uploads',
    { preHandler: [authenticate, requireOrganization()] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { key } = request.query as { key: string };

      if (!key) {
        return reply.status(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'File key is required', statusCode: 400 },
        });
      }

      try {
        await deleteFile(key);
        return reply.status(204).send();
      } catch (err) {
        return reply.status(502).send({
          error: { code: 'INTERNAL_ERROR', message: 'Failed to delete file', statusCode: 502 },
        });
      }
    },
  );
}
