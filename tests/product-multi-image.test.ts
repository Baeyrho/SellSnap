import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { validateImageMagicBytes, uploadProductImages, uploadProductImage } from '../lib/blob'

// Valid minimal signatures
const validJpgBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const validPngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d])
const validWebpBuffer = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
const fakeImageBuffer = Buffer.from('GIF89a this is not a valid format in SellSnap')

function createTestFile(name: string, buffer: Buffer, type: string): File {
  // Wrap in Uint8Array so the BlobPart type is `ArrayBufferView<ArrayBuffer>`,
  // which satisfies the File constructor constraint under strict TS.
  return new File([new Uint8Array(buffer)], name, { type })
}

describe('product image upload validation', () => {
  it('validates JPEG, PNG, and WebP magic bytes correctly', async () => {
    assert.equal(await validateImageMagicBytes(validJpgBuffer), true)
    assert.equal(await validateImageMagicBytes(validPngBuffer), true)
    assert.equal(await validateImageMagicBytes(validWebpBuffer), true)
    assert.equal(await validateImageMagicBytes(fakeImageBuffer), false)
  })

  it('rejects an empty array of images (at least 1 image is required)', async () => {
    await assert.rejects(
      async () => {
        await uploadProductImages([])
      },
      {
        message: 'At least one product image is required.',
      }
    )
  })

  it('rejects more than 3 images (maximum of 3 images allowed)', async () => {
    const file1 = createTestFile('img1.jpg', validJpgBuffer, 'image/jpeg')
    const file2 = createTestFile('img2.jpg', validJpgBuffer, 'image/jpeg')
    const file3 = createTestFile('img3.jpg', validJpgBuffer, 'image/jpeg')
    const file4 = createTestFile('img4.jpg', validJpgBuffer, 'image/jpeg')

    await assert.rejects(
      async () => {
        await uploadProductImages([file1, file2, file3, file4])
      },
      {
        message: 'You can upload a maximum of 3 images.',
      }
    )
  })

  it('rejects a file exceeding the 5MB size limit', async () => {
    // 5MB + 1 byte
    const largeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1)
    validJpgBuffer.copy(largeBuffer, 0, 0, validJpgBuffer.length)
    const largeFile = createTestFile('too-large.jpg', largeBuffer, 'image/jpeg')

    await assert.rejects(
      async () => {
        await uploadProductImage(largeFile)
      },
      {
        message: 'File size exceeds 5MB limit',
      }
    )
  })

  it('rejects a file with an invalid image format', async () => {
    const badFile = createTestFile('fake.jpg', fakeImageBuffer, 'image/jpeg')

    await assert.rejects(
      async () => {
        await uploadProductImage(badFile)
      },
      {
        message: 'Invalid image format. Only JPG, PNG, and WebP are allowed.',
      }
    )
  })

  it('successfully uploads 1, 2, or 3 images and returns an array of URLs', async () => {
    const file1 = createTestFile('photo1.jpg', validJpgBuffer, 'image/jpeg')
    const file2 = createTestFile('photo2.png', validPngBuffer, 'image/png')
    const file3 = createTestFile('photo3.webp', validWebpBuffer, 'image/webp')

    const urls = await uploadProductImages([file1, file2, file3])

    assert.equal(Array.isArray(urls), true)
    assert.equal(urls.length, 3)
    assert.equal(typeof urls[0], 'string')
    assert.equal(typeof urls[1], 'string')
    assert.equal(typeof urls[2], 'string')
  })
})
