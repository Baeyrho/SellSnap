'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { Input } from '@/components/ui/Input/Input'
import { Button } from '@/components/ui/Button/Button'

import styles from './AccountInfoForm.module.css'

interface AccountInfoFormProps {
  initialName: string
  initialEmail: string
  initialPhoneNumber: string | null
  createdAt?: Date | string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_REGEX = /^(\+[1-9]\d{7,14}|0[789][01]\d{8}|0\d{10})$/
const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 80

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

export function AccountInfoForm({
  initialName,
  initialEmail,
  initialPhoneNumber,
  createdAt,
}: AccountInfoFormProps) {
  const router = useRouter()

  const [name, setName] = useState(initialName || '')
  const [phoneNumber, setPhoneNumber] = useState(initialPhoneNumber || '')
  const [email, setEmail] = useState(initialEmail || '')
  const [password, setPassword] = useState('')

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  const emailChanged = email.trim().toLowerCase() !== (initialEmail || '').toLowerCase()

  const hasUnsavedChanges =
    name.trim() !== (initialName || '').trim() ||
    phoneNumber.trim() !== (initialPhoneNumber || '').trim() ||
    emailChanged

  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleDateString('en-NG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null

  const handleReset = () => {
    setName(initialName || '')
    setPhoneNumber(initialPhoneNumber || '')
    setEmail(initialEmail || '')
    setPassword('')
    setErrors({})
    setSuccessMessage('')
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!name.trim()) {
      newErrors.name = 'Display name is required.'
    } else if (name.trim().length < MIN_NAME_LENGTH) {
      newErrors.name = `Display name must be at least ${MIN_NAME_LENGTH} characters.`
    } else if (name.trim().length > MAX_NAME_LENGTH) {
      newErrors.name = `Display name must be ${MAX_NAME_LENGTH} characters or fewer.`
    }

    if (phoneNumber.trim() && !PHONE_REGEX.test(phoneNumber.trim())) {
      newErrors.phoneNumber =
        'Please enter a valid phone number (e.g. +2348012345678 or 08012345678).'
    }

    if (emailChanged) {
      const trimmed = email.trim()
      if (!trimmed) {
        newErrors.email = 'Email address is required.'
      } else if (!EMAIL_REGEX.test(trimmed)) {
        newErrors.email = 'Please enter a valid email address.'
      }
      if (!password) {
        newErrors.password = 'Enter your current password to change your email.'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSuccessMessage('')
    if (!validate()) return

    setIsSaving(true)

    // ── Email change — requires the current password; applied only after email confirmation ─
    if (emailChanged) {
      try {
        const res = await fetch('/api/seller/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        })

        const json = await res.json() as { success: boolean; data?: { pendingConfirmation?: boolean; email?: string }; error?: { code?: string; message?: string; field?: string } }

        if (res.ok && json.data?.pendingConfirmation) {
          setPassword('')
          setSuccessMessage(
            `Confirmation sent to ${json.data.email ?? email.trim()}. Open the link in that email to finish changing your address.`
          )
          setIsSaving(false)
          return
        }

        const field = json.error?.field
        const message = json.error?.message || 'Failed to update email.'
        if (typeof field === 'string') {
          setErrors({ [field]: message })
        } else {
          setErrors({ submit: message })
        }
        setIsSaving(false)
        return
      } catch {
        setErrors({ submit: 'Network error — please check your connection and try again.' })
        setIsSaving(false)
        return
      }
    }

    // ── Name + phone change ────────────────────────────────────────────────
    try {
      const res = await fetch('/api/seller/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          phoneNumber: phoneNumber.trim() || null,
        }),
      })

      const json = await res.json()

      if (res.ok) {
        setSuccessMessage('Account information updated successfully.')
        router.refresh()
      } else {
        const field = json.error?.field
        const message = json.error?.message || 'Failed to update account details.'
        if (typeof field === 'string') {
          setErrors({ [field]: message })
        } else {
          setErrors({ submit: message })
        }
      }
    } catch {
      setErrors({ submit: 'Network error — please check your connection and try again.' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className={styles.card} aria-label="Account details">
      <div className={styles.privacyCallout}>
        <span className={styles.lockIcon} aria-hidden="true">
          <LockIcon />
        </span>
        <div className={styles.calloutContent}>
          <div className={styles.calloutHeader}>
            <p className={styles.calloutTitle}>Strictly Private Information</p>
            {formattedDate && (
              <span className={styles.memberSince}>Seller since {formattedDate}</span>
            )}
          </div>
          <p className={styles.calloutText}>
            Your display name, phone number, and login email are kept private. Customers on
            your product pages will only see your <strong>Business Name</strong> and configured public storefront information.
          </p>
        </div>
      </div>

      {successMessage && <div className={styles.successAlert}>{successMessage}</div>}
      {errors.submit && <div className={styles.errorAlert}>{errors.submit}</div>}

      <form className={styles.form} onSubmit={handleSave}>
        {/* Display Name */}
        <Input
          id="accountName"
          name="accountName"
          label="Display Name *"
          type="text"
          placeholder="e.g. Amaka Okonkwo"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          required
          onChange={(e) => {
            setName(e.target.value)
            if (errors.name) {
              setErrors((prev) => {
                const next = { ...prev }
                delete next.name
                return next
              })
            }
          }}
          error={errors.name}
        />

        {/* Phone Number */}
        <Input
          id="accountPhone"
          name="accountPhone"
          label="Phone Number"
          type="tel"
          placeholder="e.g. 08012345678 or +2348012345678"
          value={phoneNumber}
          onChange={(e) => {
            setPhoneNumber(e.target.value)
            if (errors.phoneNumber) {
              setErrors((prev) => {
                const next = { ...prev }
                delete next.phoneNumber
                return next
              })
            }
          }}
          error={errors.phoneNumber}
        />

        {/* Email Address — editable */}
        <div className={styles.emailSection}>
          <Input
            id="accountEmail"
            name="accountEmail"
            label="Email *"
            type="email"
            placeholder="e.g. amaka@example.com"
            value={email}
            autoComplete="email"
            onChange={(e) => {
              setEmail(e.target.value)
              if (errors.email) {
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.email
                  return next
                })
              }
            }}
            error={errors.email}
          />
          {emailChanged && (
            <>
              <Input
                id="accountPassword"
                name="accountPassword"
                label="Current Password *"
                type="password"
                placeholder="Enter your current password"
                value={password}
                autoComplete="current-password"
                onChange={(e) => {
                  setPassword(e.target.value)
                  if (errors.password) {
                    setErrors((prev) => {
                      const next = { ...prev }
                      delete next.password
                      return next
                    })
                  }
                }}
                error={errors.password}
              />
              <div className={styles.warningCallout} role="alert">
                <WarnIcon />
                <span>
                  Changing your email requires your current password. We&rsquo;ll send a confirmation
                  link to the new address — the change only takes effect once you open it, and your
                  old email will then stop working for sign-in.
                </span>
              </div>
            </>
          )}
        </div>

        {/* Action Footer */}
        <div className={styles.formFooter}>
          {hasUnsavedChanges && (
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={handleReset}
              className={styles.resetBtn}
            >
              Discard Changes
            </Button>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={isSaving || !hasUnsavedChanges}
            className={styles.saveBtn}
          >
            {isSaving ? 'Updating...' : 'Save Account Details'}
          </Button>
        </div>
      </form>
    </section>
  )
}
