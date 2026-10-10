import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { assessPayment, formatNaira, koboToChargeableNaira, nairaToKobo } from '@/lib/kobo'
import {
  fetchRefundStatus,
  refundTransaction,
  VerificationError,
  type TransactionVerification,
} from '@/lib/flutterwave'
import { logError, logInfo, logWarn } from '@/lib/logger'
import { sendOrderResolutionEmails } from '@/lib/email'

/** The order fields a payment resolution needs, shared by every resolution path so they all load
 *  an identical shape. Deliberately excludes seller bank details and anything else not required
 *  to decide or announce an outcome. */
export const ORDER_RESOLUTION_INCLUDE = {
  product: { select: { name: true } },
  seller: { select: { email: true } },
} satisfies Prisma.OrderInclude

export type ResolvableOrder = Prisma.OrderGetPayload<{
  include: typeof ORDER_RESOLUTION_INCLUDE
}>

/** The outcome of applying one provider verification to one order. */
export type OrderResolution =
  /** Provider confirmed payment of exactly the authoritative price. The order is fulfilled. */
  | 'SUCCESS'
  /** Provider reported a failed charge, or the charge can never be resolved. */
  | 'FAILED'
  /** Paid more than the authoritative price. Not fulfilled; full reversal requested. */
  | 'OVERPAID'
  /** The charge is still settling (bank transfer / USSD). Left PENDING for a later re-check. */
  | 'SETTLEMENT_PENDING'
  /** The verified transaction is not this order's transaction. Nothing was written. */
  | 'REFERENCE_MISMATCH'

/** What actually happened to the excess a buyer paid above the listed price.
 *
 *  The buyer is told the truth about their money in each case. `REVERSAL_SETTLED` and
 *  `REVERSAL_IN_PROGRESS` both mean a refund was raised with Flutterwave; `MANUAL_REQUIRED`
 *  means no automatic reversal is possible and a human must return the excess. */
export type OverpaymentReversalStatus =
  | 'REVERSAL_SETTLED'
  | 'REVERSAL_IN_PROGRESS'
  | 'MANUAL_REQUIRED'

export interface OverpaymentReversal {
  status: OverpaymentReversalStatus
  /** The full amount the provider confirmed the buyer was charged. */
  chargedFormatted: string
  /** The part of that which exceeded the listed price. */
  excessFormatted: string
}

/** Announce a terminal outcome to buyer and seller. A mail failure must never fail the resolution.
 *
 *  `reversal` is required for `OVERPAID` in practice: it is what lets the overpayment email say
 *  whether the buyer's money is actually on its way back, instead of reusing the ordinary
 *  "no payment was taken" wording — which is false for an overpayment and invites a double payment. */
export async function notifyOrderResolution(
  order: ResolvableOrder,
  outcome: 'SUCCESS' | 'FAILED' | 'OVERPAID',
  reversal?: OverpaymentReversal
): Promise<void> {
  try {
    await sendOrderResolutionEmails({
      outcome,
      // Passed through only when present. The email module owns the fallback, so a missing detail
      // can never render as an empty amount or imply the money is already back.
      ...(reversal ? { reversal } : {}),
      buyerEmail: order.customerEmail,
      buyerName: order.customerName,
      sellerEmail: order.seller.email,
      productName: order.product.name,
      amountFormatted: formatNaira(order.amountKobo),
      transactionRef: order.transactionRef,
    })
  } catch (error) {
    // An email failure must never change a resolved order's fate — the money is already correctly
    // recorded in the database. It does need to be visible, though: a buyer who never received their
    // receipt has no way to tell a silent failure from a lost order.
    logError(
      'payments.order_resolution_email_failed',
      { orderId: order.id, outcome },
      error
    )
  }
}

/** The fields that decide whether a closed order could still be missing money. */
export interface LatePaymentCandidate {
  status: string
  /** Set whenever the order was resolved against a real provider transaction. */
  flutterwaveTxId: number | null
  latePaymentDetectedAt: Date | null
}

