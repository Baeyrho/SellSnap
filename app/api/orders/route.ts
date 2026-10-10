import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'

/** GET /api/orders — list current seller's orders */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  const orders = await prisma.order.findMany({
    where: { sellerId: session.user.id },
    include: {
      product: {
        select: { id: true, name: true, slug: true, imageUrl: true, priceKobo: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ orders })
}
