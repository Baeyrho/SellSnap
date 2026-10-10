import bcrypt from 'bcryptjs'

import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'
import { createSubaccount } from '@/lib/flutterwave'
import { logError } from '@/lib/logger'

const ACCOUNT_NUMBER_REGEX = /^\d{10}$/
const MAX_BANK_CODE_LENGTH = 10

/** GET /api/seller/bank-account — fetch current profile & bank details */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
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
    bankCode: user.bankCode ?? '',
    accountNumber: user.accountNumber ?? '',
    hasSubaccount: !!user.flutterwaveSubaccountId,
  })
}

/** PATCH /api/seller/bank-account — update bank details.
 *
 *  Changing an already-configured payout destination requires the current password (step-up), so a
 *  hijacked session cannot silently redirect a seller's money. The Flutterwave subaccount is only
 *  created when the details actually change, and if creation fails the new details are NOT stored —
 *  otherwise the dashboard would show an account that payments are not actually routed to. */
export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  try {
    const body = (await req.json()) as Record<string, unknown>
    const { bankCode, accountNumber, currentPassword } = body

    if (!bankCode || !accountNumber) {
      return errorResponse(400, 'MISSING_FIELDS', 'Bank code and account number are required.')
    }

    const trimmedCode = String(bankCode).trim()
    const trimmedAccount = String(accountNumber).trim()

    if (!trimmedCode || trimmedCode.length > MAX_BANK_CODE_LENGTH) {
      return errorResponse(400, 'INVALID_BANK_CODE', 'Please select a valid bank.')
    }

    if (!ACCOUNT_NUMBER_REGEX.test(trimmedAccount)) {
      return errorResponse(400, 'INVALID_ACCOUNT', 'Account number must be exactly 10 digits.')
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        name: true,
        email: true,
        passwordHash: true,
        bankCode: true,
        accountNumber: true,
        flutterwaveSubaccountId: true,
      },
    })

    if (!user) {
      return errorResponse(404, 'NOT_FOUND', 'User not found.')
    }

    const isConfigured = Boolean(user.bankCode && user.accountNumber)
    const detailsChanged =
      user.bankCode !== trimmedCode || user.accountNumber !== trimmedAccount

    // Step-up authentication for changing an existing payout destination.
    if (isConfigured) {
      if (typeof currentPassword !== 'string' || !currentPassword) {
        return errorResponse(
          400,
          'VALIDATION_ERROR',
          'Enter your current password to change your bank account.',
          'currentPassword'
        )
      }

      const passwordValid = await bcrypt.compare(currentPassword, user.passwordHash)
      if (!passwordValid) {
        return errorResponse(400, 'INVALID_CREDENTIALS', 'Current password is incorrect.', 'currentPassword')
      }
    }

    // No change and a usable subaccount already exists → nothing to do, and no provider call.
    if (!detailsChanged && user.flutterwaveSubaccountId) {
      return successResponse({
        bankCode: user.bankCode,
        accountNumber: user.accountNumber,
        hasSubaccount: true,
      })
    }

    let subaccountId = user.flutterwaveSubaccountId

    if (process.env.FLUTTERWAVE_SECRET_KEY) {
      try {
        const result = await createSubaccount(
          trimmedCode,
          trimmedAccount,
          user.name || 'SellSnap Seller',
          user.email
        )

        if (!result?.subaccount_id) {
          throw new Error('Subaccount response contained no usable id')
        }

        subaccountId = result.subaccount_id
      } catch (subaccountError) {
        // Do not persist bank details that payments will not actually be routed to.
        logError(
          'seller.subaccount_creation_failed',
          { sellerId: session.user.id },
          subaccountError
        )
        return errorResponse(
          502,
          'SUBACCOUNT_FAILED',
          'Could not verify these bank details with Flutterwave. Please try again.'
        )
      }
    }

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data: {
        bankCode: trimmedCode,
        accountNumber: trimmedAccount,
        ...(subaccountId ? { flutterwaveSubaccountId: subaccountId } : {}),
      },
      select: { bankCode: true, accountNumber: true, flutterwaveSubaccountId: true },
    })

    return successResponse({
      bankCode: updated.bankCode,
      accountNumber: updated.accountNumber,
      hasSubaccount: !!updated.flutterwaveSubaccountId,
    })
  } catch (error) {
    logError('seller.bank_account_update_failed', { sellerId: session.user.id }, error)
    return errorResponse(500, 'INTERNAL_ERROR', 'Failed to update bank details.')
  }
}
