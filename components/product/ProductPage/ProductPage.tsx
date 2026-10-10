'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { formatNaira } from '@/lib/kobo'
import { Button } from '@/components/ui/Button/Button'
import { Input } from '@/components/ui/Input/Input'

import styles from './ProductPage.module.css'

interface ProductPageProps {
  slug: string
  name: string
  description: string | null
  priceKobo: number
  imageUrl: string
  imageUrls?: string[]
  sellerName: string
  sellerLogoUrl: string | null
  sellerWhatsappNumber: string | null
  status: 'ACTIVE' | 'INACTIVE' | 'DELETED'
}

export function ProductPage({
  slug,
  name,
  description,
  priceKobo,
  imageUrl,
  imageUrls,
  sellerName,
  sellerLogoUrl,
  sellerWhatsappNumber,
  status,
}: ProductPageProps) {
  const images = imageUrls && imageUrls.length > 0 ? imageUrls : [imageUrl]
  const [activeImageIndex, setActiveImageIndex] = useState(0)
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const currentImage = images[activeImageIndex] || images[0]

  const handlePrevImage = () => {
    setActiveImageIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1))
  }

  const handleNextImage = () => {
    setActiveImageIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0))
  }

  const isUnavailable = status === 'INACTIVE' || status === 'DELETED'
  const sellerInitial = sellerName.trim().charAt(0).toUpperCase() || 'S'
  const whatsappHref = sellerWhatsappNumber
    ? `https://wa.me/${sellerWhatsappNumber.replace(/\D/g, '')}`
    : null

  const handlePay = async (e: React.FormEvent) => {
    e.preventDefault()

    const newErrors: Record<string, string> = {}
    if (!customerEmail.trim()) newErrors.email = 'Email is required for payment receipt'
    setErrors(newErrors)
    if (Object.keys(newErrors).length > 0) return

    setIsLoading(true)
    try {
      const res = await fetch(`/api/product-page/${slug}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim() || undefined,
          customerEmail: customerEmail.trim().toLowerCase(),
        }),
      })

      const json = await res.json()

      if (res.ok && json.data?.paymentLink) {
        window.location.href = json.data.paymentLink
      } else {
        setErrors({ submit: json.error?.message || 'Payment initiation failed' })
      }
    } catch {
      setErrors({ submit: 'Network error — please try again' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <main className={styles.container}>
      <div className={styles.card}>
        <div className={styles.imageWrapper}>
          <img src={currentImage} alt={name} className={styles.image} />
          {images.length > 1 && (
            <>
              <span className={styles.imageBadge} aria-label={`Image ${activeImageIndex + 1} of ${images.length}`}>
                {activeImageIndex + 1} / {images.length}
              </span>
              <button
                type="button"
                className={`${styles.navBtn} ${styles.prevBtn}`}
                onClick={handlePrevImage}
                aria-label="Previous image"
                title="Previous image"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m15 18-6-6 6-6" />
                </svg>
              </button>
              <button
                type="button"
                className={`${styles.navBtn} ${styles.nextBtn}`}
                onClick={handleNextImage}
                aria-label="Next image"
                title="Next image"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => router.back()}
            aria-label="Go back"
            title="Go back"
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {images.length > 1 && (
          <div className={styles.thumbnailRow} role="tablist" aria-label="Product images">
            {images.map((img, idx) => (
              <button
                key={idx}
                type="button"
                role="tab"
                aria-selected={idx === activeImageIndex}
                aria-label={`View photo ${idx + 1} of ${images.length}`}
                className={idx === activeImageIndex ? `${styles.thumbBtn} ${styles.thumbBtnActive}` : styles.thumbBtn}
                onClick={() => setActiveImageIndex(idx)}
              >
                <img src={img} alt="" className={styles.thumbImage} />
              </button>
            ))}
          </div>
        )}

        <div className={styles.details}>
          <div className={styles.sellerRow}>
            {sellerLogoUrl ? (
              <img
                src={sellerLogoUrl}
                alt={sellerName}
                className={styles.sellerAvatar}
              />
            ) : (
              <span className={styles.sellerAvatarFallback} aria-hidden="true">
                {sellerInitial}
              </span>
            )}
            <p className={styles.sellerName}>Sold by {sellerName}</p>
          </div>
          <h1 className={styles.name}>{name}</h1>
          <p className={styles.price}>{formatNaira(priceKobo)}</p>

          {description && (
            <p className={styles.description}>{description}</p>
          )}

          {isUnavailable ? (
            <div className={styles.unavailable}>
              <p className={styles.unavailableText}>
                This item is no longer available
              </p>
              {whatsappHref && (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.whatsappBtn}
                >
                  Contact seller on WhatsApp
                </a>
              )}
            </div>
          ) : (
            <>
              <form className={styles.form} onSubmit={handlePay}>
                <Input
                  label="Your Name (optional)"
                  type="text"
                  placeholder="John Doe"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />

                <Input
                  label="Your Email"
                  type="email"
                  placeholder="you@example.com"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                  error={errors.email}
                />

                {errors.submit && (
                  <p className={styles.submitError}>{errors.submit}</p>
                )}

                <Button type="submit" disabled={isLoading} className={styles.payBtn}>
                  {isLoading ? 'Processing...' : `Pay ${formatNaira(priceKobo)}`}
                </Button>
              </form>

              <p className={styles.footer}>
                Payments are processed securely by Flutterwave.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  )
}
