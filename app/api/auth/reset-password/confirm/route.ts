import bcrypt from 'bcryptjs'

import { prisma } from '@/lib/prisma'
import { hashResetToken } from '@/lib/password-reset-token'
import { errorResponse, successResponse } from '@/lib/api'
import { passwordPolicyError } from '@/lib/validation'
import { logError } from '@/lib/logger'

/** POST /api/auth/reset-password/confirm — validate token and reset password */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { token, password } = body

    if (!token || typeof token !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Reset token is required.', 'token')
    }

    if (!password || typeof password !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'New password is required.', 'password')
    }

    const passwordError = passwordPolicyError(password)
    if (passwordError) {
      return errorResponse(400, 'VALIDATION_ERROR', passwordError, 'password')
    }

    // The submitted token is hashed with the same function used at issue time — the raw
    // value is never present in the database, so it cannot be looked up directly.
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { token: hashResetToken(token) },
      include: { user: true },
    })

    if (!resetToken) {
      return errorResponse(404, 'INVALID_TOKEN', 'Invalid or expired reset token.')
    }

    if (resetToken.expiresAt < new Date()) {
      await prisma.passwordResetToken.delete({ where: { id: resetToken.id } })
      return errorResponse(400, 'EXPIRED_TOKEN', 'Reset token has expired.')
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await prisma.$transaction([
      prisma.user.update({
        where: { id: resetToken.userId },
        data: {
          passwordHash,
          // Revoke every existing session and clear any lockout once the password is reset.
          tokenVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      // Invalidate every outstanding reset token, not just the one used, so an older emailed
      // link cannot be replayed after the account is recovered.
      prisma.passwordResetToken.deleteMany({ where: { userId: resetToken.userId } }),
    ])

    return successResponse({ message: 'Password has been reset successfully.' })
  } catch (error) {
    logError('auth.reset_confirm_failed', undefined, error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to reset password.')
  }
}
