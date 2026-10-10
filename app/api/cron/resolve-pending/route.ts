import { prisma } from '@/lib/prisma'
import { VerificationError, verifyTransactionByRef } from '@/lib/flutterwave'
import { logError, logInfo } from '@/lib/logger'
import { safeEqual } from '@/lib/secure-compare'
import {
  collectOperationsReport,
  describeOperationsReport,
} from '@/lib/operations'
import { sendOperationalAlertEmail } from '@/lib/email'
import {
  notifyOrderResolution,
  ORDER_RESOLUTION_INCLUDE,
  reconcileRequestedRefunds,
  resolveOrderFromVerification,
} from '@/lib/payments'

/** GET /api/cron/resolve-pending — resolve stale PENDING orders, then reconcile outstanding refunds.
 *
 *  This is also the abandoned-order sweep: an order created for a payment that was never
 *  completed has no transaction at Flutterwave, so verification returns null and the order is
 *  resolved as FAILED. Orders are kept, not deleted — they remain the audit trail for the
 *  seller's dashboard.
 *
 *  It also drains reversals left in `REQUESTED`. Those sit on orders that are already `FAILED`, so
 *  the sweep below never sees them again; without this pass a refund Flutterwave accepted would
 *  never be confirmed as disbursed. See `reconcileRequestedRefunds`.
 *
 *  Vercel Cron invokes the configured path with an HTTP GET and, when CRON_SECRET is
 *  set on the project, sends it as `Authorization: Bearer <CRON_SECRET>`.
 *
 *  Every outcome is reported, not just logged: the run emits a structured summary, and anything the
 *  sweep cannot fix on its own — a payment that landed after an order was closed, a reversal below
 *  Flutterwave's minimum, a backlog it did not reach — is emailed to the operator address. A cron
 *  that fails silently for a week is indistinguishable from a healthy one without this. */
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || !safeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return new Response(null, { status: 401 })
  }

  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)

    const staleOrders = await prisma.order.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lt: oneHourAgo },
      },
      include: ORDER_RESOLUTION_INCLUDE,
      // Oldest eligible record first. `createdAt` alone is not a total order — orders created in
      // the same instant would fall back to whatever order the planner returns, so `id` breaks
      // the tie and makes each batch reproducible.
      //
      // The batch is bounded on purpose: the provider verification below is one HTTP call per
      // order, so an unbounded query would be slow enough to time out the cron invocation. It
      // still drains, because processing moves every settled order out of `status: 'PENDING'`,
      // so each run selects the next oldest records rather than repeating the same batch.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
    })

    let resolved = 0
    // Counted rather than only logged: a run where every order fails to verify is the signal that
    // Flutterwave is down, and it has to be visible without someone reading raw log output.
    let verificationFailures = 0

    for (const order of staleOrders) {
      try {
        const verification = await verifyTransactionByRef(order.transactionRef)

        if (!verification) {
          // Flutterwave has no record of this transaction, so it was never paid. A provider
          // error or an unusable response throws instead of reaching here, so the order stays
          // PENDING to be re-checked rather than being failed on a transient fault.
          const { count } = await prisma.order.updateMany({
            where: { id: order.id, status: 'PENDING' },
            data: { status: 'FAILED' },
          })

          if (count === 0) continue

          await notifyOrderResolution(order, 'FAILED')
          resolved++
          continue
        }

        const resolution = await resolveOrderFromVerification(order, verification)

        if (resolution === 'FAILED' || resolution === 'SUCCESS' || resolution === 'OVERPAID') {
          resolved++
        }

        if (resolution === 'REFERENCE_MISMATCH') {
          logError('cron.reference_mismatch', { orderId: order.id })
        }
      } catch (err) {
        // The order stays PENDING and is re-checked on the next run. The failure kind is logged
        // so a provider outage is distinguishable from a SellSnap bug during triage.
        const kind = err instanceof VerificationError ? err.kind : 'unknown'

        verificationFailures++

        logError(
          'cron.order_verification_failed',
          { orderId: order.id, providerFailureKind: kind, orderStatus: 'PENDING' },
          err
        )
      }
    }

    // Run after the order sweep so a newly-raised reversal is not immediately re-read. Only
    // provider-confirmed outcomes are written; anything unreadable stays REQUESTED for the next run.
    const refunds = await reconcileRequestedRefunds()

    logInfo('cron.run_completed', {
      resolved,
      scanned: staleOrders.length,
      verificationFailures,
      refundsSettled: refunds.settled,
      refundsFailed: refunds.failed,
      refundsPending: refunds.pending,
    })

    // The sweep did its job for every order it could. What it cannot fix is a payment that arrived
    // after an order was closed, a reversal it is not permitted to raise, or a backlog it did not
    // get to. Reporting that here is the difference between a job that fails silently for a week
    // and a job that says so within the hour.
    const report = await collectOperationsReport()
    let alerted = false

    if (report.needsAttention || verificationFailures > 0) {
      const lines = describeOperationsReport(report)

      if (verificationFailures > 0) {
        lines.unshift(
          `${verificationFailures} order(s) could not be verified this run; they stay PENDING and will be retried.`
        )
      }

      try {
        await sendOperationalAlertEmail(
          report.needsAttention ? 'Action required' : 'Reconciliation degraded',
          lines
        )
        alerted = true
      } catch (alertError) {
        // An undelivered alert must not fail the run that already did its work. The structured log
        // below is the fallback signal.
        logError('cron.operational_alert_failed', undefined, alertError)
      }
    }

    return Response.json({ resolved, total: staleOrders.length, verificationFailures, refunds, alerted })
  } catch (error) {
    // A top-level failure means the sweep did not complete at all. Alert rather than only logging:
    // this is the case where orders would otherwise sit PENDING indefinitely.
    logError('cron.run_failed', undefined, error)

    try {
      await sendOperationalAlertEmail('Reconciliation cron failed', [
        'The reconciliation cron threw before completing. Stale PENDING orders were not swept this run.',
        '',
        `Error: ${error instanceof Error ? error.message : String(error)}`,
      ])
    } catch (alertError) {
      logError('cron.failure_alert_failed', undefined, alertError)
    }

    return new Response(null, { status: 500 })
  }
}
