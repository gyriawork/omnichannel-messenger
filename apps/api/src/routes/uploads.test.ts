import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { createServer } from '../server';

describe('Uploads Routes', () => {
  let server: FastifyInstance;
  let prisma: PrismaClient;
  let orgId: string;
  let userId: string;
  let token: string;
  let otherUserId: string;
  let otherToken: string;

  beforeAll(async () => {
    server = await createServer();
    prisma = new PrismaClient();

    // Create organization
    const org = await prisma.organization.create({
      data: {
        id: 'test-org-uploads',
        name: 'Upload Test Org',
        defaultLanguage: 'en',
        timezone: 'UTC',
        status: 'active',
      },
    });
    orgId = org.id;

    // Create primary user
    const passwordHash = await bcrypt.hash('password123', 12);
    const user = await prisma.user.create({
      data: {
        email: 'uploader@test.com',
        name: 'File Uploader',
        passwordHash,
        role: 'user',
        status: 'active',
        organizationId: orgId,
      },
    });
    userId = user.id;

    // Create other user for permission testing
    const otherUser = await prisma.user.create({
      data: {
        email: 'other-uploader@test.com',
        name: 'Other Uploader',
        passwordHash,
        role: 'user',
        status: 'active',
        organizationId: orgId,
      },
    });
    otherUserId = otherUser.id;

    // Generate tokens
    token = server.jwt.sign({ userId, orgId }, { expiresIn: '15m' });
    otherToken = server.jwt.sign({ userId: otherUserId, orgId }, { expiresIn: '15m' });
  });

  afterAll(async () => {
    await prisma.upload.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
    await server.close();
  });

  beforeEach(async () => {
    await prisma.upload.deleteMany({ where: { organizationId: orgId } });
  });

  describe('POST /api/uploads', () => {
    it('should upload file successfully', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          filename: 'document.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          buffer: Buffer.from('test file content').toString('base64'),
        },
      });

      expect(response.statusCode).toBe(201);
      const data = response.json();
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('filename', 'document.pdf');
      expect(data).toHaveProperty('mimeType', 'application/pdf');
      expect(data).toHaveProperty('size', 1024);
      expect(data).toHaveProperty('uploadedBy', userId);
    });

    it('should reject missing filename', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          mimeType: 'application/pdf',
          size: 1024,
          buffer: Buffer.from('test file content').toString('base64'),
        },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should reject oversized files (>50MB)', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          filename: 'huge.bin',
          mimeType: 'application/octet-stream',
          size: 51 * 1024 * 1024, // 51MB
          buffer: Buffer.from('x').toString('base64'),
        },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should reject invalid MIME types', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          filename: 'script.exe',
          mimeType: 'application/x-msdownload',
          size: 512,
          buffer: Buffer.from('malware').toString('base64'),
        },
      });

      expect(response.statusCode).toBe(422);
    });

    it('should reject unauthenticated requests', async () => {
      const response = await server.inject({
        method: 'POST',
        url: '/api/uploads',
        payload: {
          filename: 'document.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          buffer: Buffer.from('test').toString('base64'),
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should enforce rate limiting (10 uploads/min)', async () => {
      for (let i = 0; i < 10; i++) {
        await server.inject({
          method: 'POST',
          url: '/api/uploads',
          headers: { authorization: `Bearer ${token}` },
          payload: {
            filename: `file${i}.txt`,
            mimeType: 'text/plain',
            size: 100,
            buffer: Buffer.from(`content${i}`).toString('base64'),
          },
        });
      }

      const response = await server.inject({
        method: 'POST',
        url: '/api/uploads',
        headers: { authorization: `Bearer ${token}` },
        payload: {
          filename: 'eleventh.txt',
          mimeType: 'text/plain',
          size: 100,
          buffer: Buffer.from('content').toString('base64'),
        },
      });

      expect(response.statusCode).toBe(429);
    });
  });

  describe('GET /api/uploads/:id', () => {
    let uploadId: string;

    beforeEach(async () => {
      const upload = await prisma.upload.create({
        data: {
          filename: 'test.pdf',
          mimeType: 'application/pdf',
          size: 2048,
          uploadedById: userId,
          organizationId: orgId,
        },
      });
      uploadId = upload.id;
    });

    it('should retrieve upload metadata', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/uploads/${uploadId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.id).toBe(uploadId);
      expect(data.filename).toBe('test.pdf');
      expect(data.uploadedBy).toBe(userId);
    });

    it('should reject unauthenticated access', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/uploads/${uploadId}`,
      });

      expect(response.statusCode).toBe(401);
    });

    it('should return 404 for nonexistent upload', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/uploads/nonexistent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });

    it('should enforce organization isolation', async () => {
      // Create upload in different org
      const otherOrg = await prisma.organization.create({
        data: {
          id: 'other-org-uploads',
          name: 'Other Org',
          defaultLanguage: 'en',
          timezone: 'UTC',
          status: 'active',
        },
      });

      const otherOrgUser = await prisma.user.create({
        data: {
          email: 'other-org-user@test.com',
          name: 'Other Org User',
          passwordHash: await bcrypt.hash('password', 12),
          role: 'user',
          status: 'active',
          organizationId: otherOrg.id,
        },
      });

      const otherOrgUpload = await prisma.upload.create({
        data: {
          filename: 'other-org-file.pdf',
          mimeType: 'application/pdf',
          size: 512,
          uploadedById: otherOrgUser.id,
          organizationId: otherOrg.id,
        },
      });

      const otherOrgToken = server.jwt.sign({ userId: otherOrgUser.id, orgId: otherOrg.id }, { expiresIn: '15m' });

      // Try to access from different org
      const response = await server.inject({
        method: 'GET',
        url: `/api/uploads/${otherOrgUpload.id}`,
        headers: { authorization: `Bearer ${token}` }, // token from first org
      });

      expect(response.statusCode).toBe(404);

      // Cleanup
      await prisma.upload.delete({ where: { id: otherOrgUpload.id } });
      await prisma.user.delete({ where: { id: otherOrgUser.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    });
  });

  describe('DELETE /api/uploads/:id', () => {
    let uploadId: string;

    beforeEach(async () => {
      const upload = await prisma.upload.create({
        data: {
          filename: 'deletable.pdf',
          mimeType: 'application/pdf',
          size: 1024,
          uploadedById: userId,
          organizationId: orgId,
        },
      });
      uploadId = upload.id;
    });

    it('should delete upload by owner', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/uploads/${uploadId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(204);

      // Verify deletion
      const checkResponse = await server.inject({
        method: 'GET',
        url: `/api/uploads/${uploadId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(checkResponse.statusCode).toBe(404);
    });

    it('should allow admin to delete any upload', async () => {
      const adminHash = await bcrypt.hash('admin123', 12);
      const admin = await prisma.user.create({
        data: {
          email: 'admin-uploader@test.com',
          name: 'Admin',
          passwordHash: adminHash,
          role: 'admin',
          status: 'active',
          organizationId: orgId,
        },
      });

      const adminToken = server.jwt.sign({ userId: admin.id, orgId }, { expiresIn: '15m' });

      const response = await server.inject({
        method: 'DELETE',
        url: `/api/uploads/${uploadId}`,
        headers: { authorization: `Bearer ${adminToken}` },
      });

      expect(response.statusCode).toBe(204);

      await prisma.user.delete({ where: { id: admin.id } });
    });

    it('should reject deletion by non-owner non-admin', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: `/api/uploads/${uploadId}`,
        headers: { authorization: `Bearer ${otherToken}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('should return 404 for nonexistent upload', async () => {
      const response = await server.inject({
        method: 'DELETE',
        url: '/api/uploads/nonexistent-id',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/uploads', () => {
    beforeEach(async () => {
      await prisma.upload.createMany({
        data: [
          {
            filename: 'file1.pdf',
            mimeType: 'application/pdf',
            size: 1024,
            uploadedById: userId,
            organizationId: orgId,
          },
          {
            filename: 'file2.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: 2048,
            uploadedById: userId,
            organizationId: orgId,
          },
          {
            filename: 'file3.png',
            mimeType: 'image/png',
            size: 512,
            uploadedById: otherUserId,
            organizationId: orgId,
          },
        ],
      });
    });

    it('should list all uploads for organization', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/uploads',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(Array.isArray(data.uploads)).toBe(true);
      expect(data.uploads.length).toBe(3);
    });

    it('should filter by uploadedBy user', async () => {
      const response = await server.inject({
        method: 'GET',
        url: `/api/uploads?uploadedBy=${userId}`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.uploads.length).toBe(2);
      expect(data.uploads.every((u: any) => u.uploadedBy === userId)).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/api/uploads?limit=2',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.uploads.length).toBe(2);
      expect(data.cursor).toBeDefined();
    });

    it('should enforce organization isolation in listing', async () => {
      const otherOrg = await prisma.organization.create({
        data: {
          id: 'other-org-list',
          name: 'Other Org',
          defaultLanguage: 'en',
          timezone: 'UTC',
          status: 'active',
        },
      });

      const otherOrgUser = await prisma.user.create({
        data: {
          email: 'list-other-user@test.com',
          name: 'Other Org Lister',
          passwordHash: await bcrypt.hash('password', 12),
          role: 'user',
          status: 'active',
          organizationId: otherOrg.id,
        },
      });

      // Create upload in other org
      await prisma.upload.create({
        data: {
          filename: 'other-org-file.pdf',
          mimeType: 'application/pdf',
          size: 256,
          uploadedById: otherOrgUser.id,
          organizationId: otherOrg.id,
        },
      });

      const otherOrgToken = server.jwt.sign({ userId: otherOrgUser.id, orgId: otherOrg.id }, { expiresIn: '15m' });

      // List should only show current org uploads
      const response = await server.inject({
        method: 'GET',
        url: '/api/uploads',
        headers: { authorization: `Bearer ${token}` },
      });

      expect(response.statusCode).toBe(200);
      const data = response.json();
      expect(data.uploads.length).toBe(3); // Only from first org
      expect(data.uploads.every((u: any) => u.organizationId === orgId)).toBe(true);

      // Cleanup
      await prisma.upload.deleteMany({ where: { organizationId: otherOrg.id } });
      await prisma.user.delete({ where: { id: otherOrgUser.id } });
      await prisma.organization.delete({ where: { id: otherOrg.id } });
    });
  });
});
