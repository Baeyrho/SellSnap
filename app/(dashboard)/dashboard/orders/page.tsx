import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageShell } from '@/components/layout/PageShell/PageShell'
import { OrderTable } from '@/components/order/OrderTable/OrderTable'

export const metadata = {
  title: 'Orders - SellSnap',
}

export default async function OrdersPage() {
  const session = await auth()
  const sellerId = session!.user.id

  const orders = await prisma.order.findMany({
    where: { sellerId },
    include: {
      product: {
        select: { id: true, name: true, slug: true, imageUrl: true, priceKobo: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <PageShell
      title="Orders"
      subtitle={`${orders.length} order${orders.length !== 1 ? 's' : ''}`}
    >
      <OrderTable orders={orders} />
    </PageShell>
  )
}
