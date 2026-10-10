/**
 * Minimal structured logger for server-side operational events.
 *
 * Why this exists: the payment pipeline previously reported every failure through bare
 * `console.error`. That is readable in a terminal and effectively invisible in production — there
 * is no stable key to filter on, no level, and no way to ask "did the refund poller run today?".
 * Vercel collects stdout/stderr into searchable logs, so emitting one JSON object per event is
 * enough to make the pipeline queryable without adding a dependency or a log aggregator.
 *
 * Design constraints:
 * - No dependency. Node's `console` is the only transport.
 * - Never throws. A logging failure must not be able to fail a payment.
 * - Never accepts secrets. Callers pass identifiers and counts only. Anything that could be a
 *   secret, token, or full card/bank detail must not be logged.
 */

export type LogLevel = 'info' | 'warn' | 'error'

/** Scalar-only fields. Nested objects are rejected by the type so logs stay flat and greppable. */
export type LogFields = Record<string, string | number | boolean | null | undefined>

function write(level: LogLevel, event: string, fields: LogFields | undefined): void {
  try {
    // Reserved keys are spread last so a caller-supplied `level` or `event` can never shadow the
    // real one and make a log line lie about itself.
    const line = JSON.stringify({ ...fields, ts: new Date().toISOString(), level, event })

    if (level === 'error') {
      console.error(line)
    } else if (level === 'warn') {
      console.warn(line)
    } else {
      console.info(line)
    }
  } catch {
    // Serialising a field can throw (circular reference, BigInt). Swallowing keeps the logging
    // path strictly non-fatal — the caller's own work must continue regardless.
  }
}

/** Records a normal, expected operational event (cron ran, order resolved, refund confirmed). */
export function logInfo(event: string, fields?: LogFields): void {
  write('info', event, fields)
}

/** Records a condition that needs attention but did not stop the operation. */
export function logWarn(event: string, fields?: LogFields): void {
  write('warn', event, fields)
}

/**
 * Records a failure. `err` is a separate parameter rather than a field because `LogFields` has an
 * index signature, which would force `unknown` down to a scalar. It is summarised rather than
 * serialised: a full provider error object can carry a request body, and all we need is what broke.
 */
export function logError(event: string, fields?: LogFields, err?: unknown): void {
  const summary: LogFields =
    err === undefined
      ? {}
      : {
          // `instanceof Error` is the only safe narrowing here; anything else is stringified.
          errorMessage: err instanceof Error ? err.message : String(err),
          errorName: err instanceof Error ? err.name : undefined,
        }

  write('error', event, { ...fields, ...summary })
}