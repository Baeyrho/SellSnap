import Link from 'next/link'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageShell } from '@/components/layout/PageShell/PageShell'
import { ProductsView } from '@/components/product/ProductsView/ProductsView'
import { Button } from '@/components/ui/Button/Button'

import styles from './products.module.css'

export const metadata = {
  title: 'Products - SellSnap',
}

export default async function ProductsPage() {
  const session = await auth()
  const sellerId = session!.user.id

  const products = await prisma.product.findMany({
    where: { sellerId, status: { not: 'DELETED' } },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <PageShell
      title="Products"
      subtitle={`${products.length} product${products.length !== 1 ? 's' : ''}`}
      actions={
          <Link href="/dashboard/products/new">
            <Button variant="outline">+ New product</Button>
          </Link>
      }
    >
      {products.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyText}>No products yet</p>
          <p className={styles.emptyHint}>
            Create your first product and start sharing the link.
          </p>
        </div>
      ) : (
        <ProductsView products={products} />
      )}
    </PageShell>
  )
}
