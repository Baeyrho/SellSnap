import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'
import { initializePayment } from '@/lib/flutterwave'
import { koboToChargeableNaira } from '@/lib/kobo'
import { isValidEmail } from '@/lib/validation'
import { logError } from '@/lib/logger'
import { nanoid } from 'nanoid'

interface RouteParams {
  params: Promise<{ slug: string }>
}

const MAX_CUSTOMER_NAME_LENGTH = 80
const MAX_PENDING_ORDERS_PER_PRODUCT_PER_HOUR = 100

/** POST /api/product-page/[slug]/pay — initiate Flutterwave payment */
export async function POST(req: Request, { params }: RouteParams) {
  const { slug } = await params
  try {
    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        seller: {
          select: {
            id: true,
            name: true,
            email: true,
            flutterwaveSubaccountId: true,
          },
        },
      },
    })

    if (!product) {
      return errorResponse(404, 'NOT_FOUND', 'Product not found.')
    }

    // Only ACTIVE products are payable. The client hides its pay form for INACTIVE products,
    // but that is UX only — the authoritative gate has to be here.
    if (product.status !== 'ACTIVE') {
      return errorResponse(404, 'NOT_FOUND', 'This item is no longer available.')
    }

    if (!product.seller.flutterwaveSubaccountId) {
      return errorResponse(400, 'SUBACCOUNT_NOT_CONFIGURED', 'Seller has not configured their bank account for payments.')
    }

    // The billing amount is never read from the request. It is derived from the product row
    // above, so a tampered body cannot influence what the buyer is charged.
    const body: unknown = await req.json().catch(() => null)
    const { customerEmail, customerName } =
      body && typeof body === 'object' ? (body as Record<string, unknown>) : {}

    if (typeof customerEmail !== 'string' || !customerEmail.trim()) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Customer email is required.', 'email')
    }

    // Order.customerEmail is nullable in the schema, but a receipt is the buyer's only proof of
    // payment — so it is mandatory at this boundary and validated before Flutterwave is called.
    const normalisedCustomerEmail = customerEmail.trim().toLowerCase()

    if (!isValidEmail(normalisedCustomerEmail)) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Enter a valid email address.', 'email')
    }

    const normalisedCustomerName =
      typeof customerName === 'string' && customerName.trim() ? customerName.trim() : null

    if (normalisedCustomerName && normalisedCustomerName.length > MAX_CUSTOMER_NAME_LENGTH) {
      return errorResponse(
        400,
        'VALIDATION_ERROR',
        `Name must be ${MAX_CUSTOMER_NAME_LENGTH} characters or fewer.`,
        'name'
      )
    }

    // Bound unauthenticated order creation per product so a single item cannot be flooded with
    // rows (and provider calls) faster than the sweep clears them.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const pendingForProduct = await prisma.order.count({
      where: {
        productId: product.id,
        status: 'PENDING',
        createdAt: { gte: oneHourAgo },
      },
    })

    if (pendingForProduct >= MAX_PENDING_ORDERS_PER_PRODUCT_PER_HOUR) {
      return errorResponse(
        429,
        'TOO_MANY_PENDING_ORDERS',
        'Too many payment attempts for this item right now. Please try again later.'
      )
    }

    const txRef = `SS-${nanoid(16)}`
    const amountNaira = koboToChargeableNaira(product.priceKobo)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const redirectUrl = `${appUrl}/checkout/confirm?tx_ref=${txRef}`

    // Create PENDING order before redirecting to payment
    await prisma.order.create({
      data: {
        productId: product.id,
        sellerId: product.seller.id,
        amountKobo: product.priceKobo,
        status: 'PENDING',
        customerName: normalisedCustomerName,
        customerEmail: normalisedCustomerEmail,
        transactionRef: txRef,
      },
    })

    // Initiate Flutterwave payment
    const { link } = await initializePayment(
      txRef,
      amountNaira,
      normalisedCustomerEmail,
      normalisedCustomerName ?? undefined,
      redirectUrl,
      product.seller.flutterwaveSubaccountId,
      { productId: product.id, productSlug: product.slug }
    )

    return successResponse({ paymentLink: link })
  } catch (error) {
    logError('pay.initiate_failed', { slug }, error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to initiate payment.')
  }
}
