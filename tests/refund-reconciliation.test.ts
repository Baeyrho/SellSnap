import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
  createSubaccount,
  fetchRefundStatus,
  initializePayment,
  MINIMUM_REFUND_NAIRA,
  refundTransaction,
  VerificationError,
} from '../lib/flutterwave'

/**
 * Covers the reversal lifecycle controls: the published minimum refund amount, the difference
 * between "accepted", "disbursed" and "failed", and the response-shape guards on the two provider
 * calls that decide whether a seller's bank account and a buyer's redirect target are usable.
 *
 * As with the verification tests, `fetch` is stubbed at the module boundary. No live Flutterwave
 * infrastructure is used and no real secret is involved.
 */

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_SECRET = process.env.FLUTTERWAVE_SECRET_KEY

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Record every request the module makes, and reply with the supplied responses in order. */
function recordFetch(responses: Response[]): { calls: Array<{ url: string; method: string }> } {
  const calls: Array<{ url: string; method: string }> = []
  let index = 0

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
    })

    const response = responses[index++]
    if (!response) throw new Error(`unexpected extra request to ${String(input)}`)

    return Promise.resolve(response)
  }) as unknown as typeof fetch

  return { calls }
}

function stubFetch(impl: () => Promise<Response>): void {
  globalThis.fetch = impl as unknown as typeof fetch
}

async function assertFailsWith(promise: Promise<unknown>, kind: string): Promise<VerificationError> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  )

  assert.ok(error instanceof VerificationError, 'expected a VerificationError to be thrown')
  assert.equal(error.kind, kind)

  return error
}

beforeEach(() => {
  process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST-PLACEHOLDER'
})

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH

  if (ORIGINAL_SECRET === undefined) {
    delete process.env.FLUTTERWAVE_SECRET_KEY
  } else {
    process.env.FLUTTERWAVE_SECRET_KEY = ORIGINAL_SECRET
  }
})

describe('refundTransaction — published minimum refund amount', () => {
  it('documents a minimum of NGN 100', () => {
    assert.equal(MINIMUM_REFUND_NAIRA, 100)
  })

  it('refuses to call the provider below the minimum', async () => {
    let called = false
    stubFetch(async () => {
      called = true
      return jsonResponse(200, { data: { id: 1, status: 'completed' } })
    })

    // NGN 50 excess on a NGN 1,000 item: the reversal cannot be raised at all.
    const error = await assertFailsWith(refundTransaction(3091255, 50, 'reason'), 'below_minimum')

    assert.equal(called, false, 'must not spend a provider request on an impossible refund')
    assert.match(error.message, /minimum refund amount/i)
  })

  it('treats exactly the minimum as acceptable', async () => {
    stubFetch(async () =>
      jsonResponse(200, { status: 'success', data: { id: 89074, status: 'completed', amount_refunded: 100 } })
    )

    const refund = await refundTransaction(3091255, MINIMUM_REFUND_NAIRA, 'reason')

    assert.equal(refund.refundId, 89074)
  })

  it("classifies the documented 400 as below_minimum rather than a generic rejection", async () => {
    stubFetch(async () =>
      jsonResponse(400, { status: 'error', message: 'Amount should be above NGN100', data: null })
    )

    await assertFailsWith(refundTransaction(3091255, 50, 'reason'), 'below_minimum')
  })

  it('still classifies an unrelated rejection as rejected, not below_minimum', async () => {
    stubFetch(async () => jsonResponse(400, { status: 'error', message: 'Invalid transaction id', data: null }))

    await assertFailsWith(refundTransaction(3091255, 5000, 'reason'), 'rejected')
  })

  it('never leaks the secret key into the error', async () => {
    stubFetch(async () =>
      jsonResponse(400, { status: 'error', message: 'Amount should be above NGN100', data: null })
    )

    const error = await refundTransaction(3091255, 10, 'reason').then(
      () => null,
      (err: unknown) => err as VerificationError
    )

    assert.ok(error instanceof VerificationError)
    assert.equal(error.message.includes('FLWSECK_TEST-PLACEHOLDER'), false)
  })
})

