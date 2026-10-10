import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'
import { uploadLogoImage } from '@/lib/blob'
import { logError } from '@/lib/logger'

/** POST /api/seller/profile/logo — upload a logo image to Vercel Blob */
export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  try {
    const formData = await req.formData()
    const logo = formData.get('logo')

    if (!logo || !(logo instanceof File)) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Logo image is required.', 'logo')
    }

    // Server-side validation (magic bytes + 5 MB size) happens in uploadLogoImage
    const { url } = await uploadLogoImage(logo)

    await prisma.user.update({
      where: { id: session.user.id },
      data: { logoUrl: url },
    })

    return successResponse({ logoUrl: url })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('5MB') || error.message.includes('Invalid image')) {
        return errorResponse(400, 'VALIDATION_ERROR', error.message, 'logo')
      }
    }

    logError('seller.logo_upload_failed', { sellerId: session.user.id }, error)
    return errorResponse(500, 'SERVER_ERROR', 'Failed to upload logo. Please try again.')
  }
}
