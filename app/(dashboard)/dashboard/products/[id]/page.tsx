import { redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { PageShell } from '@/components/layout/PageShell/PageShell'
import { ProductForm } from '@/components/product/ProductForm/ProductForm'

export const metadata: Metadata = {
  title: 'Edit Product - SellSnap',
}

interface EditProductPageProps {
  params: Promise<{ id: string }>
}

export default async function EditProductPage({ params }: EditProductPageProps) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/auth')
  }

  const product = await prisma.product.findUnique({
    where: { id },
  })

  if (
    !product ||
    product.sellerId !== session.user.id ||
    product.status === 'DELETED'
  ) {
    redirect('/dashboard/products')
  }

  return (
    <PageShell
      title="Edit Product"
      subtitle={`Update ${product.name}`}
      backHref="/dashboard/products"
      backLabel="Cancel"
      backVariant="secondary"
    >
      <ProductForm
        productId={product.id}
        initialProduct={{
          name: product.name,
          description: product.description,
          priceKobo: product.priceKobo,
          imageUrl: product.imageUrl,
          imageUrls: product.imageUrls && product.imageUrls.length > 0 ? product.imageUrls : [product.imageUrl],
        }}
      />
    </PageShell>
  )
}