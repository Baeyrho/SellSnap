import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { prisma } from '@/lib/prisma'
import { formatNaira } from '@/lib/kobo'
import { ProductPage } from '@/components/product/ProductPage/ProductPage'

interface PageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params
  const product = await prisma.product.findUnique({
    where: { slug },
    select: { name: true, priceKobo: true },
  })

  if (!product) return { title: 'Product Not Found' }

  return {
    title: `${product.name} — ${formatNaira(product.priceKobo)} | SellSnap`,
    description: `Buy ${product.name} for ${formatNaira(product.priceKobo)} on SellSnap.`,
  }
}

export default async function PublicProductPage({ params }: PageProps) {
  const { slug } = await params
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      seller: { select: { name: true, businessName: true, logoUrl: true, whatsappNumber: true } },
    },
  })

  if (!product) {
    notFound()
  }

  return (
    <ProductPage
      slug={product.slug}
      name={product.name}
      description={product.description}
      priceKobo={product.priceKobo}
      imageUrl={product.imageUrl}
      imageUrls={product.imageUrls && product.imageUrls.length > 0 ? product.imageUrls : [product.imageUrl]}
      sellerName={product.seller.businessName ?? product.seller.name}
      sellerLogoUrl={product.seller.logoUrl}
      sellerWhatsappNumber={product.seller.whatsappNumber}
      status={product.status}
    />
  )
}