/**
 * Whether an already-closed order might have taken money that nothing accounted for.
 *
 * All three conditions are needed. `status: 'FAILED'` alone is not enough, because two other paths
 * also land an order on `FAILED` with the money already handled — a provider-confirmed failed charge
 * and an overpayment whose reversal is in flight. Both record `flutterwaveTxId`; both are correct as
 * they are, and flagging them would page a human for nothing on every webhook redelivery.
 *
 * A null `flutterwaveTxId` on a `FAILED` order is precisely the abandoned-order sweep's signature:
 * it closed the order only because Flutterwave had no record of the transaction. So this returns
 * true for exactly the orders where a later confirmed payment is unaccounted money.
 */
export function isLatePaymentCandidate(order: LatePaymentCandidate): boolean {
  return (
    order.status === 'FAILED' &&
    order.flutterwaveTxId === null &&
    order.latePaymentDetectedAt === null
  )
}

/**
 * Record a payment the provider confirmed for an order SellSnap had already closed.
 *
 * The abandoned-order sweep resolves an unpaid order to `FAILED` one hour after it is created. A
 * buyer using a bank transfer or USSD can legitimately complete that payment *after* the sweep has
 * run — the money reaches the seller's subaccount, but the order is no longer `PENDING` and no
 * longer revisitable. Previously the webhook discarded these events with a bare `200`, so the buyer's
 * money was taken, the order stayed `FAILED`, nothing was fulfilled and no reversal was raised.
 * That is money taken for nothing, found only by reading logs.
 *
 * This function makes the situation findable without inventing a resolution policy. It deliberately
 * does NOT fulfil the order (the item may be gone) and does NOT auto-refund (returning money is a
 * business decision). It marks the order so `GET /api/cron/operations` lists it and
 * `docs/OPERATIONS.md` says what a human should do about it.
 *
 * Returns true only when this call is the one that recorded it, so a redelivered webhook does not
 * raise a duplicate alert. The `where` clause repeats the eligibility rule of
 * `isLatePaymentCandidate` rather than trusting the caller's copy of the order, so a concurrent
 * sweep cannot slip a row past the check.
 */
export async function markLatePaymentDetected(
  order: { id: string; status: string; transactionRef: string; amountKobo: number },
  verification: TransactionVerification
): Promise<boolean> {
  const { count } = await prisma.order.updateMany({
    where: {
      id: order.id,
      status: 'FAILED',
      flutterwaveTxId: null,
      latePaymentDetectedAt: null,
    },
    data: { latePaymentDetectedAt: new Date() },
  })

  if (count === 0) return false

  logError('payments.late_payment_detected', {
    orderId: order.id,
    transactionRef: order.transactionRef,
    orderStatus: order.status,
    chargedKobo: nairaToKobo(verification.amount),
    requiredKobo: order.amountKobo,
    providerStatus: verification.status,
  })

  return true
}

/** Reverse an overpaid transaction in full and persist the outcome.
 *
 *  Runs only after this path has atomically claimed the reversal by flipping the order out of
 *  PENDING and setting `refundStatus`, so a concurrent webhook delivery or cron run sees
 *  `refundStatus` already set and does not claim it again. SellSnap therefore never sends two
 *  refund requests for the same transaction.
 *
 *  A refund request is not a refund. `COMPLETED` is written only when Flutterwave confirms
 *  disbursement; an accepted-but-unsettled refund stays `REQUESTED` and is finished by
 *  `reconcileRequestedRefunds`. In every case the order remains FAILED and unfulfilled. */
async function reverseOverpayment(
  order: ResolvableOrder,
  verification: TransactionVerification
): Promise<OverpaymentReversalStatus> {
  const paidKobo = nairaToKobo(verification.amount)

  try {
    // Full reversal of the provider-confirmed amount. `verification.amount` is in major units and
    // `refundTransaction` takes Naira, so this converts once through the explicitly named helper
    // rather than by dividing by 100 inline — the same figure is easy to read as kobo and
    // under-refund by a factor of 100.
    const refund = await refundTransaction(
      verification.id,
      koboToChargeableNaira(paidKobo),
      'Automatic reversal: payment exceeded the product price.'
    )

    await prisma.order.update({
      where: { id: order.id },
      data: {
        refundId: refund.refundId,
        refundStatus: refund.settled ? 'COMPLETED' : 'REQUESTED',
      },
    })

    if (!refund.settled) {
      logWarn('payments.refund_accepted_not_disbursed', {
        orderId: order.id,
        refundId: refund.refundId,
      })
    }

    return refund.settled ? 'REVERSAL_SETTLED' : 'REVERSAL_IN_PROGRESS'
  } catch (error) {
    // An excess below Flutterwave's published minimum refund amount can never be reversed through
    // the API. That is neither a provider fault nor the same as a reversal that was attempted and
    // failed: no refund exists to reconcile, and the buyer is still owed the money. It gets its own
    // status so it stays an actionable queue for manual return instead of being lost among
    // provider faults.
    const belowMinimum = error instanceof VerificationError && error.kind === 'below_minimum'

    logError(
      belowMinimum
        ? 'payments.refund_below_provider_minimum'
        : 'payments.refund_request_failed',
      { orderId: order.id },
      error
    )

    try {
      await prisma.order.update({
        where: { id: order.id },
        data: { refundStatus: belowMinimum ? 'BELOW_MINIMUM' : 'FAILED' },
      })
    } catch (recordError) {
      logError('payments.refund_outcome_record_failed', { orderId: order.id }, recordError)
    }

    // Either way the buyer is still owed the excess and no automatic reversal is in flight.
    return 'MANUAL_REQUIRED'
  }
}

