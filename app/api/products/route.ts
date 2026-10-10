import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'
import { uploadProductImages } from '@/lib/blob'
import { generateSlug } from '@/lib/nanoid'
import { nairaToKobo } from '@/lib/kobo'
import { logError } from '@/lib/logger'

const MAX_NAME_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 2000
/** NGN 10,000,000 in kobo — well within PostgreSQL's 32-bit Int and a sane ceiling for the market. */
const MAX_PRICE_KOBO = 1_000_000_000

/** GET /api/products — list current seller's products */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  const products = await prisma.product.findMany({
    where: { sellerId: session.user.id, status: { not: 'DELETED' } },
    orderBy: { createdAt: 'desc' },
  })

  return successResponse({ products })
}

/** POST /api/products — create a new product (supports 1 to 3 images) */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  try {
    const formData = await req.formData()

    const name = formData.get('name')
    const priceNairaStr = formData.get('priceNaira')
    const description = formData.get('description')

    if (!name || typeof name !== 'string' || !name.trim()) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Product name is required.', 'name')
    }

    if (name.trim().length > MAX_NAME_LENGTH) {
      return errorResponse(400, 'VALIDATION_ERROR', `Product name must be ${MAX_NAME_LENGTH} characters or fewer.`, 'name')
    }

    if (description !== null && description !== undefined) {
      if (typeof description !== 'string') {
        return errorResponse(400, 'VALIDATION_ERROR', 'Description must be text.', 'description')
      }
      if (description.trim().length > MAX_DESCRIPTION_LENGTH) {
        return errorResponse(400, 'VALIDATION_ERROR', `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`, 'description')
      }
    }

    if (!priceNairaStr || typeof priceNairaStr !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Price is required.', 'price')
    }

    const priceNaira = Number(priceNairaStr)
    if (isNaN(priceNaira) || priceNaira <= 0) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Price must be greater than 0.', 'price')
    }

    const priceKobo = nairaToKobo(priceNaira)
    if (!Number.isInteger(priceKobo) || priceKobo <= 0 || priceKobo > MAX_PRICE_KOBO) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Invalid price value.', 'price')
    }

    // Collect all uploaded images from 'images' or 'image' form fields
    const rawEntries = [...formData.getAll('images'), ...formData.getAll('image')]
    const images: File[] = []
    for (const entry of rawEntries) {
      if (entry instanceof File && entry.size > 0) {
        images.push(entry)
      }
    }

    if (images.length === 0) {
      return errorResponse(400, 'VALIDATION_ERROR', 'At least one product image is required.', 'image')
    }

    if (images.length > 3) {
      return errorResponse(400, 'VALIDATION_ERROR', 'You can upload a maximum of 3 images.', 'image')
    }

    // Upload images with server-side validation (magic bytes + 5MB size limit each)
    const uploadedUrls = await uploadProductImages(images)

    const slug = generateSlug()

    const product = await prisma.product.create({
      data: {
        sellerId: session.user.id,
        slug,
        name: name.trim(),
        description: description && typeof description === 'string' ? description.trim() || null : null,
        priceKobo,
        imageUrl: uploadedUrls[0],
        imageUrls: uploadedUrls,
      },
    })

    return successResponse({ product }, 201)
  } catch (error) {
    logError('products.create_failed', undefined, error)

    if (error instanceof Error) {
      if (
        error.message.includes('5MB') ||
        error.message.includes('Invalid image') ||
        error.message.includes('maximum of 3 images') ||
        error.message.includes('At least one product image')
      ) {
        return errorResponse(400, 'VALIDATION_ERROR', error.message, 'image')
      }
    }

    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to create product.')
  }
}
