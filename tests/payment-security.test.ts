import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assessPayment, koboToChargeableNaira, nairaToKobo } from '../lib/kobo'
import { parseTransactionVerification } from '../lib/flutterwave'

/** A well-formed provider verify payload, as documented for GET /v3/transactions/:id/verify. */
function providerVerification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'success',
    message: 'Transaction fetched',
    data: {
      id: 469462,
      tx_ref: 'SS-abcdefghijklmnop',
      amount: 10000,
      currency: 'NGN',
      status: 'successful',
      ...overrides,
    },
  }
}

describe('authoritative amount comparison', () => {
  // ₦10,000 = 1000000 kobo
  const requiredKobo = 1_000_000

  it('rejects an underpayment', () => {
    // Paid ₦5,000 against a ₦10,000 price.
    assert.equal(assessPayment(5000, requiredKobo), 'UNDERPAID')
  })

  it('accepts an exact payment', () => {
    assert.equal(assessPayment(10000, requiredKobo), 'PAID_IN_FULL')
  })

  it('classifies an overpayment as overpaid, never as a success', () => {
    // Paid ₦12,000 against a ₦10,000 price.
    assert.equal(assessPayment(12000, requiredKobo), 'OVERPAID')
  })

  it('treats a one-kobo difference as overpayment, not a rounding artefact', () => {
    assert.equal(assessPayment(10000.01, requiredKobo), 'OVERPAID')
  })

  it('does not reject a payment that covers a sub-naira price exactly', () => {
    // A ₦10,000.50 product charged as 10000.5 must read as exact, not as underpayment.
    assert.equal(assessPayment(10000.5, 1_000_050), 'PAID_IN_FULL')
  })

  it('rejects a zero, negative, or non-numeric amount as underpaid', () => {
    assert.equal(assessPayment(0, requiredKobo), 'UNDERPAID')
    assert.equal(assessPayment(-500, requiredKobo), 'UNDERPAID')
    assert.equal(assessPayment(Number.NaN, requiredKobo), 'UNDERPAID')
    assert.equal(assessPayment(Number.POSITIVE_INFINITY, requiredKobo), 'UNDERPAID')
  })

  it('converts the charge to Naira from the stored kobo price, not from client input', () => {
    // The authoritative price is what the buyer is charged and what the result is judged against.
    assert.equal(koboToChargeableNaira(1_250_000), 12500)
    assert.equal(nairaToKobo(koboToChargeableNaira(1_250_000)), 1_250_000)

    // A tampered client figure of ₦1 cannot satisfy the authoritative ₦10,000 price.
    assert.equal(assessPayment(1, requiredKobo), 'UNDERPAID')
  })
})

describe('provider response shape validation', () => {
  it('accepts a well-formed verification', () => {
    const parsed = parseTransactionVerification(providerVerification())

    assert.deepEqual(parsed, {
      id: 469462,
      tx_ref: 'SS-abcdefghijklmnop',
      amount: 10000,
      currency: 'NGN',
      status: 'successful',
    })
  })

  it('rejects a payload with no data object', () => {
    assert.equal(parseTransactionVerification({ status: 'success' }), null)
    assert.equal(parseTransactionVerification({ status: 'success', data: null }), null)
  })

  it('rejects an array in place of the data object', () => {
    assert.equal(parseTransactionVerification({ data: [{ amount: 10000 }] }), null)
    assert.equal(parseTransactionVerification({ data: 'successful' }), null)
  })

  it('rejects a non-object payload', () => {
    assert.equal(parseTransactionVerification(null), null)
    assert.equal(parseTransactionVerification(undefined), null)
    assert.equal(parseTransactionVerification('ok'), null)
    assert.equal(parseTransactionVerification([{ amount: 10000 }]), null)
  })

  it('rejects a payload missing any field the payment decision reads', () => {
    // Every one of these would otherwise reach the amount check as `undefined`.
    assert.equal(parseTransactionVerification(providerVerification({ id: undefined })), null)
    assert.equal(parseTransactionVerification(providerVerification({ status: undefined })), null)
    assert.equal(parseTransactionVerification(providerVerification({ amount: undefined })), null)
    assert.equal(parseTransactionVerification(providerVerification({ currency: undefined })), null)
    assert.equal(parseTransactionVerification(providerVerification({ tx_ref: undefined })), null)
  })

  it('rejects wrongly typed or non-finite critical fields', () => {
    assert.equal(parseTransactionVerification(providerVerification({ amount: '10000' })), null)
    assert.equal(parseTransactionVerification(providerVerification({ amount: Number.NaN })), null)
    assert.equal(parseTransactionVerification(providerVerification({ id: '469462' })), null)
    assert.equal(parseTransactionVerification(providerVerification({ status: '' })), null)
    assert.equal(parseTransactionVerification(providerVerification({ tx_ref: '' })), null)
  })

  it('cannot yield a successful payment from a malformed response', () => {
    // The end-to-end guarantee: a shape that fails validation can never reach the order
    // transition, so it can never be compared as a sufficient payment.
    const parsed = parseTransactionVerification({ data: { status: 'successful' } })

    assert.equal(parsed, null)
  })
})
