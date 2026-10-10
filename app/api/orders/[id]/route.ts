import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'

interface RouteParams {
  params: Promise<{ id: string }>
}

/** GET /api/orders/[id] — fetch a single order */
export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  const order = await prisma.order.findUnique({
    where: { id },
    include: {
      product: {
        select: { id: true, name: true, slug: true, imageUrl: true, priceKobo: true },
      },
    },
  })

  if (!order) return errorResponse(404, 'NOT_FOUND', 'Order not found.')
  if (order.sellerId !== session.user.id) return errorResponse(403, 'FORBIDDEN', 'You do not have access to this order.')

  return successResponse({ order })
}
