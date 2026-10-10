import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'

import {
  VerificationError,
  verifyTransactionById,
  verifyTransactionByRef,
} from '../lib/flutterwave'

/**
 * These tests stub `fetch` at the module boundary so the provider's real HTTP responses can be
 * replayed. No live Flutterwave infrastructure is used and no real secret is involved — the key
 * read by the module is a placeholder set here.
 */

const ORIGINAL_FETCH = globalThis.fetch
const ORIGINAL_SECRET = process.env.FLUTTERWAVE_SECRET_KEY

/** Build a Response-alike carrying the given status and JSON body. */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** The documented not-found body: 400, "No transaction was found...", data null. */
function notFoundBody(message = 'No transaction was found for this id'): unknown {
  return { status: 'error', message, data: null }
}

function foundBody(overrides: Record<string, unknown> = {}): unknown {
  return {
    status: 'success',
    message: 'Transaction fetched successfully',
    data: {
      id: 3091255,
      tx_ref: 'SS-abcdefghijklmnop',
      amount: 10000,
      currency: 'NGN',
      status: 'successful',
      ...overrides,
    },
  }
}

/** Replace global fetch with a stub that returns the supplied response, or rejects. */
function stubFetch(impl: () => Promise<Response>): void {
  globalThis.fetch = impl as unknown as typeof fetch
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

/** Assert the call rejects with a VerificationError of the given kind. */
async function assertFailsWith(
  promise: Promise<unknown>,
  kind: string
): Promise<VerificationError> {
  const error = await promise.then(
    () => null,
    (err: unknown) => err
  )

  assert.ok(error instanceof VerificationError, 'expected a VerificationError to be thrown')
  assert.equal(error.kind, kind)

  return error
}

describe('verifyTransactionByRef — confirmed not found only', () => {
  it('returns null for the documented 400 not-found response', async () => {
    stubFetch(async () => jsonResponse(400, notFoundBody()))

    assert.equal(await verifyTransactionByRef('SS-abcdefghijklmnop'), null)
  })

  it('returns null for the alternative "Transaction not found" wording', async () => {
    stubFetch(async () => jsonResponse(400, notFoundBody('Transaction not found')))

    assert.equal(await verifyTransactionByRef('SS-abcdefghijklmnop'), null)
  })

  it('returns null for a bare 404', async () => {
    stubFetch(async () => jsonResponse(404, notFoundBody()))

    assert.equal(await verifyTransactionByRef('SS-abcdefghijklmnop'), null)
  })
})

describe('verifyTransactionByRef — provider faults are never "not found"', () => {
  it('classifies 503 as unavailable, not as a missing transaction', async () => {
    stubFetch(async () => jsonResponse(503, { message: 'Service Unavailable' }))

    const error = await assertFailsWith(
      verifyTransactionByRef('SS-abcdefghijklmnop'),
      'unavailable'
    )

    assert.equal(error.httpStatus, 503)
  })

  it('classifies 500 as unavailable', async () => {
    stubFetch(async () => jsonResponse(500, { message: 'Internal Server Error' }))

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'unavailable')
  })

  it('classifies 429 rate limiting as unavailable', async () => {
    stubFetch(async () => jsonResponse(429, { message: 'Too Many Requests' }))

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'unavailable')
  })

  it('classifies 401 as unauthorized, not as a missing transaction', async () => {
    stubFetch(async () => jsonResponse(401, { message: 'Invalid API key' }))

    const error = await assertFailsWith(
      verifyTransactionByRef('SS-abcdefghijklmnop'),
      'unauthorized'
    )

    assert.equal(error.httpStatus, 401)
  })

  it('classifies 403 as unauthorized', async () => {
    stubFetch(async () => jsonResponse(403, { message: 'Forbidden' }))

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'unauthorized')
  })

  it('classifies a network failure as unavailable', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'unavailable')
  })

  it('classifies a timeout as unavailable', async () => {
    stubFetch(async () => {
      const error = new Error('The operation was aborted')
      error.name = 'TimeoutError'
      throw error
    })

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'unavailable')
  })

  it('does not leak the secret key or headers into the error', async () => {
    stubFetch(async () => jsonResponse(500, { message: 'boom' }))

    const error = await assertFailsWith(
      verifyTransactionByRef('SS-abcdefghijklmnop'),
      'unavailable'
    )

    assert.ok(!error.message.includes('FLWSECK'))
    assert.ok(!error.message.includes('Bearer'))
  })

  it('treats a 400 that is not a not-found message as a rejected request', async () => {
    // A malformed tx_ref must not be mistaken for "the buyer never paid".
    stubFetch(async () => jsonResponse(400, { message: 'Invalid request', data: null }))

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'rejected')
  })

  it('treats a 400 with an unreadable body as a rejected request, not as not found', async () => {
    stubFetch(async () => new Response('<html>Bad Gateway</html>', { status: 400 }))

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'rejected')
  })
