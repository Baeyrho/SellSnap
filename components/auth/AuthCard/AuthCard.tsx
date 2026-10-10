'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { signIn } from 'next-auth/react'

import { resolveAuthView, type AuthView } from '@/lib/auth-views'
import { passwordPolicyError } from '@/lib/validation'

import { Input } from '@/components/ui/Input/Input'
import { Button } from '@/components/ui/Button/Button'

import styles from './AuthCard.module.css'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const EMAIL_VALIDATION_MESSAGE = 'Enter a valid email address'

const isStrongPassword = (password: string): boolean =>
  passwordPolicyError(password) === null

export function AuthCard() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const urlView = searchParams.get('view')
  const urlToken = searchParams.get('token')

  const [view, setView] = useState<AuthView>(() =>
    resolveAuthView({ view: urlView, token: urlToken })
  )

  // Login form state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginEmailError, setLoginEmailError] = useState<string | null>(null)
  const [loginLoading, setLoginLoading] = useState(false)
  const [isRegistered, setIsRegistered] = useState(false)

  // Signup form state
  const [signupData, setSignupData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [signupErrors, setSignupErrors] = useState<Record<string, string>>({})
  const [signupLoading, setSignupLoading] = useState(false)

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState<string | null>(null)
  const [forgotEmailError, setForgotEmailError] = useState<string | null>(null)
  const [forgotSubmitted, setForgotSubmitted] = useState(false)

  // Reset password state
  const [resetPassword, setResetPassword] = useState('')
  const [resetConfirmPassword, setResetConfirmPassword] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState(false)

  // Follow external URL changes (back/forward, a link landing on ?view=...) by adjusting state
  // during render with a previous-value guard, React's documented alternative to an effect that
  // calls setState after paint. The view switches in the same commit as the navigation.
  const urlKey = `${urlView ?? ''}\u0000${urlToken ?? ''}`
  const [prevUrlKey, setPrevUrlKey] = useState(urlKey)
  if (urlKey !== prevUrlKey) {
    setPrevUrlKey(urlKey)
    setView(resolveAuthView({ view: urlView, token: urlToken }))
  }

  const switchView = (newView: AuthView) => {
    setView(newView)
    // Clear transient errors
    setLoginError('')
    setLoginEmailError(null)
    setSignupErrors({})
    setForgotError(null)
    setForgotEmailError(null)
    setResetError(null)

    // Update URL query parameter smoothly
    const params = new URLSearchParams(window.location.search)
    params.set('view', newView)
    // resolveAuthView gives `token` precedence over `view`, so a reset token left in the URL
    // would resolve the next sync straight back to reset-password and undo this switch.
    if (newView !== 'reset-password') {
      params.delete('token')
    }
    router.replace(`/auth?${params.toString()}`, { scroll: false })
  }

  // --- Handlers ---
  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoginError('')
    setLoginLoading(true)

    try {
      const res = await signIn('credentials', {
        redirect: false,
        email: loginEmail,
        password: loginPassword,
      })

      if (res?.ok) {
        router.push('/dashboard')
      } else {
        setLoginError('Invalid email or password')
      }
    } catch {
      setLoginError('An error occurred. Please try again.')
    } finally {
      setLoginLoading(false)
    }
  }

  const validateSignup = (): boolean => {
    const errs: Record<string, string> = {}

    if (!signupData.name.trim()) errs.name = 'Name is required'
    if (!signupData.email.trim()) errs.email = 'Email is required'
    if (!signupData.password) errs.password = 'Password is required'
    if (signupData.password.length < 8) {
      errs.password = 'Password must be at least 8 characters'
    }
    if (!/(?=.*[A-Z])(?=.*\d)/.test(signupData.password)) {
      errs.password = 'Password must contain at least one uppercase letter and one number'
    }
    if (signupData.password !== signupData.confirmPassword) {
      errs.confirmPassword = 'Passwords do not match'
    }

    setSignupErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSignupSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateSignup()) return

    setSignupLoading(true)
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: signupData.name,
          email: signupData.email,
          password: signupData.password,
        }),
      })

      if (res.ok) {
        const autoSignIn = await signIn('credentials', {
          redirect: false,
          email: signupData.email.trim().toLowerCase(),
          password: signupData.password,
        })

        if (autoSignIn?.ok) {
          router.push('/dashboard')
        } else {
          setLoginEmail(signupData.email.trim().toLowerCase())
          setIsRegistered(true)
          switchView('login')
        }
      } else {
        const data = await res.json()
        setSignupErrors({ submit: data.error?.message ?? `Registration failed (${res.status})` })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error - please try again'
      setSignupErrors({ submit: message })
    } finally {
      setSignupLoading(false)
    }
  }

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setForgotError(null)
    setForgotLoading(true)

    try {
      const res = await fetch('/api/auth/reset-password/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      })

      const json = await res.json()
      if (!res.ok) {
        setForgotError(json.error?.message || 'Something went wrong.')
        return
      }

      setForgotSubmitted(true)
    } catch {
      setForgotError('Unable to connect. Please try again.')
    } finally {
      setForgotLoading(false)
    }
  }

  const handleResetSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setResetError(null)

    if (!urlToken) {
      setResetError('Invalid or missing reset token.')
      return
    }

    if (resetPassword !== resetConfirmPassword) {
      setResetError('Passwords do not match.')
      return
    }

    setResetLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: urlToken, password: resetPassword }),
      })

      const json = await res.json()
      if (!res.ok) {
        setResetError(json.error?.message || 'Something went wrong.')
        return
      }

      setResetSuccess(true)
      setTimeout(() => {
        switchView('login')
      }, 2500)
    } catch {
      setResetError('Unable to connect. Please try again.')
    } finally {
      setResetLoading(false)
    }
  }

  const isLoginValid = EMAIL_REGEX.test(loginEmail) && loginPassword.length > 0
  const isSignupValid =
    signupData.name.trim().length > 0 &&
    EMAIL_REGEX.test(signupData.email) &&
    isStrongPassword(signupData.password) &&
    signupData.confirmPassword === signupData.password
  const isForgotValid = EMAIL_REGEX.test(forgotEmail)
  const isResetValid =
    isStrongPassword(resetPassword) && resetConfirmPassword === resetPassword

  return (
    <main className={styles.container}>
      <Link href="/" className={styles.backLink} aria-label="Back to homepage">
        <span className={styles.backArrow}>←</span>
        <span>Back to home</span>
      </Link>

      <div className={styles.panel}>
        {/* 1. LOGIN VIEW */}
        {view === 'login' && (
          <>
            <h1 className={styles.title}>Welcome back</h1>

            <form className={styles.form} onSubmit={handleLoginSubmit}>
              {isRegistered && (
                <p className={styles.success}>Account created successfully! Please sign in.</p>
              )}

              <Input
                label="Enter Email"
                type="email"
                placeholder="you@example.com"
                value={loginEmail}
                onChange={(e) => {
                  const value = e.target.value
                  setLoginEmail(value)
                  setLoginEmailError(
                    value && !EMAIL_REGEX.test(value) ? EMAIL_VALIDATION_MESSAGE : null
                  )
                }}
                error={loginEmailError ?? undefined}
                onFocus={() => setLoginError('')}
                autoComplete="email"
                required
              />

              <Input
                label="Enter Password"
                type="password"
                placeholder="Enter your password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                onFocus={() => setLoginError('')}
                autoComplete="current-password"
                showPasswordToggle
                required
              />

              <div className={styles.forgotRow}>
                <button
                  type="button"
                  className={styles.forgotLink}
                  onClick={() => switchView('forgot-password')}
                >
                  Forgot password?
                </button>
              </div>

              {loginError && <p className={styles.error}>{loginError}</p>}

              <Button type="submit" disabled={loginLoading || !isLoginValid} className={styles.submitBtn}>
                {loginLoading ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>

            <p className={styles.footer}>
              Don&apos;t have an account?{' '}
              <button
                type="button"
                className={styles.switchBtn}
                onClick={() => switchView('signup')}
              >
                Create one
              </button>
            </p>
          </>
        )}

        {/* 2. SIGNUP VIEW */}
        {view === 'signup' && (
          <>
            <h1 className={styles.title}>Create your account</h1>

            <form className={styles.form} onSubmit={handleSignupSubmit}>
              <Input
                label="Enter Full Name"
                type="text"
                placeholder="John Doe"
                value={signupData.name}
                onChange={(e) => {
                  setSignupData((prev) => ({ ...prev, name: e.target.value }))
                  if (signupErrors.name) {
                    setSignupErrors((prev) => {
                      const next = { ...prev }
                      delete next.name
                      return next
                    })
                  }
                }}
                error={signupErrors.name}
                autoComplete="name"
                autoFocus
              />

              <Input
                label="Enter Email"
                type="email"
                placeholder="you@example.com"
                value={signupData.email}
                onChange={(e) => {
                  const value = e.target.value
                  setSignupData((prev) => ({ ...prev, email: value }))
                  setSignupErrors((prev) => {
                    const next = { ...prev }
                    if (value && !EMAIL_REGEX.test(value)) {
                      next.email = EMAIL_VALIDATION_MESSAGE
                    } else {
                      delete next.email
                    }
                    return next
                  })
                }}
                error={signupErrors.email}
                autoComplete="email"
              />

              <Input
                label="Enter Password"
                type="password"
                placeholder="8+ chars, uppercase + number"
                value={signupData.password}
                onChange={(e) => {
                  setSignupData((prev) => ({ ...prev, password: e.target.value }))
                  if (signupErrors.password) {
                    setSignupErrors((prev) => {
                      const next = { ...prev }
                      delete next.password
                      return next
                    })
                  }
                }}
                error={signupErrors.password}
                autoComplete="new-password"
                showPasswordToggle
              />

              <Input
                label="Confirm Password"
                type="password"
                placeholder="Re-enter your password"
                value={signupData.confirmPassword}
                onChange={(e) => {
                  setSignupData((prev) => ({ ...prev, confirmPassword: e.target.value }))
                  if (signupErrors.confirmPassword) {
                    setSignupErrors((prev) => {
                      const next = { ...prev }
                      delete next.confirmPassword
                      return next
                    })
                  }
                }}
                error={signupErrors.confirmPassword}
                autoComplete="new-password"
                showPasswordToggle
              />

              {signupErrors.submit && <p className={styles.error}>{signupErrors.submit}</p>}

              <Button type="submit" disabled={signupLoading || !isSignupValid} className={styles.submitBtn}>
                {signupLoading ? 'Creating account...' : 'Create account'}
              </Button>
            </form>

            <p className={styles.footer}>
              Already have an account?{' '}
              <button
                type="button"
                className={styles.switchBtn}
                onClick={() => switchView('login')}
              >
                Sign in
              </button>
            </p>
          </>
        )}

        {/* 3. FORGOT PASSWORD VIEW */}
        {view === 'forgot-password' && (
          <>
            <h1 className={styles.title}>Forgot password?</h1>

            {forgotSubmitted ? (
              <div className={styles.form}>
                <p className={styles.success}>
                  If an account exists with this email, we have sent a password reset link.
                </p>
                <Button
                  type="button"
                  variant="primary"
                  className={styles.submitBtn}
                  onClick={() => {
                    setForgotSubmitted(false)
                    switchView('login')
                  }}
                >
                  Back to Sign In
                </Button>
              </div>
            ) : (
              <form className={styles.form} onSubmit={handleForgotSubmit}>
                <Input
                  label="Enter Email"
                  type="email"
                  placeholder="you@example.com"
                  value={forgotEmail}
                  onChange={(e) => {
                    const value = e.target.value
                    setForgotEmail(value)
                    setForgotEmailError(
                      value && !EMAIL_REGEX.test(value) ? EMAIL_VALIDATION_MESSAGE : null
                    )
                  }}
                  error={forgotEmailError ?? undefined}
                  required
                  autoComplete="email"
                />

                {forgotError && <p className={styles.error}>{forgotError}</p>}

                <Button
                  type="submit"
                  variant="primary"
                  disabled={forgotLoading || !isForgotValid}
                  className={styles.submitBtn}
                >
                  {forgotLoading ? 'Sending...' : 'Send reset link'}
                </Button>
              </form>
            )}

            <p className={styles.footer}>
              Remember your password?{' '}
              <button
                type="button"
                className={styles.switchBtn}
                onClick={() => switchView('login')}
              >
                Sign in
              </button>
            </p>
          </>
        )}

        {/* 4. RESET PASSWORD VIEW */}
        {view === 'reset-password' && (
          <>
            <h1 className={styles.title}>Set new password</h1>

            {resetSuccess ? (
              <div className={styles.form}>
                <p className={styles.success}>
                  Your password has been updated! Redirecting to sign in...
                </p>
                <Button
                  type="button"
                  variant="primary"
                  className={styles.submitBtn}
                  onClick={() => switchView('login')}
                >
                  Go to Sign In
                </Button>
              </div>
            ) : (
              <form className={styles.form} onSubmit={handleResetSubmit}>
                <Input
                  label="New password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  showPasswordToggle
                  required
                  minLength={8}
                  autoComplete="new-password"
                />

                <Input
                  label="Confirm password"
                  type="password"
                  placeholder="Re-enter your password"
                  value={resetConfirmPassword}
                  onChange={(e) => setResetConfirmPassword(e.target.value)}
                  showPasswordToggle
                  required
                  minLength={8}
                  autoComplete="new-password"
                />

                <p className={styles.hint}>
                  Must be 8+ characters with at least one uppercase letter and one number.
                </p>

                {resetError && <p className={styles.error}>{resetError}</p>}

                <Button
                  type="submit"
                  variant="primary"
                  disabled={resetLoading || !isResetValid}
                  className={styles.submitBtn}
                >
                  {resetLoading ? 'Resetting...' : 'Reset password'}
                </Button>
              </form>
            )}

            <p className={styles.footer}>
              <button
                type="button"
                className={styles.switchBtn}
                onClick={() => switchView('login')}
              >
                Back to Sign In
              </button>
            </p>
          </>
        )}
      </div>
    </main>
  )
}
