'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Input } from '@/components/ui/Input/Input'
import { Button } from '@/components/ui/Button/Button'
import { Badge } from '@/components/ui/Badge/Badge'

import styles from './ProfileInfoForm.module.css'

interface ProfileInfoFormProps {
  initialDisplayName: string | null
  initialBusinessName: string | null
  initialBusinessBio: string | null
  initialBusinessLocation: string | null
  initialWhatsappNumber: string | null
  initialLogoUrl: string | null
  fallbackName: string
  hasBankConfigured?: boolean
}

const WHATSAPP_REGEX = /^\+[1-9]\d{7,14}$/
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const MAX_NAME_LENGTH = 80
const MIN_NAME_LENGTH = 2
const MAX_BIO_LENGTH = 160
const MAX_LOCATION_LENGTH = 100

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 21s-6-5.333-6-10a6 6 0 1 1 12 0c0 4.667-6 10-6 10z" />
      <circle cx="12" cy="11" r="2.5" />
    </svg>
  )
}

function ShieldCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.99.59 3.93 1.7 5.58L2 22l4.67-1.78a9.88 9.88 0 0 0 5.37 1.55h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.79 14.07c-.24.68-1.4 1.25-1.95 1.33-.51.08-1.18.11-3.41-.81-2.86-1.19-4.7-4.1-4.84-4.29-.15-.19-1.16-1.54-1.16-2.94 0-1.4.73-2.09 1-2.37.26-.28.57-.35.77-.35.2 0 .39.01.56.02.18.01.42-.07.66.5.24.58.83 2.03.9 2.18.08.15.13.33.03.53-.1.2-.15.33-.3.51-.15.18-.32.4-.46.54-.15.15-.31.31-.13.62.18.3 1.1 1.81 2.37 2.94 1.63 1.45 3.01 1.9 3.44 2.11.43.21.68.18.93-.11.26-.29 1.1-1.28 1.4-1.72.3-.44.59-.37.99-.22.4.15 2.53 1.19 2.97 1.41.43.22.72.33.83.51.11.18.11 1.05-.13 1.73z" />
    </svg>
  )
}

