/** Pragmatic email shape check. Deliberately permissive on syntax — the authoritative test is
 * whether the provider accepts the address — but strict about character set: only ASCII is
 * accepted. Non-ASCII (Unicode homoglyph) addresses are rejected so two visually identical
 * addresses can never be treated as different accounts (see the Auth.js homoglyph-@ advisory). */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ASCII_ONLY = /^[\x00-\x7F]+$/

/** Return true when the value looks like a deliverable, ASCII-only email address. */
export function isValidEmail(value: string): boolean {
  const trimmed = value.trim()
  if (!ASCII_ONLY.test(trimmed)) return false
  return EMAIL_REGEX.test(trimmed)
}

const PASSWORD_MIN_LENGTH = 8
const PASSWORD_UPPERCASE_AND_DIGIT = /^(?=.*[A-Z])(?=.*\d)/

/** The one password policy shared by every route: length plus uppercase and digit. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return 'Password must be at least 8 characters.'
  }
  if (!PASSWORD_UPPERCASE_AND_DIGIT.test(password)) {
    return 'Password must contain at least one uppercase letter and one number.'
  }
  return null
}
