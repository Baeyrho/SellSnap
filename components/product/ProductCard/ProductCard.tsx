'use client'

import Link from 'next/link'
import { useState } from 'react'

import { formatNaira } from '@/lib/kobo'

import styles from './ProductCard.module.css'

interface ProductCardProps {
  id: string
  slug: string
  name: string
  description?: string | null
  priceKobo: number
  imageUrl: string
  imageUrls?: string[]
  variant?: 'grid' | 'list'
}

export function ProductCard({
  id,
  slug,
  name,
  description,
  priceKobo,
  imageUrl,
  imageUrls,
  variant = 'grid',
}: ProductCardProps) {
  const [copied, setCopied] = useState(false)
  const productUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/p/${slug}`

  const handleCopyLink = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(productUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API not available — ignore
    }
  }

  return (
    <div
      className={
        variant === 'list'
          ? `${styles.card} ${styles.list}${description ? ` ${styles.withDesc}` : ''}`
          : `${styles.card}${description ? ` ${styles.withDesc}` : ''}`
      }
    >
      <div className={styles.imageWrapper}>
        <img src={imageUrl} alt={name} className={styles.image} />
        {imageUrls && imageUrls.length > 1 && (
          <span className={styles.imageCountBadge} aria-label={`${imageUrls.length} photos`}>
            📷 {imageUrls.length}
          </span>
        )}
      </div>
      <Link
        href={`/dashboard/products/${id}`}
        className={styles.editLink}
        aria-label={`Edit ${name}`}
        title="Edit product"
      >
        <svg
          viewBox="0 0 24 24"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      </Link>
      <div className={styles.body}>
        <h3 className={styles.name}>{name}</h3>
        <p className={styles.price}>{formatNaira(priceKobo)}</p>
        {description ? <p className={styles.desc}>{description}</p> : null}
        <div className={styles.actions}>
          <Link href={`/p/${slug}`} className={styles.viewLink}>
            View
          </Link>
          <button
            type="button"
            onClick={handleCopyLink}
            className={styles.copyBtn}
          >
            {copied ? '✓ Copied' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  )
}