it('classifies a missing secret as unauthorized, not as a transient outage', async () => {
    // Retrying cannot fix an unset secret, so it must not be reported as `unavailable`.
    delete process.env.FLUTTERWAVE_SECRET_KEY
    let called = false
    stubFetch(async () => {
      called = true
      return jsonResponse(200, foundBody())
    })

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'unauthorized')
    assert.equal(called, false, 'no request should be attempted without a secret key')
  })
})

describe('verifyTransactionByRef — successful and malformed responses', () => {
  it('returns the verification for a well-formed 200', async () => {
    stubFetch(async () => jsonResponse(200, foundBody()))

    const verification = await verifyTransactionByRef('SS-abcdefghijklmnop')

    assert.deepEqual(verification, {
      id: 3091255,
      tx_ref: 'SS-abcdefghijklmnop',
      amount: 10000,
      currency: 'NGN',
      status: 'successful',
    })
  })

  it('passes an explicitly failed transaction through for the resolver to act on', async () => {
    // A provider-reported failure must reach the state machine, never be short-circuited here.
    stubFetch(async () => jsonResponse(200, foundBody({ status: 'failed' })))

    const verification = await verifyTransactionByRef('SS-abcdefghijklmnop')

    assert.equal(verification?.status, 'failed')
  })

  it('classifies a 200 with a null data object as malformed, not as not found', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', message: 'ok', data: null }))

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'malformed')
  })

  it('classifies a 200 with an array in place of data as malformed', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', data: [{ amount: 10000 }] }))

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'malformed')
  })

  it('classifies a 200 with a missing amount as malformed', async () => {
    stubFetch(async () =>
      jsonResponse(200, {
        status: 'success',
        data: { id: 1, tx_ref: 'SS-abcdefghijklmnop', currency: 'NGN', status: 'successful' },
      })
    )

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'malformed')
  })

  it('classifies an unparseable 200 body as malformed', async () => {
    stubFetch(async () => new Response('not json at all', { status: 200 }))

    await assertFailsWith(verifyTransactionByRef('SS-abcdefghijklmnop'), 'malformed')
  })
})

describe('verifyTransactionById — same classification discipline', () => {
  it('returns the verification for a well-formed 200', async () => {
    stubFetch(async () => jsonResponse(200, foundBody()))

    const verification = await verifyTransactionById(3091255)

    assert.equal(verification.status, 'successful')
  })

  it('classifies a 5xx as unavailable', async () => {
    stubFetch(async () => jsonResponse(502, { message: 'Bad Gateway' }))

    await assertFailsWith(verifyTransactionById(3091255), 'unavailable')
  })

  it('classifies a 401 as unauthorized', async () => {
    stubFetch(async () => jsonResponse(401, { message: 'Invalid API key' }))

    await assertFailsWith(verifyTransactionById(3091255), 'unauthorized')
  })

  it('classifies a network failure as unavailable', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })

    await assertFailsWith(verifyTransactionById(3091255), 'unavailable')
  })

  it('classifies a malformed 200 as malformed, never as a payment result', async () => {
    stubFetch(async () => jsonResponse(200, { status: 'success', data: { id: 1 } }))

    await assertFailsWith(verifyTransactionById(3091255), 'malformed')
  })
})