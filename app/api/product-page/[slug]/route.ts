import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'

// Public product data changes (edit/delete) and must not be served stale from a cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

interface RouteParams {
  params: Promise<{ slug: string }>
}

/** GET /api/product-page/[slug] — public product data, no auth */
export async function GET(_req: Request, { params }: RouteParams) {
  const { slug } = await params
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      seller: {
        select: { id: true, name: true, businessName: true, businessBio: true, logoUrl: true, whatsappNumber: true },
      },
    },
  })

  if (!product || product.status === 'DELETED') {
    return errorResponse(404, 'NOT_FOUND', 'Product not found.')
  }

  return successResponse({
    product: {
      slug: product.slug,
      name: product.name,
      description: product.description,
      priceKobo: product.priceKobo,
      imageUrl: product.imageUrl,
      imageUrls: product.imageUrls && product.imageUrls.length > 0 ? product.imageUrls : [product.imageUrl],
      sellerName: product.seller.name,
      seller: {
        businessName: product.seller.businessName ?? product.seller.name,
        businessBio: product.seller.businessBio,
        logoUrl: product.seller.logoUrl,
        whatsappNumber: product.seller.whatsappNumber,
      },
    },
  })
}
