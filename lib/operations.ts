import { prisma } from '@/lib/prisma'

/**
 * Single definition of "something needs a human decision".
 *
 * Both the cron's alerting decision and the read-only operations report read from here, so the
 * alert can never describe a different set of problems from the one an operator is shown.
 *
 * Everything listed is a condition SellSnap deliberately refuses to resolve on its own. None of it
 * is a normal in-flight state, which is what makes it safe to alert on.
 */

/** One order that took money and still owes the buyer or the seller a decision. */
export interface ActionableOrder {
  orderId: string
  transactionRef: string
  amountKobo: number
  orderStatus: string
  refundStatus: string | null
  refundId: number | null
  /** Which condition put this order in the queue. */
  reasons: string[]
  productName: string
  sellerEmail: string
  customerEmail: string | null
  customerName: string | null
  createdAt: string
  latePaymentDetectedAt: string | null
}

export interface RefundBacklog {
  /** Refunds requested but not yet confirmed as disbursed. */
  outstanding: number
  /** Refunds Flutterwave confirmed as disbursed. */
  completed: number
  /** The oldest outstanding refund, which is the one at risk of being forgotten. */
  oldestOutstandingAt: string | null
}

export interface OperationsReport {
  generatedAt: string
  /** Orders where the provider confirmed a payment after SellSnap had closed the order. */
  latePayments: ActionableOrder[]
  /** Reversals below the provider's minimum refund, or reversals that failed. */
  refundsNeedingAction: ActionableOrder[]
  /** Reversals still in flight, with the age of the oldest. */
  refundBacklog: RefundBacklog
  /** PENDING orders older than the sweep window — a sign the cron itself has stopped. */
  stalePendingOrders: number
  /** True when there is anything to act on. */
  needsAttention: boolean
}

const ACTIONABLE_INCLUDE = {
  product: { select: { name: true } },
  seller: { select: { email: true } },
} as const

/** The age at which a PENDING order should already have been swept by the cron. */
export const STALE_PENDING_WINDOW_MS = 60 * 60 * 1000

function toActionable(
  order: {
    id: string
    transactionRef: string
    amountKobo: number
    status: string
    refundStatus: string | null
    refundId: number | null
    latePaymentDetectedAt: Date | null
    createdAt: Date
    product: { name: string }
    seller: { email: string }
    customerEmail: string | null
    customerName: string | null
  },
  reasons: string[]
): ActionableOrder {
  return {
    orderId: order.id,
    transactionRef: order.transactionRef,
    amountKobo: order.amountKobo,
    orderStatus: order.status,
    refundStatus: order.refundStatus,
    refundId: order.refundId,
    reasons,
    productName: order.product.name,
    sellerEmail: order.seller.email,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    createdAt: order.createdAt.toISOString(),
    latePaymentDetectedAt: order.latePaymentDetectedAt
      ? order.latePaymentDetectedAt.toISOString()
      : null,
  }
}

/**
 * Collect the current operational queue.
 *
 * Read-only and bounded: every query is capped and orders are returned oldest-first, because the
 * oldest outstanding obligation is the one a busy operator is most likely to miss.
 *
 * `limit` bounds each list, not the total work, so the report stays cheap to call from a cron that
 * runs hourly.
 */
