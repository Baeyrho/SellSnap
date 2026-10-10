/**
 * Next.js instrumentation hook — runs once when a server instance starts.
 *
 * Used to validate required configuration before the app serves a single request, so a
 * misconfigured deployment fails loudly at boot instead of handing buyers broken payment links.
 */
export async function register(): Promise<void> {
  const { assertRequiredEnv } = await import('./lib/env')
  assertRequiredEnv()
}
