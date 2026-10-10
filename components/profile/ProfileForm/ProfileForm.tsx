'use client'

import { useState } from 'react'

import { Input } from '@/components/ui/Input/Input'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'

import styles from './ProfileForm.module.css'

export interface ProfileFormProps {
  initialName?: string
  initialEmail?: string
  initialBankCode?: string | null
  initialAccountNumber?: string | null
  hideAccountOverview?: boolean
}

interface NigerianBank {
  code: string
  name: string
}

export const NIGERIAN_BANKS: NigerianBank[] = [
  { code: '058', name: 'GTBank (Guaranty Trust Bank)' },
  { code: '044', name: 'Access Bank' },
  { code: '057', name: 'Zenith Bank' },
  { code: '011', name: 'First Bank of Nigeria' },
  { code: '033', name: 'United Bank for Africa (UBA)' },
  { code: '214', name: 'FCMB (First City Monument Bank)' },
  { code: '070', name: 'Fidelity Bank' },
  { code: '221', name: 'Stanbic IBTC Bank' },
  { code: '232', name: 'Sterling Bank' },
  { code: '032', name: 'Union Bank of Nigeria' },
  { code: '035', name: 'Wema Bank / ALAT' },
  { code: '50211', name: 'Kuda Bank' },
  { code: '999992', name: 'OPay' },
  { code: '999991', name: 'PalmPay' },
  { code: '50515', name: 'Moniepoint Microfinance Bank' },
  { code: 'custom', name: 'Other Bank (Enter custom code)' },
]

export function ProfileForm({
  initialName = '',
  initialEmail = '',
  initialBankCode,
  initialAccountNumber,
  hideAccountOverview = false,
}: ProfileFormProps) {
  const existingBank = NIGERIAN_BANKS.find((b) => b.code === initialBankCode)
  const [selectedBankCode, setSelectedBankCode] = useState(
    existingBank ? existingBank.code : initialBankCode ? 'custom' : ''
  )
  const [customBankCode, setCustomBankCode] = useState(
    existingBank ? '' : initialBankCode || ''
  )
  const [accountNumber, setAccountNumber] = useState(initialAccountNumber || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [isConfigured, setIsConfigured] = useState(
    Boolean(initialBankCode && initialAccountNumber)
  )

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')

  const effectiveBankCode =
    selectedBankCode === 'custom' ? customBankCode.trim() : selectedBankCode

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!selectedBankCode) {
      newErrors.bank = 'Please select a bank'
    } else if (selectedBankCode === 'custom' && !customBankCode.trim()) {
      newErrors.customBank = 'Bank code is required'
    }

    if (!accountNumber.trim()) {
      newErrors.accountNumber = 'Account number is required'
    } else if (!/^\d{10}$/.test(accountNumber.trim())) {
      newErrors.accountNumber = 'Account number must be exactly 10 digits'
    }

    // Changing an existing payout destination requires step-up authentication.
    if (isConfigured && !currentPassword) {
      newErrors.currentPassword = 'Enter your current password to change your bank account'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSuccessMessage('')
    if (!validate()) return

    setIsLoading(true)
    try {
      const res = await fetch('/api/seller/bank-account', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bankCode: effectiveBankCode,
          accountNumber: accountNumber.trim(),
          ...(isConfigured ? { currentPassword } : {}),
        }),
      })

      const data = await res.json()

      if (res.ok && data.success) {
        setIsConfigured(true)
        setCurrentPassword('')
        setSuccessMessage('Your bank payout details have been saved successfully!')
      } else {
        setErrors({
          submit: data.error?.message || 'Failed to update bank details. Please try again.',
        })
      }
    } catch {
      setErrors({ submit: 'Network error. Please verify your connection and try again.' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      {/* Seller Account Overview Card */}
      {!hideAccountOverview && (
        <section className={styles.card} aria-label="Seller account">
          <div className={styles.cardHeader}>
            <Badge variant="neutral">Seller Account</Badge>
          </div>

          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Full Name</span>
              <span className={styles.infoValue}>{initialName || 'Not provided'}</span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.infoLabel}>Email Address</span>
              <span className={styles.infoValue}>{initialEmail}</span>
            </div>
          </div>
        </section>
      )}

      {/* Payout & Bank Account Setup Card */}
      <section id="bank-setup" className={styles.card} aria-label="Bank account and payout setup">
        <div className={styles.callout}>
          <p className={styles.calloutTitle}>Direct Bank Settlement</p>
          <p className={styles.calloutText}>
            SellSnap does not hold your funds. When a customer pays for your product via
            Flutterwave, the payment is routed directly into this bank account with 0% platform fee.
          </p>
        </div>

        {successMessage && <div className={styles.successAlert}>{successMessage}</div>}
        {errors.submit && <div className={styles.errorAlert}>{errors.submit}</div>}

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.selectWrapper}>
            <label htmlFor="bankSelect" className={styles.selectLabel}>
              Select Bank
            </label>
            <select
              id="bankSelect"
              className={`${styles.select} ${errors.bank ? styles.selectError : ''}`}
              value={selectedBankCode}
              onChange={(e) => {
                setSelectedBankCode(e.target.value)
                if (errors.bank) {
                  setErrors((prev) => {
                    const next = { ...prev }
                    delete next.bank
                    return next
                  })
                }
              }}
            >
              <option value="">-- Choose your bank --</option>
              {NIGERIAN_BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name}
                </option>
              ))}
            </select>
            {errors.bank && <span className={styles.errorText}>{errors.bank}</span>}
          </div>

          {selectedBankCode === 'custom' && (
            <Input
              label="Custom Bank Code"
              type="text"
              placeholder="e.g. 058"
              value={customBankCode}
              onChange={(e) => {
                setCustomBankCode(e.target.value)
                if (errors.customBank) {
                  setErrors((prev) => {
                    const next = { ...prev }
                    delete next.customBank
                    return next
                  })
                }
              }}
              error={errors.customBank}
            />
          )}

          <Input
            label="NUBAN Account Number (10 Digits)"
            type="text"
            inputMode="numeric"
            maxLength={10}
            placeholder="0123456789"
            value={accountNumber}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/\D/g, '').slice(0, 10)
              setAccountNumber(cleaned)
              if (errors.accountNumber) {
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.accountNumber
                  return next
                })
              }
            }}
            error={errors.accountNumber}
          />

          {isConfigured && (
            <Input
              label="Current Password"
              type="password"
              placeholder="Enter your current password"
              autoComplete="current-password"
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
          )}

          <div className={styles.buttonWrapper}>
            <Button type="submit" disabled={isLoading} className={styles.saveBtn}>
              {isLoading ? 'Saving...' : isConfigured ? 'Update Bank Details' : 'Save Bank Details'}
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
