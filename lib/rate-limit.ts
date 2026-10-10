/**
 * Small fixed-window rate limiter.
 *
 * This is a per-process counter, exactly like the one previously inlined in `middleware.ts`: on
 * Vercel each instance keeps its own map, so it is a speed bump rather than a global limit. It is
 * kept deliberately dependency-free and usable from both the Edge middleware and Node route
 * handlers. A shared external store (Redis/Upstash) is still the correct long-term answer; until
 * then this is what stands between an unauthenticated endpoint and unbounded work.
 */

interface Bucket {
  count: number
  expiresAt: number
}

const buckets = new Map<string, Bucket>()

/** Drop closed windows so the map cannot grow without bound. Called on every write. */
function pruneExpired(now: number): void {
  buckets.forEach((bucket, key) => {
    if (now > bucket.expiresAt) buckets.delete(key)
  })
}

export interface RateLimitDecision {
  /** True when this request is over the allowance for the window. */
  limited: boolean
  /** Seconds until the window resets. Zero when not limited. */
  retryAfterSeconds: number
}

/** Count one request against `key` and report whether the caller is now over `limit`. */
export function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitDecision {
  pruneExpired(now)

  const existing = buckets.get(key)

  if (!existing || now > existing.expiresAt) {
    buckets.set(key, { count: 1, expiresAt: now + windowMs })
    return { limited: false, retryAfterSeconds: 0 }
  }

  existing.count++
  buckets.set(key, existing)

  if (existing.count > limit) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - now) / 1000)),
    }
  }

  return { limited: false, retryAfterSeconds: 0 }
}
