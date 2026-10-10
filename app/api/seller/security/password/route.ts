import bcrypt from 'bcryptjs'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'
import { passwordPolicyError } from '@/lib/validation'
import { logError } from '@/lib/logger'

/** POST /api/seller/security/password — change seller password */
export async function POST(req: Request) {
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

  const { currentPassword, newPassword, confirmPassword } = body

  if (!currentPassword || typeof currentPassword !== 'string') {
    return errorResponse(400, 'VALIDATION_ERROR', 'Current password is required.', 'currentPassword')
  }

  if (!newPassword || typeof newPassword !== 'string') {
    return errorResponse(400, 'VALIDATION_ERROR', 'New password is required.', 'newPassword')
  }

  const passwordError = passwordPolicyError(newPassword)
  if (passwordError) {
    return errorResponse(400, 'VALIDATION_ERROR', passwordError, 'newPassword')
  }

  if (newPassword !== confirmPassword) {
    return errorResponse(
      400,
      'VALIDATION_ERROR',
      'New password and confirmation do not match.',
      'confirmPassword'
    )
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  })

  if (!user) {
    return errorResponse(404, 'NOT_FOUND', 'User not found.')
  }

  const isCurrentValid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!isCurrentValid) {
    return errorResponse(
      400,
      'INVALID_CREDENTIALS',
      'Current password is incorrect.',
      'currentPassword'
    )
  }

  const newHash = await bcrypt.hash(newPassword, 12)

  try {
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        passwordHash: newHash,
        // Revoke every session (including this one) once the password changes.
        tokenVersion: { increment: 1 },
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    })
  } catch (error) {
    logError('seller.password_change_failed', { sellerId: session.user.id }, error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to change password.')
  }

  return successResponse({ message: 'Password changed successfully.' })
}
