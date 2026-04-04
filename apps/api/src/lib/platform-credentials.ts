// ─── Platform Credentials Resolver ───
// Resolves platform-level credentials (API keys, OAuth client secrets) for each messenger.
// Resolution order: DB (PlatformConfig) → env vars → null.
// Results cached in-memory with 60s TTL.

import prisma from './prisma.js';
import { decryptCredentials } from './crypto.js';
import { MESSENGER_ENV_VARS } from '@omnichannel/shared';
import type { Messenger } from '@omnichannel/shared';

interface CacheEntry {
  data: Record<string, string> | null;
  source: 'database' | 'env' | 'none_required' | null;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 60_000;

export interface PlatformCredentialsResult {
  credentials: Record<string, string> | null;
  source: 'database' | 'env' | 'none_required' | null;
}

/**
 * Resolve platform credentials for a messenger.
 * 1. Check in-memory cache
 * 2. Query PlatformConfig table → decrypt
 * 3. Fallback to env vars
 * 4. Return null if not configured
 */
export async function getPlatformCredentials(
  messenger: string,
): Promise<PlatformCredentialsResult> {
  // WhatsApp needs no platform credentials
  const envMap = MESSENGER_ENV_VARS[messenger as Messenger] ?? {};
  if (messenger === 'whatsapp' || Object.keys(envMap).length === 0) {
    return { credentials: null, source: 'none_required' };
  }

  // Check cache
  const cached = cache.get(messenger);
  if (cached && cached.expiresAt > Date.now()) {
    return { credentials: cached.data, source: cached.source };
  }

  // Query DB
  const config = await prisma.platformConfig.findUnique({
    where: { messenger },
  });

  if (config && config.enabled) {
    const decrypted = decryptCredentials<Record<string, string>>(config.credentials as string);
    const entry: CacheEntry = { data: decrypted, source: 'database', expiresAt: Date.now() + TTL_MS };
    cache.set(messenger, entry);
    return { credentials: decrypted, source: 'database' };
  }

  // Fallback to env vars
  const fromEnv: Record<string, string> = {};
  let allFound = true;
  for (const [field, envVar] of Object.entries(envMap)) {
    const val = process.env[envVar];
    if (val) {
      fromEnv[field] = val;
    } else {
      allFound = false;
    }
  }

  if (allFound) {
    const entry: CacheEntry = { data: fromEnv, source: 'env', expiresAt: Date.now() + TTL_MS };
    cache.set(messenger, entry);
    return { credentials: fromEnv, source: 'env' };
  }

  // Not configured
  const entry: CacheEntry = { data: null, source: null, expiresAt: Date.now() + TTL_MS };
  cache.set(messenger, entry);
  return { credentials: null, source: null };
}

/** Invalidate cache for a specific messenger or all. */
export function invalidatePlatformCache(messenger?: string): void {
  if (messenger) {
    cache.delete(messenger);
  } else {
    cache.clear();
  }
}
