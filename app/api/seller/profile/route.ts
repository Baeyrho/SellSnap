import crypto from 'crypto'

import bcrypt from 'bcryptjs'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'
import { isValidEmail } from '@/lib/validation'
import { hashResetToken } from '@/lib/password-reset-token'
import { sendEmailChangeConfirmationEmail } from '@/lib/email'
import { logError } from '@/lib/logger'

const EMAIL_CHANGE_EXPIRY_MINUTES = 60

const WHATSAPP_REGEX = /^\+[1-9]\d{7,14}$/
const PHONE_REGEX = /^(\+[1-9]\d{7,14}|0[789][01]\d{8}|0\d{10})$/
const MAX_NAME_LENGTH = 80
const MIN_NAME_LENGTH = 2
const MAX_BIO_LENGTH = 160
const MAX_LOCATION_LENGTH = 100

/** GET /api/seller/profile — current seller's profile fields */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      displayName: true,
      businessName: true,
      businessBio: true,
      businessLocation: true,
      whatsappNumber: true,
      phoneNumber: true,
      logoUrl: true,
      bankCode: true,
      accountNumber: true,
      flutterwaveSubaccountId: true,
    },
  })

  if (!user) {
    return errorResponse(404, 'NOT_FOUND', 'User not found.')
  }

  return successResponse({
    name: user.name,
    email: user.email,
    displayName: user.displayName,
    businessName: user.businessName,
    businessBio: user.businessBio,
    businessLocation: user.businessLocation,
    whatsappNumber: user.whatsappNumber,
    phoneNumber: user.phoneNumber,
    logoUrl: user.logoUrl,
    hasBankConfigured: Boolean(user.bankCode && user.accountNumber),
    hasSubaccount: Boolean(user.flutterwaveSubaccountId),
  })
}

