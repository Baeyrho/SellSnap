import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'
import { uploadProductImage } from '@/lib/blob'
import { nairaToKobo } from '@/lib/kobo'
import { logError } from '@/lib/logger'

const MAX_NAME_LENGTH = 120
const MAX_DESCRIPTION_LENGTH = 2000
const MAX_PRICE_KOBO = 1_000_000_000
const MAX_IMAGE_URL_LENGTH = 500

/** Only app-relative paths or absolute https URLs are storable; `javascript:`, `data:`, and
 *  protocol-relative `//host` values are rejected so a product image can never be an arbitrary
 *  external or scriptable target. */
function isValidImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > MAX_IMAGE_URL_LENGTH) return false
  if (value.startsWith('https://')) return true
  return value.startsWith('/') && !value.startsWith('//')
}

interface RouteParams {
  params: Promise<{ id: string }>
}

/** GET /api/products/[id] — fetch a single product */
export async function GET(_req: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return errorResponse(404, 'NOT_FOUND', 'This product does not exist.')
  if (product.sellerId !== session.user.id) return errorResponse(403, 'FORBIDDEN', 'You do not have access to this product.')

  return successResponse({ product })
}

/** PATCH /api/products/[id] — update a product — accepts JSON or multipart form data (with optional new image) */
export async function PATCH(req: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return errorResponse(404, 'NOT_FOUND', 'This product does not exist.')
  if (product.sellerId !== session.user.id) return errorResponse(403, 'FORBIDDEN', 'You do not have access to this product.')

  try {
    const contentType = req.headers.get('content-type') ?? ''
    const data: Record<string, unknown> = {}
    let name: unknown
    let description: unknown
    let priceKobo: unknown

    let hasImageUpdates = false
    const existingImageUrls: string[] = []
    const newImageFiles: File[] = []

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      name = formData.get('name')
      description = formData.has('description') ? formData.get('description') : undefined
      const priceNaira = formData.get('priceNaira')
      if (priceNaira && typeof priceNaira === 'string') {
        const value = Number(priceNaira)
        if (!isNaN(value)) priceKobo = nairaToKobo(value)
      }

      // Check if image update was requested
      const rawExisting = [...formData.getAll('existingImages'), ...formData.getAll('existingImageUrls')]
      for (const entry of rawExisting) {
        if (typeof entry === 'string' && entry.trim()) {
          if (!isValidImageUrl(entry.trim())) {
            return errorResponse(400, 'VALIDATION_ERROR', 'Invalid image URL.', 'image')
          }
          existingImageUrls.push(entry.trim())
        }
      }

      const rawFiles = [...formData.getAll('images'), ...formData.getAll('image')]
      for (const entry of rawFiles) {
        if (entry instanceof File && entry.size > 0) {
          newImageFiles.push(entry)
        }
      }

      if (
        formData.has('existingImages') ||
        formData.has('existingImageUrls') ||
        formData.has('images') ||
        formData.has('image')
      ) {
        hasImageUpdates = true
      }
    } else {
      const body = await req.json()
      name = body.name
      description = body.description
      priceKobo = body.priceKobo

      if (body.imageUrls !== undefined) {
        if (!Array.isArray(body.imageUrls) || body.imageUrls.length === 0) {
          return errorResponse(400, 'VALIDATION_ERROR', 'At least one product image is required.', 'imageUrls')
        }
        if (body.imageUrls.length > 3) {
          return errorResponse(400, 'VALIDATION_ERROR', 'You can upload a maximum of 3 images.', 'imageUrls')
        }
        if (!body.imageUrls.every(isValidImageUrl)) {
          return errorResponse(400, 'VALIDATION_ERROR', 'Invalid image URL.', 'imageUrls')
        }
        data.imageUrl = body.imageUrls[0]
        data.imageUrls = body.imageUrls
      } else if (body.imageUrl !== undefined) {
        if (!isValidImageUrl(body.imageUrl)) {
          return errorResponse(400, 'VALIDATION_ERROR', 'Invalid image URL.', 'imageUrl')
        }
        data.imageUrl = body.imageUrl
        data.imageUrls = [body.imageUrl]
      }
    }

    if (name && typeof name === 'string') {
      const trimmedName = name.trim()
      if (trimmedName.length > MAX_NAME_LENGTH) {
        return errorResponse(400, 'VALIDATION_ERROR', `Product name must be ${MAX_NAME_LENGTH} characters or fewer.`, 'name')
      }
      data.name = trimmedName
    }

    if (description !== undefined) {
      if (typeof description === 'string' && description.trim().length > MAX_DESCRIPTION_LENGTH) {
        return errorResponse(400, 'VALIDATION_ERROR', `Description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer.`, 'description')
      }
      data.description = typeof description === 'string' ? description.trim() || null : null
    }

    if (priceKobo !== undefined) {
      if (
        typeof priceKobo !== 'number' ||
        !Number.isInteger(priceKobo) ||
        priceKobo <= 0 ||
        priceKobo > MAX_PRICE_KOBO
      ) {
        return errorResponse(400, 'VALIDATION_ERROR', 'Price must be a positive integer in kobo.', 'priceKobo')
      }
      data.priceKobo = priceKobo
    }

    if (hasImageUpdates) {
      const totalCount = existingImageUrls.length + newImageFiles.length
      if (totalCount === 0) {
        return errorResponse(400, 'VALIDATION_ERROR', 'At least one product image is required.', 'image')
      }
      if (totalCount > 3) {
        return errorResponse(400, 'VALIDATION_ERROR', 'You can upload a maximum of 3 images.', 'image')
      }

      const uploadResults = await Promise.all(
        newImageFiles.map((file) => uploadProductImage(file))
      )
      const uploadedUrls = uploadResults.map((r) => r.url)
      const combinedUrls = [...existingImageUrls, ...uploadedUrls]

      data.imageUrl = combinedUrls[0]
      data.imageUrls = combinedUrls
    }

    if (Object.keys(data).length === 0) {
      return errorResponse(400, 'VALIDATION_ERROR', 'No valid fields to update.')
    }

    const updated = await prisma.product.update({
      where: { id: id },
      data,
    })

    return successResponse({ product: updated })
  } catch (error) {
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
    logError('products.update_failed', { productId: id }, error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to update product.')
  }
}

/** DELETE /api/products/[id] — soft delete a product */
export async function DELETE(_req: Request, { params }: RouteParams) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) return errorResponse(404, 'NOT_FOUND', 'This product does not exist.')
  if (product.sellerId !== session.user.id) return errorResponse(403, 'FORBIDDEN', 'You do not have access to this product.')

  if (product.status === 'DELETED') {
    return errorResponse(404, 'NOT_FOUND', 'This product has been deleted.')
  }

  try {
    await prisma.product.update({
      where: { id: id },
      data: {
        deletedAt: new Date(),
        status: 'DELETED',
      },
    })
    return successResponse({ deleted: true })
  } catch (error) {
    logError('products.delete_failed', { productId: id }, error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to delete product.')
  }
}
