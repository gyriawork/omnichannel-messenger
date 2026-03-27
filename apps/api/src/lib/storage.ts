import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import path from 'node:path';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'omnichannel-files';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

// S3-compatible client for Cloudflare R2
const s3 = new S3Client({
  region: 'auto',
  endpoint: R2_ACCOUNT_ID
    ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : 'http://localhost:9000', // local MinIO fallback for dev
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID || (process.env.MINIO_ACCESS_KEY ?? ''),
    secretAccessKey: R2_SECRET_ACCESS_KEY || (process.env.MINIO_SECRET_KEY ?? ''),
  },
});

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  mimeType: string;
  originalName: string;
}

/**
 * Upload a file buffer to R2.
 * Returns the storage key and public URL.
 */
export async function uploadFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string,
  organizationId: string,
): Promise<UploadResult> {
  const ext = path.extname(originalName) || '';
  const key = `${organizationId}/${nanoid(12)}${ext}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      Metadata: {
        'original-name': originalName,
        'organization-id': organizationId,
      },
    }),
  );

  const url = R2_PUBLIC_URL
    ? `${R2_PUBLIC_URL}/${key}`
    : `/${R2_BUCKET}/${key}`;

  return {
    key,
    url,
    size: buffer.length,
    mimeType,
    originalName,
  };
}

/**
 * Generate a signed URL for temporary access to a private file.
 */
export async function getSignedDownloadUrl(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Delete a file from R2.
 */
export async function deleteFile(key: string): Promise<void> {
  await s3.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }),
  );
}
