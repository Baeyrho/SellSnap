'use client'

import { useState } from 'react'
import { signOut } from 'next-auth/react'

import { Input } from '@/components/ui/Input/Input'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'

import styles from './ProfileSecurity.module.css'

function SignOutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

export function ProfileSecurity() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  // Real-time password criteria
  const hasMinLength = newPassword.length >= 8
  const hasUppercase = /[A-Z]/.test(newPassword)
  const hasNumber = /\d/.test(newPassword)
  const isMatching = newPassword.length > 0 && newPassword === confirmPassword

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!currentPassword) {
      newErrors.currentPassword = 'Current password is required.'
    }

    if (!newPassword) {
      newErrors.newPassword = 'New password is required.'
    } else {
      if (newPassword.length < 8) {
        newErrors.newPassword = 'Password must be at least 8 characters.'
      } else if (!hasUppercase || !hasNumber) {
        newErrors.newPassword = 'Password must include at least 1 uppercase letter and 1 number.'
      }
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Please confirm your new password.'
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match.'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSuccessMessage('')
    if (!validate()) return

    setIsLoading(true)
    try {
      const res = await fetch('/api/seller/security/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      })

      const json = await res.json()

      if (res.ok && json.success) {
        setSuccessMessage('Password changed successfully! Keep your new credentials safe.')
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setErrors({})
      } else {
        const field = json.error?.field
        const message = json.error?.message || 'Failed to update password.'
        if (typeof field === 'string') {
          setErrors({ [field]: message })
        } else {
          setErrors({ submit: message })
        }
      }
    } catch {
      setErrors({ submit: 'Network error — please check your connection and try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSignOut = async () => {
    await signOut({ callbackUrl: '/auth' })
  }

  return (
    <div className={styles.container}>
      {/* Change Password Card */}
      <section className={styles.card} aria-label="Change password">
        {successMessage && <div className={styles.successAlert}>{successMessage}</div>}
        {errors.submit && <div className={styles.errorAlert}>{errors.submit}</div>}

        <form className={styles.form} onSubmit={handlePasswordSubmit}>
          <Input
            id="currentPassword"
            name="currentPassword"
            label="Current Password"
            type="password"
            showPasswordToggle
            placeholder="••••••••"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value)
              if (errors.currentPassword) {
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.currentPassword
                  return next
                })
              }
            }}
            error={errors.currentPassword}
          />

          <Input
            id="newPassword"
            name="newPassword"
            label="New Password"
            type="password"
            showPasswordToggle
            placeholder="••••••••"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value)
              if (errors.newPassword) {
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.newPassword
                  return next
                })
              }
            }}
            error={errors.newPassword}
          />

          {newPassword && (
            <div className={styles.rulesList}>
              <span className={hasMinLength ? styles.ruleDone : styles.rulePending}>
                {hasMinLength ? '✓' : '○'} At least 8 characters
              </span>
              <span className={hasUppercase ? styles.ruleDone : styles.rulePending}>
                {hasUppercase ? '✓' : '○'} At least 1 uppercase letter
              </span>
              <span className={hasNumber ? styles.ruleDone : styles.rulePending}>
                {hasNumber ? '✓' : '○'} At least 1 number
              </span>
            </div>
          )}

          <Input
            id="confirmPassword"
            name="confirmPassword"
            label="Confirm New Password"
            type="password"
            showPasswordToggle
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              if (errors.confirmPassword) {
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.confirmPassword
                  return next
                })
              }
            }}
            error={errors.confirmPassword}
          />

          {confirmPassword && (
            <p className={isMatching ? styles.matchSuccess : styles.matchPending}>
              {isMatching ? '✓ Passwords match' : '○ Passwords must match'}
            </p>
          )}

          <div className={styles.buttonWrapper}>
            <Button type="submit" disabled={isLoading} className={styles.submitBtn}>
              {isLoading ? 'Updating Password...' : 'Update Password'}
            </Button>
          </div>
        </form>
      </section>

      {/* Active Session & Device Card */}
      <section className={styles.card} aria-label="Active session">
        <div className={styles.cardHeader}>
          <Badge variant="success">Current Device</Badge>
        </div>

        <div className={styles.sessionBox}>
          <div className={styles.sessionDetails}>
            <p className={styles.sessionDevice}>Web Browser Session</p>
            <p className={styles.sessionStatus}>Active now • Authenticated via secure JWT token</p>
          </div>

          <Button
            type="button"
            variant="outline"
            className={styles.signOutBtn}
            onClick={handleSignOut}
          >
            <SignOutIcon />
            <span>Sign Out</span>
          </Button>
        </div>
      </section>

      {/* Account Deactivation & Data Policy */}
      <section className={styles.card}>
        <h3 className={styles.deactivateTitle}>Account Management & Data Policy</h3>
        <p className={styles.deactivateText}>
          SellSnap handles your business and financial records in full compliance with Nigerian Data
          Protection Regulation (NDPR) and anti-money laundering requirements.
        </p>
        <p className={styles.deactivateText}>
          If you wish to close your store, clear your payout records, or request a complete data
          export, please contact our seller support team at{' '}
          <a href="mailto:support@sellsnap.ng" className={styles.supportLink}>
            support@sellsnap.ng
          </a>
          .
        </p>
      </section>
    </div>
  )
}