/** Apply one provider verification to one order, under SellSnap's authoritative amount rules.
 *
 *  Every payment-resolution path (webhook, cron reconciliation) must go through this function so
 *  that no route can mark an order paid on different terms than another. The caller is
 *  responsible for having loaded a PENDING order.
 *
 *  The billing amount always comes from `order.amountKobo`, captured from the product row when
 *  the order was created. Nothing the buyer or the provider's webhook body supplies can change it. */
export async function resolveOrderFromVerification(
  order: ResolvableOrder,
  verification: TransactionVerification
): Promise<OrderResolution> {
  // Without this binding the amount comparison below would be applied to whatever transaction
  // the verification happened to describe.
  if (verification.tx_ref !== order.transactionRef) {
    return 'REFERENCE_MISMATCH'
  }

  if (verification.status === 'failed') {
    const { count } = await prisma.order.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'FAILED', flutterwaveTxId: verification.id },
    })

    if (count === 0) return 'SETTLEMENT_PENDING'

    await notifyOrderResolution(order, 'FAILED')
    return 'FAILED'
  }

  // A charge that is still settling must stay PENDING so a later run can confirm it. Marking it
  // FAILED here would strand a paid order — no subsequent webhook or cron pass revisits a
  // non-PENDING order.
  if (verification.status !== 'successful') {
    return 'SETTLEMENT_PENDING'
  }

  // SellSnap only ever initialises NGN charges, so a successful charge in another currency can
  // never become a valid payment. Resolving it now stops it staying actionable indefinitely.
  if (verification.currency !== 'NGN') {
    const { count } = await prisma.order.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'FAILED', flutterwaveTxId: verification.id },
    })

    if (count === 0) return 'SETTLEMENT_PENDING'

    await notifyOrderResolution(order, 'FAILED')
    return 'FAILED'
  }

  const assessment = assessPayment(verification.amount, order.amountKobo)

  if (assessment === 'UNDERPAID') {
    // A confirmed charge below the authoritative price is never fulfilled. It stays PENDING
    // because the provider may still be settling the remainder, exactly as a late bank transfer
    // would; it is never promoted to SUCCESS.
    return 'SETTLEMENT_PENDING'
  }

  if (assessment === 'OVERPAID') {
    // Claim the reversal and the order transition in one compare-and-set. `refundStatus: null` is
    // the duplicate-refund guard: only the request that actually claims it may call Flutterwave.
    const { count } = await prisma.order.updateMany({
      where: { id: order.id, status: 'PENDING', refundStatus: null },
      data: {
        status: 'FAILED',
        flutterwaveTxId: verification.id,
        refundStatus: 'REQUESTED',
      },
    })

    if (count === 0) return 'SETTLEMENT_PENDING'

    const reversalStatus = await reverseOverpayment(order, verification)
    const paidKobo = nairaToKobo(verification.amount)

    // Both parties get overpayment-specific wording. The previous code sent 'FAILED', whose buyer
    // copy claims "No payment was taken" and invites a retry — untrue here, because the money was
    // taken and is being returned, so following that advice would risk a second payment.
    await notifyOrderResolution(order, 'OVERPAID', {
      status: reversalStatus,
      chargedFormatted: formatNaira(paidKobo),
      excessFormatted: formatNaira(paidKobo - order.amountKobo),
    })

    return 'OVERPAID'
  }

  const { count } = await prisma.order.updateMany({
    where: { id: order.id, status: 'PENDING' },
    data: { status: 'SUCCESS', flutterwaveTxId: verification.id },
  })

  if (count === 0) return 'SETTLEMENT_PENDING'

  await notifyOrderResolution(order, 'SUCCESS')
  return 'SUCCESS'
}

