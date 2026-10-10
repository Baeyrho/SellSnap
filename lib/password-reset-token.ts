import crypto from 'crypto'

/** Hash a password-reset token for storage.
 *
 * Reset tokens are 32 bytes of CSPRNG output (256 bits of entropy), so a fast
 * digest is the right primitive here — bcrypt/argon2 exist to slow down brute
 * force against low-entropy secrets, which is not this case.
 *
 * NOTE: This function must be used identically by the route that issues a token
 * and the route that verifies it. A mismatch silently breaks every reset. */
export function hashResetToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken, 'utf8').digest('hex')
}