export async function collectOperationsReport(limit = 25): Promise<OperationsReport> {
  const staleBefore = new Date(Date.now() - STALE_PENDING_WINDOW_MS)

  const [latePaymentRows, refundActionRows, backlog, stalePendingOrders] = await Promise.all([
    // A late payment is the serious case: the provider confirmed money against an order that is
    // already closed, so nothing was fulfilled and no reversal was raised.
    prisma.order.findMany({
      where: { latePaymentDetectedAt: { not: null } },
      include: ACTIONABLE_INCLUDE,
      orderBy: { latePaymentDetectedAt: 'asc' },
      take: limit,
    }),

    // Reversals SellSnap could not complete on its own. `FAILED` is a provider or network fault;
    // `BELOW_MINIMUM` is Flutterwave's published floor, below which no API refund is possible. The
    // buyer is owed the money in both cases.
    prisma.order.findMany({
      where: { refundStatus: { in: ['BELOW_MINIMUM', 'FAILED'] } },
      include: ACTIONABLE_INCLUDE,
      orderBy: { updatedAt: 'asc' },
      take: limit,
    }),

    prisma.order.groupBy({
      by: ['refundStatus'],
      where: { refundStatus: { in: ['REQUESTED', 'COMPLETED'] } },
      _count: { _all: true },
    }),

    prisma.order.count({
      where: { status: 'PENDING', createdAt: { lt: staleBefore } },
    }),
  ])

  const outstandingCount =
    backlog.find((row) => row.refundStatus === 'REQUESTED')?._count._all ?? 0
  const completedCount =
    backlog.find((row) => row.refundStatus === 'COMPLETED')?._count._all ?? 0

  // A single cheapest query for the oldest in-flight reversal, so an operator can see at a glance
  // whether the backlog is draining or wedged.
  const oldestOutstanding = await prisma.order.findFirst({
    where: { refundStatus: 'REQUESTED' },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  })

  const latePayments = latePaymentRows.map((order) =>
    toActionable(order, ['LATE_PAYMENT: provider confirmed a payment after the order was closed'])
  )

  const refundsNeedingAction = refundActionRows.map((order) =>
    toActionable(order, [
      order.refundStatus === 'BELOW_MINIMUM'
        ? 'BELOW_MINIMUM: under Flutterwave\'s minimum refund amount, must be returned manually'
        : 'REFUND_FAILED: the automatic reversal failed and must be raised manually',
    ])
  )

  return {
    generatedAt: new Date().toISOString(),
    latePayments,
    refundsNeedingAction,
    refundBacklog: {
      outstanding: outstandingCount,
      completed: completedCount,
      oldestOutstandingAt: oldestOutstanding?.createdAt.toISOString() ?? null,
    },
    stalePendingOrders,
    needsAttention:
      latePaymentRows.length > 0 || refundActionRows.length > 0 || stalePendingOrders > 0,
  }
}

/** One-line-per-item summary for an alert email. Kept short on purpose: it is a nudge, not a report. */
export function describeOperationsReport(report: OperationsReport): string[] {
  const lines: string[] = []

  if (report.latePayments.length > 0) {
    lines.push(
      `${report.latePayments.length} late payment(s) — a buyer paid for an order that was already closed.`,
      'Money was taken, nothing was fulfilled, and no reversal was raised. Decide per order: fulfil or refund.',
      ''
    )

    for (const order of report.latePayments) {
      lines.push(`- ${order.orderId} ref=${order.transactionRef} ₦${order.amountKobo / 100}`)
    }

    lines.push('')
  }

  if (report.refundsNeedingAction.length > 0) {
    lines.push(
      `${report.refundsNeedingAction.length} reversal(s) need manual handling. The buyer is still owed this money.`,
      ''
    )

    for (const order of report.refundsNeedingAction) {
      lines.push(
        `- ${order.orderId} ref=${order.transactionRef} ${order.refundStatus} ₦${order.amountKobo / 100}`
      )
    }

    lines.push('')
  }

  if (report.stalePendingOrders > 0) {
    lines.push(
      `${report.stalePendingOrders} order(s) are still PENDING after the one-hour sweep window.`,
      'The reconciliation cron is probably not running or is failing.',
      ''
    )
  }

  if (report.refundBacklog.outstanding > 0) {
    lines.push(
      `${report.refundBacklog.outstanding} reversal(s) awaiting disbursement` +
        (report.refundBacklog.oldestOutstandingAt
          ? `, oldest raised ${report.refundBacklog.oldestOutstandingAt}.`
          : '.')
    )
  }

  lines.push('', `Full report: GET /api/cron/operations with Authorization: Bearer <CRON_SECRET>`)

  return lines
}