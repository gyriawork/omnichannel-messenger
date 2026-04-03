import IORedis from 'ioredis';

const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379');

/**
 * Get cached JSON value by key. Returns null on miss.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Set cached JSON value with TTL in seconds.
 */
export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

/**
 * Invalidate all cache keys matching a pattern (e.g. "cache:orgId:chats:*").
 * Uses SCAN to avoid blocking Redis.
 */
export async function cacheInvalidate(pattern: string): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
    cursor = nextCursor;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== '0');
}

/**
 * Build a cache key from parts.
 */
export function cacheKey(...parts: string[]): string {
  return `cache:${parts.join(':')}`;
}
