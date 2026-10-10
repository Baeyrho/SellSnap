import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'

// Payment status must never be cached — a stale copy would tell a buyer PENDING/SUCCESS wrongly.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteParams {
  params: Promise<{ txRef: string }>
}

/** SellSnap issues references as `SS-` plus 16 URL-safe nanoid characters. Rejecting anything
 *  else before the query keeps junk and oversized input off the database and makes probing
 *  cheaper without narrowing the shape of any reference the app can actually produce. */
const TRANSACTION_REF_PATTERN = /^SS-[A-Za-z0-9_-]{1,64}$/

/** GET /api/checkout/status/[txRef] — poll order status after payment.
 *
 *  Deliberately unauthenticated: the buyer is redirected here straight from Flutterwave and has
 *  no session. Access therefore rests on the reference being unguessable, so the response carries
 *  only what the confirmation page renders — status, product name, product image, amount and the
 *  reference itself. No customer details, seller details, or internal record IDs are exposed. */
export async function GET(_req: Request, { params }: RouteParams) {
  const { txRef } = await params
  if (!TRANSACTION_REF_PATTERN.test(txRef)) {
    return errorResponse(404, 'NOT_FOUND', 'Order not found.')
  }

  const order = await prisma.order.findUnique({
    where: { transactionRef: txRef },
    include: {
      product: {
        select: { name: true, imageUrl: true },
      },
    },
  })

  if (!order) {
    return errorResponse(404, 'NOT_FOUND', 'Order not found.')
  }

  return successResponse({
    status: order.status,
    productName: order.product.name,
    productImage: order.product.imageUrl,
    amountKobo: order.amountKobo,
    transactionRef: order.transactionRef,
  })
}
