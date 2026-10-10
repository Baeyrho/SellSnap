import { timingSafeEqual } from 'crypto'

/**
 * Constant-time comparison for server-held shared secrets (the Flutterwave webhook hash and the
 * cron bearer token).
 *
 * `timingSafeEqual` throws on buffers of unequal length, so a length check is done first. That
 * check leaks only the secret's length, which is not sensitive; the byte comparison itself runs in
 * constant time so an attacker cannot recover the secret byte-by-byte from response timing.
 */
export function safeEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false

  const bufferA = Buffer.from(a, 'utf8')
  const bufferB = Buffer.from(b, 'utf8')

  if (bufferA.length !== bufferB.length) return false

  return timingSafeEqual(bufferA, bufferB)
}
