import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { consumeRateLimit } from './lib/rate-limit'

// In-memory rate limiting.
//
// LIMITATION — this is per-instance protection only, not a global limit. The counter lives in
// module-level state inside a single server instance, so on Vercel each concurrent instance keeps
// its own bucket and a cold start or deploy resets every counter. It slows brute force and casual
// abuse but does not stop a determined distributed caller. A true global limit requires a shared
// external store (Redis, Upstash, or equivalent) queried by every instance — an infrastructure
// decision for the project owner. The per-account soft lockout in `lib/auth.ts` covers login from
// a different angle even across instances.
//
// Next.js 16 renamed the `middleware` convention to `proxy` (Node runtime; the Edge runtime is no
// longer used at this boundary). The matcher/config shape is unchanged.

const HOUR_MS = 60 * 60 * 1000
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000

interface RateLimitRule {
  scope: string
  limit: number
  windowMs: number
}

const RULES: Array<{ match: RegExp; rule: RateLimitRule }> = [
  // Payment initiation. Stricter than nothing but generous enough for a real retry.
  { match: /^\/api\/product-page\/[^/]+\/pay$/, rule: { scope: 'pay', limit: 10, windowMs: HOUR_MS } },
  // Sends an email to a caller-supplied address.
  { match: /^\/api\/auth\/reset-password\/request$/, rule: { scope: 'reset-request', limit: 5, windowMs: HOUR_MS } },
  { match: /^\/api\/auth\/reset-password\/confirm$/, rule: { scope: 'reset-confirm', limit: 10, windowMs: HOUR_MS } },
  // Account creation.
  { match: /^\/api\/auth\/register$/, rule: { scope: 'register', limit: 5, windowMs: HOUR_MS } },
  // Credential login (NextAuth callback). Blunts credential stuffing; the DB lockout in
  // `lib/auth.ts` handles per-account failures.
  { match: /^\/api\/auth\/callback\/credentials$/, rule: { scope: 'login', limit: 20, windowMs: FIFTEEN_MINUTES_MS } },
]

function resolveRule(pathname: string): RateLimitRule | null {
  for (const entry of RULES) {
    if (entry.match.test(pathname)) return entry.rule
  }
  return null
}

/** Best-effort client identity from platform-set headers.
 *
 *  `x-real-ip` is set by Vercel and by well-configured proxies and is not client-spoofable there.
 *  `x-forwarded-for` is only used as a fallback because a caller can prepend arbitrary values to
 *  it; the first (left-most) hop is the best approximation available when no trusted header exists. */
function clientIp(request: NextRequest): string {
  const realIp = request.headers.get('x-real-ip')
  if (realIp) return realIp

  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()

  return 'unknown'
}

export function proxy(request: NextRequest) {
  if (request.method !== 'POST') {
    return NextResponse.next()
  }

  const rule = resolveRule(request.nextUrl.pathname)
  if (!rule) {
    return NextResponse.next()
  }

  const decision = consumeRateLimit(
    `${rule.scope}:${clientIp(request)}`,
    rule.limit,
    rule.windowMs
  )

  if (decision.limited) {
    return NextResponse.json(
      {
        success: false,
        error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' },
      },
      { status: 429, headers: { 'Retry-After': String(decision.retryAfterSeconds) } }
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/api/product-page/:slug/pay',
    '/api/auth/reset-password/request',
    '/api/auth/reset-password/confirm',
    '/api/auth/register',
    '/api/auth/callback/credentials',
  ],
}
