import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { detectImageType, validateImageMagicBytes } from '../lib/blob'
import { safeEqual } from '../lib/secure-compare'
import { isValidEmail, passwordPolicyError } from '../lib/validation'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])

describe('secure-compare', () => {
  it('is true only for identical strings', () => {
    assert.equal(safeEqual('abc', 'abc'), true)
    assert.equal(safeEqual('abc', 'abd'), false)
    assert.equal(safeEqual('abc', 'abcd'), false)
  })

  it('is false when either side is missing or not a string', () => {
    assert.equal(safeEqual(undefined, 'abc'), false)
    assert.equal(safeEqual('abc', undefined), false)
    assert.equal(safeEqual(null, null), false)
  })
})

describe('email validation', () => {
  it('accepts ordinary ASCII addresses', () => {
    assert.equal(isValidEmail('seller@example.com'), true)
  })

  it('rejects addresses containing a non-ASCII homoglyph', () => {
    const homoglyph = `seller@ex${String.fromCharCode(0x0430)}mple.com`
    assert.equal(isValidEmail(homoglyph), false)
  })
})

describe('image type detection', () => {
  it('detects jpeg, png and webp from magic bytes', () => {
    assert.deepEqual(detectImageType(JPEG), { mime: 'image/jpeg', ext: '.jpg' })
    assert.deepEqual(detectImageType(PNG), { mime: 'image/png', ext: '.png' })
    assert.deepEqual(detectImageType(WEBP), { mime: 'image/webp', ext: '.webp' })
  })

  it('does not mistake a non-image payload for an image', () => {
    assert.equal(detectImageType(Buffer.from('GIF89a padding padding')), null)
  })

  it('keeps the boolean helper in sync', async () => {
    assert.equal(await validateImageMagicBytes(JPEG), true)
    assert.equal(await validateImageMagicBytes(Buffer.from('not an image!')), false)
  })
})

describe('password policy', () => {
  it('requires minimum length and a mix of case and digits', () => {
    assert.equal(passwordPolicyError('Short1'), 'Password must be at least 8 characters.')
    assert.equal(
      passwordPolicyError('alllowercase1'),
      'Password must contain at least one uppercase letter and one number.'
    )
    assert.equal(passwordPolicyError('GoodPass1'), null)
  })
})