/** What one reconciliation sweep established about outstanding reversals. */
export interface RefundReconciliationSummary {
  /** Promoted to COMPLETED on provider-confirmed disbursement. */
  settled: number
  /** Promoted to FAILED on an explicit provider failure signal. */
  failed: number
  /** Still outstanding, including anything the provider could not be asked about. */
  pending: number
}

/** Reconcile reversals Flutterwave has accepted but not yet disbursed.
 *
 *  An overpaid order is `FAILED`, so the stale-order sweep never selects it again. Without this
 *  pass a refund left in `REQUESTED` would sit there indefinitely, and SellSnap could never
 *  distinguish a reversal that completed days later from one the provider silently dropped.
 *
 *  Flutterwave documents `GET /v3/refunds/{id}` as the way to check a refund's final status, and
 *  states that refund webhooks are not delivered unless the account has them switched on by their
 *  internal team — so polling is the only mechanism available without owner action.
 *
 *  This function only ever *reads* refunds SellSnap has already raised. It never calls the refund
 *  endpoint, so no number of overlapping cron runs can double-refund a buyer. */
export async function reconcileRequestedRefunds(
  limit = 50
): Promise<RefundReconciliationSummary> {
  // Least-recently-polled first, never-polled first of all. The previous ordering was `updatedAt`
  // ascending, which never changed while a refund sat unsettled — so a refund the provider never
  // finishes (stuck in `processing`, or a provider fault that keeps the read failing) occupied the
  // same slot on every single run, and once enough such rows accumulated they filled the whole
  // batch and newer reversals were never polled at all. Stamping `lastRefundCheckAt` on every
  // attempt rotates stuck rows to the back, so the queue drains fairly.
  const outstanding = await prisma.order.findMany({
    where: { refundStatus: 'REQUESTED', refundId: { not: null } },
    orderBy: [{ lastRefundCheckAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: limit,
    select: { id: true, refundId: true },
  })

  const summary: RefundReconciliationSummary = { settled: 0, failed: 0, pending: 0 }

  // Stamped on every outcome, including failures and unreadable states. Without this a row that
  // errors forever would be re-selected first on every run and never let anything behind it be read.
  const stampChecked = (orderId: string) =>
    prisma.order
      .updateMany({
        where: { id: orderId, refundStatus: 'REQUESTED' },
        data: { lastRefundCheckAt: new Date() },
      })
      .catch((error: unknown) => {
        logError('payments.refund_check_stamp_failed', { orderId }, error)
      })

  for (const order of outstanding) {
    if (order.refundId === null) continue

    try {
      const result = await fetchRefundStatus(order.refundId)

      const next = result.settled ? 'COMPLETED' : result.failed ? 'FAILED' : null

      if (next === null) {
        summary.pending++
        await stampChecked(order.id)
        continue
      }

      // Guarded on the current status so a concurrent sweep cannot double-apply a transition.
      const { count } = await prisma.order.updateMany({
        where: { id: order.id, refundStatus: 'REQUESTED' },
        data: { refundStatus: next, lastRefundCheckAt: new Date() },
      })

      if (count === 0) {
        summary.pending++
        continue
      }

      summary[next === 'COMPLETED' ? 'settled' : 'failed']++

      logInfo('payments.refund_reconciled', {
        orderId: order.id,
        refundId: order.refundId,
        refundStatus: next,
        providerStatus: result.status,
      })
    } catch (error) {
      // A provider fault, an unreadable body, or an id the provider does not recognise is not
      // evidence that the refund failed. The row stays REQUESTED and is re-read next run, so a
      // real obligation to the buyer is never written off on a transient fault.
      summary.pending++

      await stampChecked(order.id)

      logError(
        'payments.refund_status_read_failed',
        {
          orderId: order.id,
          refundId: order.refundId,
          refundStatus: 'REQUESTED',
        },
        error
      )
    }
  }

  return summary
}
