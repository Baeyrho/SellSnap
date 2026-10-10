'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

import { Input } from '@/components/ui/Input/Input'
import { Button } from '@/components/ui/Button/Button'
import { koboToNaira } from '@/lib/kobo'

import styles from './ProductForm.module.css'

interface InitialProduct {
  name: string
  description: string | null
  priceKobo: number
  imageUrl: string
  imageUrls?: string[]
}

interface ProductFormProps {
  productId?: string
  initialProduct?: InitialProduct
}

interface ImageItem {
  id: string
  url: string
  file?: File
  isExisting?: boolean
}

const MAX_IMAGES = 3
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function ProductForm({ productId, initialProduct }: ProductFormProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [formData, setFormData] = useState({
    name: initialProduct?.name ?? '',
    price: initialProduct ? String(koboToNaira(initialProduct.priceKobo)) : '',
    description: initialProduct?.description ?? '',
  })

  // Initialize images list from initialProduct (supporting imageUrls or fallback to single imageUrl)
  const [images, setImages] = useState<ImageItem[]>(() => {
    if (!initialProduct) return []
    const urls =
      initialProduct.imageUrls && initialProduct.imageUrls.length > 0
        ? initialProduct.imageUrls
        : initialProduct.imageUrl
        ? [initialProduct.imageUrl]
        : []
    return urls.map((url, idx) => ({
      id: `existing-${idx}-${url}`,
      url,
      isExisting: true,
    }))
  })

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(false)

  const isEditing = Boolean(productId)

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.name.trim()) newErrors.name = 'Product name is required'
    if (!formData.price || Number(formData.price) <= 0)
      newErrors.price = 'Price must be greater than 0'
    if (images.length === 0)
      newErrors.image = 'At least one product image is required'
    if (images.length > MAX_IMAGES)
      newErrors.image = `You can upload a maximum of ${MAX_IMAGES} images`

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const remainingSlots = MAX_IMAGES - images.length
    if (remainingSlots <= 0) {
      setErrors((prev) => ({
        ...prev,
        image: `You can upload a maximum of ${MAX_IMAGES} images`,
      }))
      e.target.value = ''
      return
    }

    const newItems: ImageItem[] = []
    let sizeError = false
    let typeError = false

    const filesToProcess = Array.from(files).slice(0, remainingSlots)

    for (const file of filesToProcess) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        typeError = true
        continue
      }
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        sizeError = true
        continue
      }
      newItems.push({
        id: `new-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        url: URL.createObjectURL(file),
        file,
        isExisting: false,
      })
    }

    e.target.value = ''

    if (typeError) {
      setErrors((prev) => ({
        ...prev,
        image: 'Only JPG, PNG, and WebP images are allowed',
      }))
    } else if (sizeError) {
      setErrors((prev) => ({
        ...prev,
        image: 'Each image must be under 5MB',
      }))
    } else {
      setErrors((prev) => {
        const next = { ...prev }
        delete next.image
        return next
      })
    }

    if (newItems.length > 0) {
      setImages((prev) => [...prev, ...newItems])
    }
  }

  const handleRemoveImage = (idToRemove: string) => {
    setImages((prev) => prev.filter((img) => img.id !== idToRemove))
  }

  const handleSetCover = (index: number) => {
    if (index === 0) return
    setImages((prev) => {
      const selected = prev[index]
      const remaining = prev.filter((_, idx) => idx !== index)
      return [selected, ...remaining]
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!validateForm()) return

    setIsLoading(true)
    try {
      const data = new FormData()
      data.append('name', formData.name.trim())
      data.append('priceNaira', formData.price)
      if (formData.description.trim()) {
        data.append('description', formData.description.trim())
      }

      if (isEditing) {
        // Send retained existing image URLs and new files separately
        images.forEach((img) => {
          if (img.isExisting) {
            data.append('existingImages', img.url)
          } else if (img.file) {
            data.append('images', img.file)
          }
        })
      } else {
        images.forEach((img) => {
          if (img.file) {
            data.append('images', img.file)
          }
        })
      }

      const res = await fetch(isEditing ? `/api/products/${productId}` : '/api/products', {
        method: isEditing ? 'PATCH' : 'POST',
        body: data,
      })

      if (res.ok) {
        router.push('/dashboard/products')
        router.refresh()
      } else {
        const json = await res.json()
        setErrors({
          submit:
            json.error?.message ||
            (isEditing ? 'Failed to update product' : 'Failed to create product'),
        })
      }
    } catch {
      setErrors({ submit: 'Network error — please try again' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleChange =
    (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setFormData((prev) => ({ ...prev, [field]: e.target.value }))
      if (errors[field]) {
        setErrors((prev) => {
          const next = { ...prev }
          delete next[field]
          return next
        })
      }
    }

  const handleCancel = () => {
    if (window.history.length > 1) {
      router.back()
    } else {
      router.push('/dashboard/products')
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.imageSection}>
        <div className={styles.imageHeader}>
          <span className={styles.label}>
            Product Images <span className={styles.imageCount}>({images.length}/{MAX_IMAGES})</span>
          </span>
          <span className={styles.imageHelper}>
            Up to 3 photos. First photo is the main cover.
          </span>
        </div>

        <div className={styles.imageGrid}>
          {images.map((img, idx) => (
            <div key={img.id} className={styles.imageCard}>
              <img src={img.url} alt={`Upload ${idx + 1}`} className={styles.preview} />

              {idx === 0 ? (
                <span className={styles.coverBadge}>Cover</span>
              ) : (
                <button
                  type="button"
                  className={styles.setCoverBtn}
                  onClick={() => handleSetCover(idx)}
                  title="Make this the cover photo"
                >
                  Set as cover
                </button>
              )}

              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => handleRemoveImage(img.id)}
                aria-label={`Remove photo ${idx + 1}`}
                title="Remove photo"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}

          {images.length < MAX_IMAGES && (
            <button
              type="button"
              className={styles.addSlotBtn}
              onClick={() => fileInputRef.current?.click()}
              aria-label={`Add photo ${images.length + 1} of ${MAX_IMAGES}`}
            >
              <div className={styles.addSlotContent}>
                <svg
                  viewBox="0 0 24 24"
                  width="24"
                  height="24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={styles.plusIcon}
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span className={styles.addSlotText}>
                  {images.length === 0 ? 'Add photo' : 'Add another'}
                </span>
                <span className={styles.addSlotSubtext}>
                  {MAX_IMAGES - images.length} remaining
                </span>
              </div>
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={handleImageChange}
          className={styles.fileInput}
        />

        {errors.image && <span className={styles.errorText}>{errors.image}</span>}
      </div>

      <Input
        label="Product Name"
        type="text"
        placeholder="e.g., Handmade Ankara Bag"
        value={formData.name}
        onChange={handleChange('name')}
        error={errors.name}
      />

      <Input
        label="Price (₦)"
        type="number"
        placeholder="e.g., 12500"
        value={formData.price}
        onChange={handleChange('price')}
        error={errors.price}
      />

      <div className={styles.textareaWrapper}>
        <label htmlFor="product-description" className={styles.label}>
          Description (optional)
        </label>
        <textarea
          id="product-description"
          className={styles.textarea}
          placeholder="Tell buyers about your product..."
          value={formData.description}
          onChange={handleChange('description')}
          rows={4}
        />
      </div>

      {errors.submit && <p className={styles.submitError}>{errors.submit}</p>}

      <div className={styles.actions}>
        {isEditing && (
          <Button
            type="button"
            variant="outline"
            className={styles.cancelBtn}
            onClick={handleCancel}
            disabled={isLoading}
          >
            Cancel edit
          </Button>
        )}
        <Button
          type="submit"
          disabled={isLoading}
          className={isEditing ? styles.saveBtn : styles.submitBtn}
        >
          {isLoading
            ? isEditing
              ? 'Saving...'
              : 'Creating...'
            : isEditing
              ? 'Save changes'
              : 'Create product'}
        </Button>
      </div>
    </form>
  )
}
