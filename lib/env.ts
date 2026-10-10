const LOCAL_FALLBACK = 'http://localhost:3000'

/**
 * Assert the one public URL the app depends on is present and safe.
 *
 * `NEXT_PUBLIC_APP_URL` is used to build the Flutterwave payment redirect and the password-reset
 * link. If it is missing in production those links silently point at localhost and every reset
 * email is useless; if it points at a host the operator does not control, reset tokens would be
 * delivered to that host. Production therefore fails fast at boot; development warns and falls
 * back so local work is unaffected.
 */
export function assertRequiredEnv(): void {
  // `next build` runs with NODE_ENV=production but should not be blocked by a local http URL;
  // only enforce when a server is actually about to serve requests.
  if (process.env.NEXT_PHASE === 'phase-production-build') return

  const raw = process.env.NEXT_PUBLIC_APP_URL

  if (process.env.NODE_ENV !== 'production') {
    if (!raw) {
      console.warn(`[env] NEXT_PUBLIC_APP_URL is not set; falling back to ${LOCAL_FALLBACK}.`)
    }
    return
  }

  if (!raw) {
    throw new Error('NEXT_PUBLIC_APP_URL must be set in production.')
  }

  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`NEXT_PUBLIC_APP_URL is not a valid absolute URL: ${raw}`)
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_APP_URL must use https in production.')
  }
}
