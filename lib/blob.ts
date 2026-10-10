import { put } from '@vercel/blob'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024 // 5 MB

interface ImageType {
  mime: string
  ext: string
}

/** Sniff the real image type from magic bytes. The browser-supplied `File.type` is attacker
 *  controlled and must never decide what content type the stored object is served as. */
export function detectImageType(buffer: Buffer): ImageType | null {
  if (buffer.length < 12) return null

  const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  if (isJpg) return { mime: 'image/jpeg', ext: '.jpg' }

  const isPng =
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
  if (isPng) return { mime: 'image/png', ext: '.png' }

  const isWebp =
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  if (isWebp) return { mime: 'image/webp', ext: '.webp' }

  return null
}

/** Validate image magic bytes — server-side check, never trust browser MIME. */
export async function validateImageMagicBytes(buffer: Buffer): Promise<boolean> {
  return detectImageType(buffer) !== null
}

interface UploadResult {
  url: string
}

/**
 * Persist an image under a server-generated name and the content type derived from its magic
 * bytes. Using the sniffed type (not `File.type`) is what stops an attacker from having an
 * image-shaped payload stored and later served as `text/html`. Uses Vercel Blob when a token is
 * configured; otherwise falls back to local public storage so development works without Blob.
 */
async function storeImage(
  kind: 'products' | 'logos',
  buffer: Buffer,
  type: ImageType
): Promise<UploadResult> {
  const fileName = `${Date.now()}-${randomUUID()}${type.ext}`

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`${kind}/${fileName}`, buffer, {
      access: 'public',
      contentType: type.mime,
    })
    return { url: blob.url }
  }

  // NOTE: BLOB_READ_WRITE_TOKEN is not configured — store under public/ so the dev server serves it statically.
  const dir = path.join(process.cwd(), 'public', 'uploads', kind)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, fileName), buffer)
  return { url: `/uploads/${kind}/${fileName}` }
}

async function prepareImage(file: File): Promise<{ buffer: Buffer; type: ImageType }> {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File size exceeds 5MB limit')
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const type = detectImageType(buffer)

  if (!type) {
    throw new Error('Invalid image format. Only JPG, PNG, and WebP are allowed.')
  }

  return { buffer, type }
}

/** Upload an image to storage after validation */
export async function uploadProductImage(file: File): Promise<UploadResult> {
  const { buffer, type } = await prepareImage(file)
  return storeImage('products', buffer, type)
}

/** Upload multiple images (up to 3) for a product listing */
export async function uploadProductImages(files: File[]): Promise<string[]> {
  if (files.length === 0) {
    throw new Error('At least one product image is required.')
  }
  if (files.length > 3) {
    throw new Error('You can upload a maximum of 3 images.')
  }

  const results = await Promise.all(files.map((file) => uploadProductImage(file)))
  return results.map((r) => r.url)
}

/** Upload a seller logo to storage after validation */
export async function uploadLogoImage(file: File): Promise<UploadResult> {
  const { buffer, type } = await prepareImage(file)
  return storeImage('logos', buffer, type)
}
