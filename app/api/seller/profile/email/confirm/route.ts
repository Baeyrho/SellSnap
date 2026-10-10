import { NextResponse } from 'next/server'

import { prisma } from '@/lib/prisma'
import { hashResetToken } from '@/lib/password-reset-token'
import { sendEmailChangedNoticeEmail } from '@/lib/email'
import { logError, logWarn } from '@/lib/logger'

// Tied to a one-time token and mutates account state — never prerender or cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/seller/profile/email/confirm?token=... — apply a pending email change.
 *
 * The caller must present the token that was emailed to the *new* address, so this proves control
 * of that address before it becomes the login identity. On success every session is revoked
 * (tokenVersion bumped) because the JWT still carries the old email.
 *
 * A GET is used because the link arrives by email; possession of the token is the authorisation,
 * and a replayed or expired link finds no token and fails harmlessly.
 */
export async function GET(req: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const failureUrl = `${appUrl}/auth?view=login&emailChange=failed`

  const token = new URL(req.url).searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(failureUrl)
  }

  const record = await prisma.emailChangeToken.findUnique({
    where: { token: hashResetToken(token) },
    include: { user: { select: { id: true, email: true, name: true } } },
  })

  if (!record) {
    return NextResponse.redirect(failureUrl)
  }

  if (record.expiresAt < new Date()) {
    await prisma.emailChangeToken.deleteMany({ where: { userId: record.userId } })
    return NextResponse.redirect(failureUrl)
  }

  // The address may have been registered by someone else between request and confirmation.
  const taken = await prisma.user.findUnique({ where: { email: record.newEmail } })
  if (taken && taken.id !== record.userId) {
    await prisma.emailChangeToken.deleteMany({ where: { userId: record.userId } })
    return NextResponse.redirect(failureUrl)
  }

  const oldEmail = record.user.email
  const newEmail = record.newEmail

  try {
    await prisma.$transaction([
      // Upsert rather than create: an old address may already be retired from an earlier change.
      prisma.retiredEmail.upsert({
        where: { email: oldEmail },
        create: { email: oldEmail, userId: record.userId },
        update: {},
      }),
      prisma.user.update({
        where: { id: record.userId },
        data: {
          email: newEmail,
          // Invalidate every existing session — they still authenticate the old email.
          tokenVersion: { increment: 1 },
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      }),
      prisma.emailChangeToken.deleteMany({ where: { userId: record.userId } }),
    ])
  } catch (error) {
    logError('seller.email_change_confirm_failed', { sellerId: record.userId }, error)
    return NextResponse.redirect(failureUrl)
  }

  // Best-effort security notice to the previous address; a mail failure must not undo the change.
  try {
    await sendEmailChangedNoticeEmail({ to: oldEmail, newEmail, name: record.user.name })
  } catch {
    logWarn('seller.email_change_notice_failed', { sellerId: record.userId })
  }

  return NextResponse.redirect(`${appUrl}/auth?view=login&emailChange=confirmed`)
}
