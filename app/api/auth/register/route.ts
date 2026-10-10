import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

import { errorResponse, successResponse } from '@/lib/api'
import { isValidEmail, passwordPolicyError } from '@/lib/validation'
import { logError } from '@/lib/logger'

const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 80
const MAX_EMAIL_LENGTH = 254

// Returned identically whether or not the address is available, so registration cannot be used to
// discover which emails already have an account (the reset endpoint already behaves this way).
const GENERIC_RESPONSE = 'If this email is available, your account has been created.'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, email, password, bankCode, accountNumber } = body

    if (!name || !email || !password) {
      return errorResponse(400, 'MISSING_FIELDS', 'Name, email, and password are required.')
    }

    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return errorResponse(400, 'VALIDATION_ERROR', 'Name, email, and password must be text.')
    }

    const trimmedName = name.trim()
    if (trimmedName.length < MIN_NAME_LENGTH || trimmedName.length > MAX_NAME_LENGTH) {
      return errorResponse(
        400,
        'VALIDATION_ERROR',
        `Name must be between ${MIN_NAME_LENGTH} and ${MAX_NAME_LENGTH} characters.`,
        'name'
      )
    }

    const normalisedEmail = email.trim().toLowerCase()
    if (normalisedEmail.length > MAX_EMAIL_LENGTH || !isValidEmail(normalisedEmail)) {
      return errorResponse(400, 'VALIDATION_ERROR', 'Enter a valid email address.', 'email')
    }

    const passwordError = passwordPolicyError(password)
    if (passwordError) {
      return errorResponse(400, 'INVALID_PASSWORD', passwordError)
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: normalisedEmail },
    })

    // Permanently block emails that were previously used on another account
    const retiredEmail = await prisma.retiredEmail.findUnique({
      where: { email: normalisedEmail },
    })

    if (existingUser || retiredEmail) {
      return successResponse({ message: GENERIC_RESPONSE })
    }

    const passwordHash = await bcrypt.hash(password, 12)

    await prisma.user.create({
      data: {
        name: trimmedName,
        email: normalisedEmail,
        passwordHash,
        bankCode: bankCode ? String(bankCode).trim() : null,
        accountNumber: accountNumber ? String(accountNumber).trim() : null,
      },
    })

    return successResponse({ message: GENERIC_RESPONSE }, 201)
  } catch (error) {
    logError('auth.register_failed', undefined, error)
    if (error instanceof Error) {
      if (
        error.message.includes('connect') ||
        error.message.includes('timeout')
      ) {
        return errorResponse(
          503,
          'DATABASE_UNAVAILABLE',
          'Database is not available. Please try again later.'
        )
      }
    }
    return errorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred. Please try again.'
    )
  }
}
