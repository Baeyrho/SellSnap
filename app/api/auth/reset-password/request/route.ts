import crypto from 'crypto'

import { prisma } from '@/lib/prisma'
import { sendPasswordResetEmail } from '@/lib/email'
import { hashResetToken } from '@/lib/password-reset-token'
import { isValidEmail } from '@/lib/validation'
import { errorResponse, successResponse } from '@/lib/api'
import { logError } from '@/lib/logger'

const RESET_URL_BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const TOKEN_EXPIRY_MINUTES = 60
const RESET_REQUESTS_PER_EMAIL_PER_HOUR = 3

// Identical for every outcome so the endpoint cannot be used to discover which emails are registered.
const GENERIC_RESPONSE = 'If an account exists with this email, a reset link has been sent.'

/** POST /api/auth/reset-password/request — generate reset token and send email */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { email } = body

    if (typeof email !== 'string' || !email.trim()) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Email is required.', 'email')
    }

    const normalisedEmail = email.trim().toLowerCase()

    if (!isValidEmail(normalisedEmail)) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Enter a valid email address.', 'email')
    }

    const user = await prisma.user.findUnique({
      where: { email: normalisedEmail },
    })

    // Always return 200 to prevent email enumeration
    if (!user) {
      return successResponse({ message: GENERIC_RESPONSE })
    }

    // Per-address throttle. The token table doubles as the ledger so this endpoint cannot be
    // used to spam one inbox or to grow the table without bound. Middleware already limits per IP.
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
    const recentRequestCount = await prisma.passwordResetToken.count({
      where: {
        userId: user.id,
        createdAt: { gte: oneHourAgo },
      },
    })

    if (recentRequestCount >= RESET_REQUESTS_PER_EMAIL_PER_HOUR) {
      return successResponse({ message: GENERIC_RESPONSE })
    }

    const rawToken = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000)

    // Only the digest is persisted. A leaked database row must not yield a usable reset link.
    await prisma.passwordResetToken.create({
      data: {
        token: hashResetToken(rawToken),
        userId: user.id,
        expiresAt,
      },
    })

    const resetUrl = `${RESET_URL_BASE}/auth?view=reset-password&token=${rawToken}`

    await sendPasswordResetEmail({
      to: user.email,
      resetUrl,
      name: user.name,
    })

    return successResponse({ message: GENERIC_RESPONSE })
  } catch (error) {
    logError('auth.reset_request_failed', undefined, error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to process password reset request.')
  }
}
