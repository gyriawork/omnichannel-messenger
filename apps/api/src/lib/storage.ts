import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { nanoid } from 'nanoid';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'omnichannel-files';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || '';

// Determine if we have cloud storage configured
const hasCloudStorage = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);
const hasMinIO = !!(process.env.MINIO_ACCESS_KEY && process.env.MINIO_SECRET_KEY);

/** When neither R2 nor MinIO is configured, use local filesystem */
export const useLocalStorage = !hasCloudStorage && !hasMinIO;

// Local uploads directory (relative to apps/api)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

// S3-compatible client for Cloudflare R2 (only created when needed)
const s3 = useLocalStorage
  ? (null as unknown as S3Client)
  : new S3Client({
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
 * Upload a file buffer to R2 or local filesystem.
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

  if (useLocalStorage) {
    // Local filesystem fallback
    const filePath = path.join(LOCAL_UPLOADS_DIR, key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, buffer);

    const url = `/api/uploads/files/${key}`;

    return {
      key,
      url,
      size: buffer.length,
      mimeType,
      originalName,
    };
  }

  // Cloud storage (R2 / MinIO)
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      Metadata: {
        'original-name': encodeURIComponent(originalName),
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
  if (useLocalStorage) {
    return `/api/uploads/files/${key}`;
  }

  const command = new GetObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
  });
  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Delete a file from R2 or local filesystem.
 */
export async function deleteFile(key: string): Promise<void> {
  if (useLocalStorage) {
    const filePath = path.join(LOCAL_UPLOADS_DIR, key);
    await fs.unlink(filePath).catch(() => {});
    return;
  }

  await s3.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }),
  );
}

/**
 * Resolve a local file path from a storage key (for local storage mode only).
 */
export function getLocalFilePath(key: string): string {
  return path.join(LOCAL_UPLOADS_DIR, key);
}
