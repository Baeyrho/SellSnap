'use client'

import { useState, useSyncExternalStore } from 'react'

import { ProductCard } from '@/components/product/ProductCard/ProductCard'

import styles from './ProductsView.module.css'

type ViewMode = 'grid' | 'list'

interface ProductItem {
  id: string
  slug: string
  name: string
  description?: string | null
  priceKobo: number
  imageUrl: string
  imageUrls?: string[]
}

interface ProductsViewProps {
  products: ProductItem[]
}

const VIEW_STORAGE_KEY = 'sellsnap-products-view-mode'

const subscribeToViewMode = (): (() => void) => () => {}

const serverViewMode = (): ViewMode => 'grid'

const readViewMode = (): ViewMode => {
  try {
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY)
    return saved === 'grid' || saved === 'list' ? saved : 'grid'
  } catch {
    return 'grid'
  }
}

export function ProductsView({ products }: ProductsViewProps) {
  const storedMode = useSyncExternalStore(subscribeToViewMode, readViewMode, serverViewMode)
  const [writtenMode, setWrittenMode] = useState<ViewMode | null>(null)
  const mode = writtenMode ?? storedMode

  const selectMode = (next: ViewMode) => {
    setWrittenMode(next)
    window.localStorage.setItem(VIEW_STORAGE_KEY, next)
  }

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div
          className={styles.toggle}
          role="group"
          aria-label="Product view mode"
        >
          <button
            type="button"
            className={
              mode === 'grid'
                ? `${styles.toggleBtn} ${styles.toggleBtnActive}`
                : styles.toggleBtn
            }
            onClick={() => selectMode('grid')}
            aria-label="Grid view"
            aria-pressed={mode === 'grid'}
            title="Grid view"
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
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          </button>
          <button
            type="button"
            className={
              mode === 'list'
                ? `${styles.toggleBtn} ${styles.toggleBtnActive}`
                : styles.toggleBtn
            }
            onClick={() => selectMode('list')}
            aria-label="List view"
            aria-pressed={mode === 'list'}
            title="List view"
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
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {mode === 'grid' ? (
        <div className={styles.grid}>
          {products.map((product) => (
            <ProductCard key={product.id} {...product} />
          ))}
        </div>
      ) : (
        <div className={styles.list}>
          {products.map((product) => (
            <ProductCard key={product.id} {...product} variant="list" />
          ))}
        </div>
      )}
    </div>
  )
}