describe('fetchRefundStatus — accepted is not disbursed', () => {
  it('reads the documented lookup endpoint with a GET', async () => {
    const { calls } = recordFetch([jsonResponse(200, { status: 'success', data: { id: 89074, status: 'completed' } })])

    await fetchRefundStatus(89074)

    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.flutterwave.com/v3/refunds/89074')
    // A reconciliation that could POST here would be able to refund a buyer twice.
    assert.equal(calls[0].method, 'GET')
  })

  it('treats plain "completed" as still outstanding, not settled', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', data: { id: 89074, status: 'completed' } }))

    const result = await fetchRefundStatus(89074)

    // Flutterwave documents "completed" as initiated and pending disbursement, so treating it as
    // settled would claim a buyer's money had been returned before it had.
    assert.equal(result.status, 'completed')
    assert.equal(result.settled, false)
    assert.equal(result.failed, false)
  })

  it('treats each documented settled status as settled', async () => {
    for (const status of [
      'completed-bank-transfer',
      'completed-momo',
      'completed-mpgs',
      'completed-offline',
      'completed-preauth',
    ]) {
      stubFetch(async () => jsonResponse(200, { status: 'success', data: { id: 89074, status } }))

      const result = await fetchRefundStatus(89074)

      assert.equal(result.settled, true, `${status} should count as settled`)
      assert.equal(result.failed, false)
    }
  })

  it('treats "processing" and "pending-momo" as outstanding', async () => {
    for (const status of ['processing', 'pending-momo']) {
      stubFetch(async () => jsonResponse(200, { status: 'success', data: { id: 89074, status } }))

      const result = await fetchRefundStatus(89074)

      assert.equal(result.settled, false)
      assert.equal(result.failed, false, `${status} must not be written off as failed`)
    }
  })

  it('detects the documented disbursement failure carried in meta', async () => {
    stubFetch(async () =>
      jsonResponse(200, {
        status: 'success',
        data: {
          id: 89074,
          status: 'processing',
          meta: '{"source":"ledgerbalance","isPartialRefund":true,"disburse_status":"failed"}',
        },
      })
    )

    const result = await fetchRefundStatus(89074)

    assert.equal(result.settled, false)
    assert.equal(result.failed, true)
  })

  it('reads a meta object as well as a meta JSON string', async () => {
    stubFetch(async () =>
      jsonResponse(200, { status: 'success', data: { id: 89074, status: 'processing', meta: { disburse_status: 'failed' } } })
    )

    assert.equal((await fetchRefundStatus(89074)).failed, true)
  })

  it('does not treat unparseable meta as a failure', async () => {
    stubFetch(async () =>
      jsonResponse(200, { status: 'success', data: { id: 89074, status: 'processing', meta: 'not json' } })
    )

    const result = await fetchRefundStatus(89074)

    assert.equal(result.failed, false)
    assert.equal(result.settled, false)
  })

  it('never reports failure from a provider fault', async () => {
    for (const status of [500, 503, 429]) {
      stubFetch(async () => jsonResponse(status, { message: 'upstream problem' }))

      // An unreadable refund is not a failed refund: writing it off would close a real obligation.
      await assertFailsWith(fetchRefundStatus(89074), 'unavailable')
    }
  })

  it('classifies a malformed 200 as malformed, never as a refund outcome', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', data: null }))

    await assertFailsWith(fetchRefundStatus(89074), 'malformed')

    stubFetch(async () => jsonResponse(200, { status: 'success', data: { id: 89074 } }))

    await assertFailsWith(fetchRefundStatus(89074), 'malformed')
  })
})

describe('createSubaccount — an unusable subaccount id must not be persisted', () => {
  it('accepts a well-formed response', async () => {
    stubFetch(async () =>
      jsonResponse(200, { status: 'success', data: { id: 10221, subaccount_id: 'FLWSUB-1' } })
    )

    const subaccount = await createSubaccount('058', '0123456789', 'Acme', 'a@example.com')

    assert.equal(subaccount.subaccount_id, 'FLWSUB-1')
  })

  it('rejects a 200 carrying a null data object', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', data: null }))

    await assertFailsWith(
      createSubaccount('058', '0123456789', 'Acme', 'a@example.com'),
      'malformed'
    )
  })

  it('rejects a response missing the subaccount id', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', data: { id: 10221 } }))

    await assertFailsWith(
      createSubaccount('058', '0123456789', 'Acme', 'a@example.com'),
      'malformed'
    )
  })

  it('rejects a non-string subaccount id rather than storing it as valid', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', data: { id: 10221, subaccount_id: 99 } }))

    await assertFailsWith(
      createSubaccount('058', '0123456789', 'Acme', 'a@example.com'),
      'malformed'
    )
  })
})

describe('initializePayment — the checkout link is a redirect target', () => {
  it('accepts an https checkout link', async () => {
    stubFetch(async () =>
      jsonResponse(200, { status: 'success', data: { link: 'https://checkout.flutterwave.com/pay/abc123' } })
    )

    const payment = await initializePayment('SS-abcdefghijklmnop', 10000, 'b@example.com', undefined, 'https://sellsnap.com/return')

    assert.equal(payment.link, 'https://checkout.flutterwave.com/pay/abc123')
  })

  it('rejects a non-https link', async () => {
    stubFetch(async () =>
      jsonResponse(200, { status: 'success', data: { link: 'javascript:alert(1)' } })
    )

    await assertFailsWith(
      initializePayment('SS-abcdefghijklmnop', 10000, 'b@example.com', undefined, 'https://sellsnap.com/return'),
      'malformed'
    )
  })

  it('rejects a scheme-relative link', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', data: { link: '//evil.example/pay' } }))

    await assertFailsWith(
      initializePayment('SS-abcdefghijklmnop', 10000, 'b@example.com', undefined, 'https://sellsnap.com/return'),
      'malformed'
    )
  })

  it('rejects a null data object instead of throwing a bare TypeError', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', data: null }))

    const error = await initializePayment('SS-abcdefghijklmnop', 10000, 'b@example.com', undefined, 'https://sellsnap.com/return').then(
      () => null,
      (err: unknown) => err
    )

    assert.ok(error instanceof VerificationError)
    assert.equal(error.kind, 'malformed')
  })

  it('does not leak the raw provider body into the error', async () => {
    stubFetch(async () =>
      jsonResponse(500, 'FLWSECK_TEST-PLACEHOLDER internal detail')
    )

    const error = await initializePayment('SS-abcdefghijklmnop', 10000, 'b@example.com', undefined, 'https://sellsnap.com/return').then(
      () => null,
      (err: unknown) => err as VerificationError
    )

    assert.ok(error instanceof VerificationError)
    assert.equal(error.message.includes('FLWSECK_TEST-PLACEHOLDER'), false)
    assert.equal(error.message.includes('internal detail'), false)
  })
})