/** PATCH /api/seller/profile — update profile fields */
export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request body.')
  }

  // ── Email change — requires the current password and confirmation of the new address ─────────
  if (body.email !== undefined) {
    if (typeof body.email !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Email must be text.', 'email')
    }
    const newEmail = body.email.trim().toLowerCase()
    if (!isValidEmail(newEmail)) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Please enter a valid email address.', 'email')
    }

    if (typeof body.password !== 'string' || !body.password) {
      return errorResponse(
        400,
        'VALIDATION_ERROR',
        'Enter your current password to change your email.',
        'password'
      )
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, name: true, passwordHash: true },
    })
    if (!currentUser) {
      return errorResponse(404, 'NOT_FOUND', 'User not found.')
    }

    const passwordValid = await bcrypt.compare(body.password, currentUser.passwordHash)
    if (!passwordValid) {
      return errorResponse(400, 'INVALID_CREDENTIALS', 'Current password is incorrect.', 'password')
    }

    if (newEmail === currentUser.email) {
      return errorResponse(400, 'VALIDATION_ERROR', 'The new email must be different from your current email.', 'email')
    }

    // Block: email already in use by another live account
    const taken = await prisma.user.findUnique({ where: { email: newEmail } })
    if (taken) {
      return errorResponse(409, 'EMAIL_EXISTS', 'An account with this email already exists.', 'email')
    }

    // Block: email was previously retired
    const retired = await prisma.retiredEmail.findUnique({ where: { email: newEmail } })
    if (retired) {
      return errorResponse(409, 'EMAIL_RETIRED', 'You cannot use this email address.', 'email')
    }

    const rawToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_EXPIRY_MINUTES * 60 * 1000)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const confirmUrl = `${appUrl}/api/seller/profile/email/confirm?token=${rawToken}`

    try {
      // Replace any pending request: only the most recent link should remain valid.
      await prisma.$transaction([
        prisma.emailChangeToken.deleteMany({ where: { userId: session.user.id } }),
        prisma.emailChangeToken.create({
          data: {
            token: hashResetToken(rawToken),
            userId: session.user.id,
            newEmail,
            expiresAt,
          },
        }),
      ])

      await sendEmailChangeConfirmationEmail({
        to: newEmail,
        confirmUrl,
        name: currentUser.name,
      })
    } catch (error) {
      logError('seller.email_change_request_failed', { sellerId: session.user.id }, error)
      return errorResponse(500, 'SERVER_ERROR', 'Something went wrong. Please try again.')
    }

    // The change is not applied until the new address is confirmed via the emailed link.
    return successResponse({ pendingConfirmation: true, email: newEmail })
  }

  // ── All other profile fields ───────────────────────────────────────────────
  const updateData: Record<string, string | null> = {}

  if (body.name !== undefined) {
    if (typeof body.name !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Seller name must be text.', 'name')
    }
    const value = body.name.trim()
    if (value.length < MIN_NAME_LENGTH) {
      return errorResponse(400, 'VALIDATION_ERROR', `Seller name must be at least ${MIN_NAME_LENGTH} characters.`, 'name')
    }
    if (value.length > MAX_NAME_LENGTH) {
      return errorResponse(400, 'VALIDATION_ERROR', `Seller name must be ${MAX_NAME_LENGTH} characters or fewer.`, 'name')
    }
    updateData.name = value
  }

  if (body.displayName !== undefined) {
    if (body.displayName === null) {
      updateData.displayName = null
    } else if (typeof body.displayName !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Display name must be text.', 'displayName')
    } else {
      const value = body.displayName.trim()
      if (value.length > MAX_NAME_LENGTH) {
        return errorResponse(400, 'VALIDATION_ERROR', `Display name must be ${MAX_NAME_LENGTH} characters or fewer.`, 'displayName')
      }
      updateData.displayName = value.length > 0 ? value : null
    }
  }

  if (body.businessName !== undefined) {
    if (body.businessName === null || typeof body.businessName !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Business name is required.', 'businessName')
    }
    const value = body.businessName.trim()
    if (!value) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Business name is required.', 'businessName')
    }
    if (value.length > MAX_NAME_LENGTH) {
      return errorResponse(400, 'VALIDATION_ERROR', `Business name must be ${MAX_NAME_LENGTH} characters or fewer.`, 'businessName')
    }
    updateData.businessName = value
  }

  if (body.businessBio !== undefined) {
    if (body.businessBio === null) {
      updateData.businessBio = null
    } else if (typeof body.businessBio !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Business bio must be text.', 'businessBio')
    } else {
      const value = body.businessBio.trim()
      if (value.length > MAX_BIO_LENGTH) {
        return errorResponse(400, 'VALIDATION_ERROR', `Business bio must be ${MAX_BIO_LENGTH} characters or fewer.`, 'businessBio')
      }
      updateData.businessBio = value.length > 0 ? value : null
    }
  }

  if (body.businessLocation !== undefined) {
    if (body.businessLocation === null) {
      updateData.businessLocation = null
    } else if (typeof body.businessLocation !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Business location must be text.', 'businessLocation')
    } else {
      const value = body.businessLocation.trim()
      if (value.length > MAX_LOCATION_LENGTH) {
        return errorResponse(400, 'VALIDATION_ERROR', `Business location must be ${MAX_LOCATION_LENGTH} characters or fewer.`, 'businessLocation')
      }
      updateData.businessLocation = value.length > 0 ? value : null
    }
  }

  if (body.phoneNumber !== undefined) {
    if (body.phoneNumber === null) {
      updateData.phoneNumber = null
    } else if (typeof body.phoneNumber !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Phone number must be text.', 'phoneNumber')
    } else {
      const value = body.phoneNumber.trim()
      if (value.length > 0 && !PHONE_REGEX.test(value)) {
        return errorResponse(
          400,
          'VALIDATION_ERROR',
          'Please enter a valid phone number (e.g. +2348012345678 or 08012345678).',
          'phoneNumber'
        )
      }
      updateData.phoneNumber = value.length > 0 ? value : null
    }
  }

  if (body.whatsappNumber !== undefined) {
    if (body.whatsappNumber === null) {
      updateData.whatsappNumber = null
    } else if (typeof body.whatsappNumber !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'WhatsApp number must be text.', 'whatsappNumber')
    } else {
      const value = body.whatsappNumber.trim()
      if (value.length > 0 && !WHATSAPP_REGEX.test(value)) {
        return errorResponse(
          400,
          'VALIDATION_ERROR',
          'WhatsApp number must be in E.164 format, e.g. +2348012345678.',
          'whatsappNumber'
        )
      }
      updateData.whatsappNumber = value.length > 0 ? value : null
    }
  }

  if (body.logoUrl !== undefined) {
    if (body.logoUrl === null) {
      updateData.logoUrl = null
    } else if (
      typeof body.logoUrl !== 'string' ||
      !body.logoUrl.trim() ||
      body.logoUrl.trim().length > 500 ||
      (!body.logoUrl.startsWith('https://') &&
        !(body.logoUrl.startsWith('/') && !body.logoUrl.startsWith('//')))
    ) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Logo must be a valid image URL.', 'logoUrl')
    } else {
      updateData.logoUrl = body.logoUrl.trim()
    }
  }

  if (Object.keys(updateData).length === 0) {
    return errorResponse(400, 'VALIDATION_ERROR', 'No valid fields to update.')
  }

  try {
    const user = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
      select: {
        id: true,
        name: true,
        displayName: true,
        businessName: true,
        businessBio: true,
        businessLocation: true,
        whatsappNumber: true,
        phoneNumber: true,
        logoUrl: true,
        email: true,
      },
    })

    return successResponse({ user })
  } catch (error) {
    logError('seller.profile_update_failed', { sellerId: session.user.id }, error)
    return errorResponse(500, 'SERVER_ERROR', 'Something went wrong. Please try again.')
  }
}
