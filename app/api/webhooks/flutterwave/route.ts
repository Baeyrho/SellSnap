import { prisma } from '@/lib/prisma'
import { verifyTransactionById } from '@/lib/flutterwave'
import { logError } from '@/lib/logger'
import { safeEqual } from '@/lib/secure-compare'
import {
  isLatePaymentCandidate,
  markLatePaymentDetected,
  ORDER_RESOLUTION_INCLUDE,
  resolveOrderFromVerification,
} from '@/lib/payments'

/** POST /api/webhooks/flutterwave — Flutterwave payment webhook */
export async function POST(req: Request) {
  const hash = req.headers.get('verif-hash')
  if (!safeEqual(hash, process.env.FLUTTERWAVE_SECRET_HASH)) {
    return new Response(null, { status: 401 })
  }

  try {
    const body = await req.json()
    const transactionId = body.data?.id as number | undefined
    const txRef = body.data?.tx_ref as string | undefined

    if (!transactionId || !txRef) {
      return new Response(null, { status: 400 })
    }

    const order = await prisma.order.findUnique({
      where: { transactionRef: txRef },
      include: ORDER_RESOLUTION_INCLUDE,
    })

    if (!order) return new Response(null, { status: 200 })

    if (order.status !== 'PENDING') {
      // The order is already resolved, but the provider is telling us about a transaction against
      // it. A redelivered webhook for an order we already settled is routine and must stay quiet;
      // the case that matters is a payment the abandoned-order sweep wrote off as FAILED an hour
      // before the buyer's bank transfer landed, which is money taken for nothing. Those two are
      // indistinguishable from the webhook body alone, so the order has to be checked — but only
      // orders that could actually be missing money are worth a provider round trip.
      if (isLatePaymentCandidate(order)) {
        // A verification failure propagates to the catch below and answers 5xx on purpose:
        // Flutterwave redelivers on non-2xx, which is the only way a late payment gets a second
        // chance if the provider blip outlasts this request.
        await recordPaymentAgainstClosedOrder(order, transactionId)
      }

      return new Response(null, { status: 200 })
    }

    // An unrecognised verification shape throws rather than returning partial data, so a
    // malformed provider response can never be read as a payment.
    const verification = await verifyTransactionById(transactionId)

    const resolution = await resolveOrderFromVerification(order, verification)

    // The webhook body referenced a transaction that is not this order's. tx_ref is immutable, so
    // this cannot resolve on retry — answer 200 (stop the redelivery loop) and alert instead.
    if (resolution === 'REFERENCE_MISMATCH') {
      logError('webhook.reference_mismatch', { orderId: order.id, transactionId })
      return new Response(null, { status: 200 })
    }

    // SUCCESS, FAILED, OVERPAID and SETTLEMENT_PENDING are all valid handshakes.
    return new Response(null, { status: 200 })
  } catch (error) {
    logError('webhook.handler_error', undefined, error)
    return new Response(null, { status: 500 })
  }
}

/**
 * Decide whether a provider-confirmed transaction is a payment against an order SellSnap has
 * already closed, and record it if so.
 *
 * The order was found by the webhook's `tx_ref`, but the webhook body is untrusted input, so the
 * verified transaction is bound back to the order before anything is written. Anything that is not
 * a confirmed payment for this exact order is ignored: a still-settling charge, a failed charge, or
 * a transaction belonging to a different order are all routine and must stay quiet.
 *
 * Verification errors are intentionally not caught. `markLatePaymentDetected` is idempotent, so
 * redelivery is safe, and a 5xx is the only thing that buys a provider blip a second chance.
 */
async function recordPaymentAgainstClosedOrder(
  order: { id: string; status: string; transactionRef: string; amountKobo: number },
  transactionId: number
): Promise<void> {
  const verification = await verifyTransactionById(transactionId)

  if (verification.tx_ref !== order.transactionRef) return
  if (verification.status !== 'successful') return

  await markLatePaymentDetected(order, verification)
}