export function ProfileInfoForm({
  initialDisplayName,
  initialBusinessName,
  initialBusinessBio,
  initialBusinessLocation,
  initialWhatsappNumber,
  initialLogoUrl,
  fallbackName,
  hasBankConfigured = false,
}: ProfileInfoFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const [businessName, setBusinessName] = useState(initialBusinessName ?? '')
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [businessBio, setBusinessBio] = useState(initialBusinessBio ?? '')
  const [businessLocation, setBusinessLocation] = useState(initialBusinessLocation ?? '')
  const [whatsappNumber, setWhatsappNumber] = useState(initialWhatsappNumber ?? '')
  const [logoUrl, setLogoUrl] = useState<string | null>(initialLogoUrl)

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [successMessage, setSuccessMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  // Mobile shows the customer preview by default; this switches to the edit form.
  const [isEditingOnMobile, setIsEditingOnMobile] = useState(false)

  // Derived preview values
  const previewName =
    businessName.trim() || displayName.trim() || fallbackName.trim() || 'Your Store'
  const previewInitial = previewName.charAt(0).toUpperCase()
  const previewBio = businessBio.trim()
  const previewLocation = businessLocation.trim()
  const cleanWhatsapp = whatsappNumber.trim().replace(/\D/g, '')
  const whatsappHref = cleanWhatsapp ? `https://wa.me/${cleanWhatsapp}` : null

  // Check if form has unsaved modifications
  const hasUnsavedChanges =
    businessName.trim() !== (initialBusinessName ?? '').trim() ||
    displayName.trim() !== (initialDisplayName ?? '').trim() ||
    businessBio.trim() !== (initialBusinessBio ?? '').trim() ||
    businessLocation.trim() !== (initialBusinessLocation ?? '').trim() ||
    whatsappNumber.trim() !== (initialWhatsappNumber ?? '').trim() ||
    logoUrl !== initialLogoUrl

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploadError('')
    setSuccessMessage('')

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setUploadError('Only JPG, PNG, or WebP images are allowed.')
      return
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setUploadError('Image must be under 5MB.')
      return
    }

    setIsUploading(true)
    try {
      const data = new FormData()
      data.append('logo', file)

      const res = await fetch('/api/seller/profile/logo', {
        method: 'POST',
        body: data,
      })

      const json = await res.json()

      if (res.ok && typeof json.data?.logoUrl === 'string') {
        setLogoUrl(json.data.logoUrl)
        setSuccessMessage('Store logo updated successfully.')
      } else {
        setUploadError(json.error?.message || 'Logo upload failed.')
      }
    } catch {
      setUploadError('Network error — please check connection and try again.')
    } finally {
      setIsUploading(false)
    }
  }

  const handleRemoveLogo = () => {
    setLogoUrl(null)
    setSuccessMessage('Logo removed. Save changes to update.')
  }

  const handleReset = () => {
    setBusinessName(initialBusinessName ?? '')
    setDisplayName(initialDisplayName ?? '')
    setBusinessBio(initialBusinessBio ?? '')
    setBusinessLocation(initialBusinessLocation ?? '')
    setWhatsappNumber(initialWhatsappNumber ?? '')
    setLogoUrl(initialLogoUrl)
    setErrors({})
    setUploadError('')
    setSuccessMessage('')
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!businessName.trim()) {
      newErrors.businessName = 'Business name is required.'
    } else if (businessName.trim().length < MIN_NAME_LENGTH) {
      newErrors.businessName = `Business name must be at least ${MIN_NAME_LENGTH} characters.`
    } else if (businessName.trim().length > MAX_NAME_LENGTH) {
      newErrors.businessName = `Business name must be ${MAX_NAME_LENGTH} characters or fewer.`
    }

    if (displayName.trim().length > MAX_NAME_LENGTH) {
      newErrors.displayName = `Display name must be ${MAX_NAME_LENGTH} characters or fewer.`
    }

    if (businessBio.trim().length > MAX_BIO_LENGTH) {
      newErrors.businessBio = `Business bio must be ${MAX_BIO_LENGTH} characters or fewer.`
    }

    if (businessLocation.trim().length > MAX_LOCATION_LENGTH) {
      newErrors.businessLocation = `Location must be ${MAX_LOCATION_LENGTH} characters or fewer.`
    }

    if (whatsappNumber.trim() && !WHATSAPP_REGEX.test(whatsappNumber.trim())) {
      newErrors.whatsappNumber = 'Use international E.164 format, e.g. +2348012345678.'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSuccessMessage('')
    if (!validate()) return

    const payload: Record<string, string | null> = {
      businessName: businessName.trim() || null,
      displayName: displayName.trim() || null,
      businessBio: businessBio.trim() || null,
      businessLocation: businessLocation.trim() || null,
      whatsappNumber: whatsappNumber.trim() || null,
      logoUrl: logoUrl ?? null,
    }

    setIsSaving(true)
    try {
      const res = await fetch('/api/seller/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const json = await res.json()

      if (res.ok) {
        setSuccessMessage('Business profile saved successfully!')
        router.refresh()
      } else {
        const field = json.error?.field
        const message = json.error?.message || 'Something went wrong. Please try again.'
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
    <div className={styles.layoutGrid}>
      {/* Edit Form Section */}
      <section
        className={`${styles.card}${isEditingOnMobile ? ` ${styles.cardEditing}` : ''}`}
        aria-label="Business profile"
      >
        {successMessage && <div className={styles.successAlert}>{successMessage}</div>}
        {errors.submit && <div className={styles.errorAlert}>{errors.submit}</div>}

        <form className={styles.form} onSubmit={handleSave}>
          {/* Logo Section */}
          <div className={styles.logoSection}>
            <span className={styles.fieldLabel}>Brand Image</span>
            <div className={styles.logoRow}>
              {logoUrl ? (
                <img src={logoUrl} alt="Store logo preview" className={styles.logoPreview} />
              ) : (
                <span className={styles.logoPlaceholder} aria-hidden="true">
                  {previewInitial}
                </span>
              )}

              <div className={styles.logoControls}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleLogoChange}
                  className={styles.fileInput}
                  id="logo-file-input"
                  aria-label="Upload store logo image"
                />

                <div className={styles.logoBtnGroup}>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={isUploading}
                    className={styles.uploadBtn}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {isUploading ? 'Uploading...' : logoUrl ? 'Change Logo' : 'Upload Logo'}
                  </Button>

                  {logoUrl && (
                    <button
                      type="button"
                      className={styles.removeLogoBtn}
                      onClick={handleRemoveLogo}
                      disabled={isUploading}
                    >
                      Remove
                    </button>
                  )}
                </div>

                <p className={styles.logoHint}>JPG, PNG or WebP. Max 5 MB. Square ratio recommended.</p>
              </div>
            </div>
            {uploadError && <p className={styles.errorText}>{uploadError}</p>}
          </div>

          {/* Business Name */}
          <Input
            id="businessName"
            name="businessName"
            label="Business Name *"
            type="text"
            placeholder="e.g. Amaka's Wears & Fabrics"
            value={businessName}
            maxLength={MAX_NAME_LENGTH}
            required
            onChange={(e) => {
              setBusinessName(e.target.value)
              if (errors.businessName) {
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.businessName
                  return next
                })
              }
            }}
            error={errors.businessName}
          />

          {/* Business Location */}
          <Input
            id="businessLocation"
            name="businessLocation"
            label="Business Location (Optional)"
            type="text"
            placeholder="e.g. Ikeja, Lagos, Nigeria"
            value={businessLocation}
            maxLength={MAX_LOCATION_LENGTH}
            onChange={(e) => {
              setBusinessLocation(e.target.value)
              if (errors.businessLocation) {
                setErrors((prev) => {
                  const next = { ...prev }
                  delete next.businessLocation
                  return next
                })
              }
            }}
            error={errors.businessLocation}
          />

          {/* Business Bio / Description */}
          <div className={styles.textareaWrapper}>
            <div className={styles.labelRow}>
              <label htmlFor="business-bio" className={styles.textareaLabel}>
                Business Bio
              </label>
              <span className={styles.charCount}>
                {businessBio.length}/{MAX_BIO_LENGTH}
              </span>
            </div>
            <textarea
              id="business-bio"
              name="businessBio"
              className={`${styles.textarea} ${errors.businessBio ? styles.textareaError : ''}`}
              placeholder="Tell customers what you sell, your delivery coverage, or store policies..."
              value={businessBio}
              maxLength={MAX_BIO_LENGTH}
              rows={3}
              onChange={(e) => {
                setBusinessBio(e.target.value)
                if (errors.businessBio) {
                  setErrors((prev) => {
                    const next = { ...prev }
                    delete next.businessBio
                    return next
                  })
                }
              }}
            />
            {errors.businessBio && (
              <span className={styles.errorText}>{errors.businessBio}</span>
            )}
          </div>

          {/* WhatsApp Number */}
          <div>
            <Input
              id="whatsappNumber"
              name="whatsappNumber"
              label="Public WhatsApp Contact (Optional)"
              type="tel"
              placeholder="+2348012345678"
              value={whatsappNumber}
              onChange={(e) => {
                setWhatsappNumber(e.target.value)
                if (errors.whatsappNumber) {
                  setErrors((prev) => {
                    const next = { ...prev }
                    delete next.whatsappNumber
                    return next
                  })
                }
              }}
              error={errors.whatsappNumber}
            />
          </div>

          {/* Action Buttons */}
          <div className={styles.formFooter}>
            {hasUnsavedChanges && (
              <Button
                type="button"
                variant="outline"
                disabled={isSaving || isUploading}
                onClick={handleReset}
                className={styles.resetBtn}
              >
                Discard Changes
              </Button>
            )}

            <Button
              type="submit"
              variant="primary"
              disabled={isSaving || isUploading || !hasUnsavedChanges}
              className={styles.saveBtn}
            >
              {isSaving ? 'Saving Profile...' : 'Save Changes'}
            </Button>

            <button
              type="button"
              className={styles.cancelEditBtn}
              onClick={() => setIsEditingOnMobile(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      </section>

      {/* Live Customer View Preview Card */}
      <aside
        className={`${styles.previewSidebar}${
          isEditingOnMobile ? ` ${styles.previewSidebarHidden}` : ''
        }`}
        aria-label="Live customer storefront preview"
      >
        <div className={styles.previewCard}>
          <div className={styles.previewCardHeader}>
            <div>
              <span className={styles.previewEyebrow}>Live Customer View</span>
              <h3 className={styles.previewHeading}>Product Page Badge</h3>
            </div>
            <div className={styles.previewHeaderActions}>
              <Badge variant="neutral">Preview</Badge>
              <button
                type="button"
                className={styles.editToggleBtn}
                onClick={() => setIsEditingOnMobile(true)}
                aria-expanded={isEditingOnMobile}
              >
                Edit details
              </button>
            </div>
          </div>

          <p className={styles.previewExplainer}>
            How your business identity appears to customers when they open your product payment link:
          </p>

          <div className={styles.mockProductSellerBox}>
            <div className={styles.mockSellerInfo}>
              {logoUrl ? (
                <img src={logoUrl} alt={previewName} className={styles.mockAvatar} />
              ) : (
                <span className={styles.mockAvatarFallback} aria-hidden="true">
                  {previewInitial}
                </span>
              )}
              <div className={styles.mockSellerText}>
                <p className={styles.mockSoldBy}>Sold by</p>
                <h4 className={styles.mockStoreName}>{previewName}</h4>
                {previewLocation && (
                  <p className={styles.mockLocation}>
                    <PinIcon />
                    <span>{previewLocation}</span>
                  </p>
                )}
              </div>
            </div>

            {previewBio && <p className={styles.mockBio}>{previewBio}</p>}

            {whatsappHref && (
              <a
                href={whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.mockWhatsappLink}
              >
                <WhatsAppIcon />
                <span>Chat on WhatsApp</span>
              </a>
            )}

            <div className={styles.trustRow}>
              <div className={styles.trustItem}>
                <ShieldCheckIcon />
                <span>{hasBankConfigured ? 'Direct Bank Verified' : 'Flutterwave Secured'}</span>
              </div>
              <span className={styles.trustDot}>•</span>
              <span className={styles.zeroFeeNote}>0% Buyer Fee</span>
            </div>
          </div>

          <div className={styles.trustTips}>
            <p className={styles.tipTitle}>Buyer Trust Checklist</p>
            <ul className={styles.tipList}>
              <li className={businessName ? styles.tipDone : styles.tipPending}>
                {businessName ? '✓' : '○'} Business name provided
              </li>
              <li className={logoUrl ? styles.tipDone : styles.tipPending}>
                {logoUrl ? '✓' : '○'} Store logo uploaded
              </li>
              <li className={businessLocation ? styles.tipDone : styles.tipPending}>
                {businessLocation ? '✓' : '○'} Store location specified
              </li>
              <li className={whatsappNumber ? styles.tipDone : styles.tipPending}>
                {whatsappNumber ? '✓' : '○'} WhatsApp contact linked
              </li>
            </ul>
          </div>
        </div>
      </aside>
    </div>
  )
}
