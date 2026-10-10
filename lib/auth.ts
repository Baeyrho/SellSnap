import NextAuth, { type NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'

import { prisma } from './prisma'

/** A real bcrypt digest compared against when no account matches, so an unknown email and a wrong
 *  password cost the same time. Without it, login leaks which emails are registered via timing. */
const TIMING_PARITY_HASH =
  '$2b$12$MKsRgH3.rW0igW.moQaxuehV4Y/nB7Q7ZxxbSBqlezH2gXaXUp/qS'

const MAX_FAILED_LOGINS = 5
const LOCKOUT_MS = 15 * 60 * 1000

export const authConfig: NextAuthConfig = {
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials || typeof credentials.email !== 'string' || typeof credentials.password !== 'string') {
          return null
        }

        const email = credentials.email.trim().toLowerCase()

        const user = await prisma.user.findUnique({
          where: { email },
        })

        // Unknown or soft-deleted account: still spend the bcrypt time, then fail identically.
        if (!user || user.deletedAt) {
          await bcrypt.compare(credentials.password, TIMING_PARITY_HASH)
          return null
        }

        // Soft lockout after repeated failures. Cleared on the next successful login.
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.passwordHash
        )

        if (!isPasswordValid) {
          const attempts = user.failedLoginAttempts + 1

          await prisma.user.update({
            where: { id: user.id },
            data: {
              failedLoginAttempts: attempts,
              lockedUntil:
                attempts >= MAX_FAILED_LOGINS
                  ? new Date(Date.now() + LOCKOUT_MS)
                  : user.lockedUntil,
            },
          })

          return null
        }

        if (user.failedLoginAttempts !== 0 || user.lockedUntil) {
          await prisma.user.update({
            where: { id: user.id },
            data: { failedLoginAttempts: 0, lockedUntil: null },
          })
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          tokenVersion: user.tokenVersion,
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },
  callbacks: {
    async session({ session, token }) {
      if (session.user) {
        // A revoked token carries no usable identity; every guard tests `session.user.id`.
        const userId = token.invalid ? undefined : token.sub
        session.user.id = userId ?? ''
      }
      return session
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id
        token.tokenVersion = user.tokenVersion
      }

      // Re-validate on every access so bumping `tokenVersion` (password/email change) or
      // soft-deleting the account invalidates already-issued JWTs instead of leaving a stolen
      // token usable for the full 30-day lifetime.
      if (token.sub) {
        const current = await prisma.user.findUnique({
          where: { id: token.sub },
          select: { tokenVersion: true, deletedAt: true },
        })

        token.invalid =
          !current ||
          current.deletedAt !== null ||
          current.tokenVersion !== token.tokenVersion
      } else {
        token.invalid = true
      }

      return token
    },
  },
  pages: {
    signIn: '/auth',
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
