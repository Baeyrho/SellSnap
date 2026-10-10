import { collectOperationsReport, describeOperationsReport } from '@/lib/operations'
import { logError, logInfo } from '@/lib/logger'
import { sendOperationalAlertEmail } from '@/lib/email'
import { safeEqual } from '@/lib/secure-compare'
import { consumeRateLimit } from '@/lib/rate-limit'

const ALERT_LIMIT_PER_HOUR = 5
const HOUR_MS = 60 * 60 * 1000

/**
 * GET /api/cron/operations — read-only report of everything waiting on a human.
 *
 * Why this exists: there is no admin role in SellSnap's data model, and adding one would mean a new
 * authorisation model for a single screen. Rather than that, or worse, hanging refund and reversal
 * detail off the seller dashboard, the operations queue is served from the same internal boundary
 * the cron already uses — the shared CRON_SECRET. Nothing here is reachable by a buyer or a seller,
 * and nothing here can change any data.
 *
 * It reports, for each order:
 *  - `latePayments`     — the provider confirmed a payment for an order that was already closed.
 *                         Money was taken, nothing was fulfilled, no reversal was raised.
 *  - `refundsNeedingAction` — reversals below Flutterwave's minimum refund amount, or reversals
 *                         that failed. The buyer is owed this money in both cases.
 *  - `refundBacklog`    — reversals still awaiting disbursement, and the age of the oldest.
 *  - `stalePendingOrders` — PENDING orders older than the sweep window, which means the cron
 *                         itself is not doing its job.
 *
 * Add `?alert=1` to have the same summary emailed to the operator address — useful as a heartbeat
 * when nobody is watching the cron logs. `?limit=N` bounds each list (default 25, maximum 100).
 *
 * Runbook: docs/OPERATIONS.md. Owner: [Assign owner]
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // Fail closed when the secret is unset. An unset CRON_SECRET must never degrade into "no auth",
  // because this response lists sellers' and buyers' email addresses.
  if (!cronSecret || !safeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return new Response(null, { status: 401 })
  }

  try {
    const url = new URL(req.url)
    const report = await collectOperationsReport(parseLimit(url.searchParams.get('limit')))

    if (url.searchParams.get('alert') === '1') {
      // Bound the alert path so a holder of the secret cannot use it as an email-bomb.
      const decision = consumeRateLimit('operations-alert', ALERT_LIMIT_PER_HOUR, HOUR_MS)

      if (!decision.limited) {
        try {
          await sendOperationalAlertEmail('Operations report', describeOperationsReport(report))
        } catch (alertError) {
          // The report is the deliverable; a failed notification must not turn it into a 5xx and
          // leave the caller with nothing.
          logError('operations.alert_failed', undefined, alertError)
        }
      }
    }

    logInfo('operations.report_read', {
      latePayments: report.latePayments.length,
      refundsNeedingAction: report.refundsNeedingAction.length,
      refundsOutstanding: report.refundBacklog.outstanding,
      stalePendingOrders: report.stalePendingOrders,
    })

    return Response.json(report)
  } catch (error) {
    logError('operations.report_failed', undefined, error)
    return new Response(null, { status: 500 })
  }
}

/** Clamp the caller's limit so one request cannot ask for the whole table. */
function parseLimit(raw: string | null): number {
  const parsed = Number(raw)

  if (!Number.isInteger(parsed) || parsed <= 0) return 25

  return Math.min(parsed, 100)
}