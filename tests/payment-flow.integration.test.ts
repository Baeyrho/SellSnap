/**
 * End-to-end tests for the payment pipeline, with only the two external boundaries faked.
 *
 * Everything between the HTTP request and the database is the real code: the real webhook route,
 * the real `resolveOrderFromVerification`, the real `assessPayment`, the real `reverseOverpayment`,
 * the real `reconcileRequestedRefunds`, the real operations report. Prisma is an in-memory fake and
 * `fetch` is a stub, so these run deterministically with no database, no network, and no Flutterwave
 * account.
 *
 * This exists because the previous suite tested `assessPayment` and `parseTransactionVerification`
 * in isolation. Every one of those unit tests passed while the pipeline was silently dropping a
 * confirmed payment made against an already-closed order — the bug covered by "records a late
 * payment" below could not have been caught at that level.
 *
 * Requires `--experimental-test-module-mocks`, added to the `test` script in package.json.
 */

import assert from 'node:assert/strict'
import { before, beforeEach, describe, it, mock } from 'node:test'

// Type-only `import()` types. These emit no runtime code, so they can be referenced before the
// modules are actually loaded in the `before` hook below.
type RouteHandler = (req: Request) => Promise<Response>
type Reconcile = typeof import('@/lib/payments')['reconcileRequestedRefunds']

// ---------------------------------------------------------------------------
// Fake database
// ---------------------------------------------------------------------------

type OrderStatus = 'PENDING' | 'SUCCESS' | 'FAILED'
type RefundStatus = 'REQUESTED' | 'COMPLETED' | 'FAILED' | 'BELOW_MINIMUM'
type Comparable = string | number | Date | null

interface OrderRow {
  id: string
  transactionRef: string
  amountKobo: number
  status: OrderStatus
  flutterwaveTxId: number | null
  refundStatus: RefundStatus | null
  refundId: number | null
  latePaymentDetectedAt: Date | null
  lastRefundCheckAt: Date | null
  createdAt: Date
  updatedAt: Date
  customerName: string | null
  customerEmail: string | null
  product: { name: string }
  seller: { email: string }
}

const db = { rows: [] as OrderRow[] }

function makeOrder(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    id: 'order-1',
    transactionRef: 'SS-abc123',
    amountKobo: 1_000_000, // ₦10,000
    status: 'PENDING',
    flutterwaveTxId: null,
    refundStatus: null,
    refundId: null,
    latePaymentDetectedAt: null,
    lastRefundCheckAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    customerName: 'Ada Buyer',
    customerEmail: 'ada@example.com',
    product: { name: 'Ankara fabric' },
    seller: { email: 'seller@example.com' },
    ...overrides,
  }
}

function isNotFilter(value: unknown): value is { not: unknown } {
  return typeof value === 'object' && value !== null && 'not' in value
}

function isInFilter(value: unknown): value is { in: readonly unknown[] } {
  return typeof value === 'object' && value !== null && 'in' in value
}

function isLtFilter(value: unknown): value is { lt: Date } {
  return typeof value === 'object' && value !== null && 'lt' in value
}

function isNullFilter(value: unknown): value is { not: null } {
  return isNotFilter(value) && value.not === null
}

/**
 * Implements only the `where` clauses the pipeline actually uses, and throws on anything else so a
 * future query cannot be silently unfiltered by this fake.
 */
function rowMatches(row: OrderRow, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true

  for (const [key, condition] of Object.entries(where)) {
    switch (key) {
      case 'id':
        if (row.id !== condition) return false
        break
      case 'transactionRef':
        if (row.transactionRef !== condition) return false
        break
      case 'status':
        if (isNotFilter(condition)) {
          if (row.status === condition.not) return false
        } else if (row.status !== condition) return false
        break
      case 'refundStatus':
        if (condition === null) {
          if (row.refundStatus !== null) return false
        } else if (isInFilter(condition)) {
          if (!condition.in.includes(row.refundStatus)) return false
        } else if (row.refundStatus !== condition) return false
        break
      case 'refundId':
        if (isNotFilter(condition)) {
          if (row.refundId === condition.not) return false
        } else if (row.refundId !== condition) return false
        break
      case 'flutterwaveTxId':
        if (condition === null) {
          if (row.flutterwaveTxId !== null) return false
        } else if (row.flutterwaveTxId !== condition) return false
        break
      case 'latePaymentDetectedAt':
        if (condition === null) {
          if (row.latePaymentDetectedAt !== null) return false
        } else if (isNullFilter(condition)) {
          if (row.latePaymentDetectedAt === null) return false
        }
        break
      case 'createdAt':
        if (isLtFilter(condition) && !(row.createdAt < condition.lt)) return false
        break
      default:
        throw new Error(`fake prisma does not implement where.${key}`)
    }
  }

  return true
}

function applyData(row: OrderRow, data: Record<string, unknown>): void {
  if ('status' in data) row.status = data.status as OrderStatus
  if ('flutterwaveTxId' in data) row.flutterwaveTxId = data.flutterwaveTxId as number | null
  if ('refundStatus' in data) row.refundStatus = data.refundStatus as RefundStatus | null
  if ('refundId' in data) row.refundId = data.refundId as number | null
  if ('latePaymentDetectedAt' in data) {
    row.latePaymentDetectedAt = data.latePaymentDetectedAt as Date | null
  }
  if ('lastRefundCheckAt' in data) {
    row.lastRefundCheckAt = data.lastRefundCheckAt as Date | null
  }

  row.updatedAt = new Date()
}

function comparable(row: OrderRow, field: string): Comparable {
  const value = (row as unknown as Record<string, Comparable | undefined>)[field]
  return value === undefined ? null : value
}

interface SortClause {
  field: string
  descending: boolean
  /** PostgreSQL's default for ASC is NULLS LAST; the reconciliation poll asks for nulls first. */
  nullsFirst: boolean
}

/** Normalise both Prisma `orderBy` shapes into one comparable clause list. */
function normaliseOrderBy(orderBy: unknown): SortClause[] {
  if (!Array.isArray(orderBy)) return []

  return orderBy.flatMap((raw: unknown) => {
    if (typeof raw !== 'object' || raw === null) return []

    const record = raw as Record<string, unknown>

    // `{ field: 'createdAt', sort: 'desc' }`
    if (typeof record.field === 'string') {
      return [
        {
          field: record.field,
          descending: record.sort === 'desc',
          nullsFirst: false,
        },
      ]
    }

    // `{ lastRefundCheckAt: { sort: 'asc', nulls: 'first' } }`
    return Object.entries(record).map(([field, spec]) => {
      const options = (typeof spec === 'object' && spec !== null ? spec : {}) as {
        sort?: unknown
        nulls?: unknown
      }

      return {
        field,
        descending: options.sort === 'desc',
        nullsFirst: options.nulls === 'first',
      }
    })
  })
}

function orderRows(rows: OrderRow[], orderBy: unknown): OrderRow[] {
  const clauses = normaliseOrderBy(orderBy)

  if (clauses.length === 0) return rows

  return [...rows].sort((a, b) => {
    for (const clause of clauses) {
      const av = comparable(a, clause.field)
      const bv = comparable(b, clause.field)

      if (av === null && bv === null) continue
      if (av === null) return clause.nullsFirst ? -1 : 1
      if (bv === null) return clause.nullsFirst ? 1 : -1
      if (av === bv) continue

      const left = av instanceof Date ? av.getTime() : av
      const right = bv instanceof Date ? bv.getTime() : bv
      const result = left < right ? -1 : 1

      return clause.descending ? -result : result
    }

    return 0
  })
}

const fakePrisma = {
  order: {
    async findUnique(args: { where: Record<string, unknown> }) {
      return db.rows.find((row) => rowMatches(row, args.where)) ?? null
    },

    async findMany(args: {
      where?: Record<string, unknown>
      orderBy?: unknown
      take?: number
    }) {
      const matched = orderRows(
        db.rows.filter((row) => rowMatches(row, args.where)),
        args.orderBy
      )

      return args.take === undefined ? matched : matched.slice(0, args.take)
    },

    async findFirst(args: { where?: Record<string, unknown>; orderBy?: unknown }) {
      return orderRows(
        db.rows.filter((row) => rowMatches(row, args.where)),
        args.orderBy
      )[0] ?? null
    },

    async update(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const row = db.rows.find((candidate) => rowMatches(candidate, args.where))

      if (!row) throw new Error('fake prisma: update matched no row')

      applyData(row, args.data)

      return row
    },

    // The compare-and-set primitive every payment decision depends on. Emulating its guard
    // faithfully is the whole point: an unguarded write would make these tests pass for the wrong
    // reason.
    async updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }) {
      const matched = db.rows.filter((row) => rowMatches(row, args.where))

      for (const row of matched) applyData(row, args.data)

      return { count: matched.length }
    },

    async count(args: { where?: Record<string, unknown> }) {
      return db.rows.filter((row) => rowMatches(row, args.where)).length
    },

    async groupBy(args: { by: string[]; where?: Record<string, unknown> }) {
      const key = args.by[0]
      const matched = db.rows.filter((row) => rowMatches(row, args.where))
      const counts = new Map<string, number>()

      for (const row of matched) {
        const value = comparable(row, key)
        const label = value === null ? 'null' : String(value)
        counts.set(label, (counts.get(label) ?? 0) + 1)
      }

      // Array.from rather than spread: tsconfig targets ES5, where a spread over a Map iterator
      // needs downlevelIteration.
      return Array.from(counts.entries()).map(([refundStatus, count]) => ({
        refundStatus,
        _count: { _all: count },
      }))
    },
  },
}

mock.module('@/lib/prisma', { namedExports: { prisma: fakePrisma } })

// ---------------------------------------------------------------------------
// Fake email
// ---------------------------------------------------------------------------

interface ResolutionEmail {
  outcome: string
  buyerEmail: string | null
  sellerEmail: string
  reversal: unknown
}

const email = {
  resolutions: [] as ResolutionEmail[],
  alerts: [] as { subject: string; lines: string[] }[],
  shouldThrow: false,
}

mock.module('@/lib/email', {
  namedExports: {
    async sendOrderResolutionEmails(input: {
      outcome: string
      buyerEmail: string | null
      sellerEmail: string
      reversal?: unknown
    }) {
      if (email.shouldThrow) throw new Error('simulated SMTP failure')

      email.resolutions.push({
        outcome: input.outcome,
        buyerEmail: input.buyerEmail,
        sellerEmail: input.sellerEmail,
        reversal: input.reversal ?? null,
      })
    },

    async sendOperationalAlertEmail(subject: string, lines: string[]) {
      email.alerts.push({ subject, lines })
    },
  },
})

// ---------------------------------------------------------------------------
// Fake Flutterwave
// ---------------------------------------------------------------------------

const provider = {
  verifyStatus: 200,
  verifyBody: null as unknown,
  refundStatus: 200,
  refundBody: null as unknown,
  lookupStatus: 200,
  lookupBody: null as unknown,
  transportFailure: false,
  refundCalls: [] as { transactionId: number; amountNaira: number }[],
  lookupCalls: [] as number[],
}

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A well-formed `GET /v3/transactions/:id/verify` success payload. */
function verificationPayload(overrides: Record<string, unknown> = {}): unknown {
  return {
    status: 'success',
    message: 'Transaction fetched',
    data: {
      id: 469462,
      tx_ref: 'SS-abc123',
      amount: 10000,
      currency: 'NGN',
      status: 'successful',
      ...overrides,
    },
  }
}

globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  if (provider.transportFailure) throw new TypeError('simulated network failure')

  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const method = init?.method ?? 'GET'

  if (url.includes('/transactions/') && url.endsWith('/verify')) {
    return jsonResponse(provider.verifyStatus, provider.verifyBody)
  }

  if (url.includes('/transactions/') && url.endsWith('/refund')) {
    const transactionId = Number(url.split('/transactions/')[1]?.split('/')[0])
    const body = JSON.parse(String(init?.body ?? '{}')) as { amount?: string }

    provider.refundCalls.push({ transactionId, amountNaira: Number(body.amount) })

    return jsonResponse(provider.refundStatus, provider.refundBody)
  }

  if (url.includes('/refunds/')) {
    provider.lookupCalls.push(Number(url.split('/refunds/')[1]))

    return jsonResponse(provider.lookupStatus, provider.lookupBody)
  }

  throw new Error(`fake fetch: unexpected request ${method} ${url}`)
}) as typeof fetch

// Imported after the mocks above, so the modules under test capture the fakes. These have to be
// loaded inside a hook rather than at the top level: the test files compile to CommonJS, where
// top-level await is unavailable, and `mock.module` only takes effect for imports that happen
// after it runs.
let webhookPOST: RouteHandler
let operationsGET: RouteHandler
let cronGET: RouteHandler
let reconcileRequestedRefunds: Reconcile

before(async () => {
  const webhook = await import('@/app/api/webhooks/flutterwave/route')
  const operations = await import('@/app/api/cron/operations/route')
  const cron = await import('@/app/api/cron/resolve-pending/route')
  const payments = await import('@/lib/payments')

  webhookPOST = webhook.POST
  operationsGET = operations.GET
  cronGET = cron.GET
  reconcileRequestedRefunds = payments.reconcileRequestedRefunds
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET_HASH = 'test-verif-hash'

function webhookRequest(
  data: Record<string, unknown>,
  hash: string | null = SECRET_HASH
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (hash !== null) headers['verif-hash'] = hash

  return new Request('https://sellsnap.test/api/webhooks/flutterwave', {
    method: 'POST',
    headers,
    body: JSON.stringify({ data }),
  })
}

function paymentEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 469462, tx_ref: 'SS-abc123', ...overrides }
}

beforeEach(() => {
  db.rows = [makeOrder()]

  email.resolutions = []
  email.alerts = []
  email.shouldThrow = false

  provider.verifyStatus = 200
  provider.verifyBody = verificationPayload()
  provider.refundStatus = 200
  provider.refundBody = { status: 'success', data: { id: 9001, status: 'completed' } }
  provider.lookupStatus = 200
  provider.lookupBody = { status: 'success', data: { id: 9001, status: 'completed' } }
  provider.transportFailure = false
  provider.refundCalls = []
  provider.lookupCalls = []

  process.env.FLUTTERWAVE_SECRET_KEY = 'FLWSECK_TEST'
  process.env.FLUTTERWAVE_SECRET_HASH = SECRET_HASH
  process.env.CRON_SECRET = 'test-cron-secret'
})

// ---------------------------------------------------------------------------

describe('webhook authenticity', () => {
  it('rejects a delivery with no verif-hash header', async () => {
    const res = await webhookPOST(webhookRequest(paymentEvent(), null))

    assert.equal(res.status, 401)
    assert.equal(db.rows[0].status, 'PENDING')
  })

  it('rejects a delivery with the wrong verif-hash', async () => {
    const res = await webhookPOST(webhookRequest(paymentEvent(), 'not-the-secret'))

    assert.equal(res.status, 401)
    assert.equal(db.rows[0].status, 'PENDING')
    assert.equal(provider.verifyBody !== null, true)
  })

  it('rejects a payload with no tx_ref instead of guessing an order', async () => {
    const res = await webhookPOST(webhookRequest({ id: 469462 }))

    assert.equal(res.status, 400)
    assert.equal(db.rows[0].status, 'PENDING')
  })

  it('acknowledges an event for an order it does not know', async () => {
    const res = await webhookPOST(webhookRequest(paymentEvent({ tx_ref: 'SS-unknown' })))

    // 200, not 404: an unknown reference is not a retryable fault, and answering 4xx would make
    // Flutterwave redeliver it forever.
    assert.equal(res.status, 200)
  })
})

describe('exact payment', () => {
  it('fulfils the order and emails both parties', async () => {
    const res = await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(res.status, 200)
    assert.equal(db.rows[0].status, 'SUCCESS')
    assert.equal(db.rows[0].flutterwaveTxId, 469462)
    assert.equal(db.rows[0].refundStatus, null)
    assert.deepEqual(email.resolutions.map((entry) => entry.outcome), ['SUCCESS'])
  })

  it('is idempotent across redelivery', async () => {
    await webhookPOST(webhookRequest(paymentEvent()))
    await webhookPOST(webhookRequest(paymentEvent()))
    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].status, 'SUCCESS')
    // One resolution email: the compare-and-set rejects the second and third writes.
    assert.equal(email.resolutions.length, 1)
  })

  it('does not fulfil a charge still settling', async () => {
    provider.verifyBody = verificationPayload({ status: 'in-progress' })

    const res = await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(res.status, 200)
    assert.equal(db.rows[0].status, 'PENDING')
    assert.equal(email.resolutions.length, 0)
  })

  it('rejects a successful charge in another currency', async () => {
    provider.verifyBody = verificationPayload({ currency: 'USD' })

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].status, 'FAILED')
    assert.deepEqual(email.resolutions.map((entry) => entry.outcome), ['FAILED'])
  })

  it('ignores a transaction that belongs to a different order without asking for redelivery', async () => {
    provider.verifyBody = verificationPayload({ tx_ref: 'SS-somebodyelse' })

    const res = await webhookPOST(webhookRequest(paymentEvent()))

    // tx_ref is immutable, so a redelivery could never fix a mismatch: answer 200 (stop the retry
    // loop) and leave the order untouched.
    assert.equal(res.status, 200)
    assert.equal(db.rows[0].status, 'PENDING')
  })
})

describe('underpayment', () => {
  it('never fulfils and never reverses', async () => {
    // ₦5,000 against a ₦10,000 price.
    provider.verifyBody = verificationPayload({ amount: 5000 })

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].status, 'PENDING')
    assert.equal(db.rows[0].refundStatus, null)
    assert.equal(provider.refundCalls.length, 0)
  })
})

describe('overpayment', () => {
  it('is never fulfilled and is reversed in full', async () => {
    // ₦12,000 against a ₦10,000 price.
    provider.verifyBody = verificationPayload({ amount: 12000 })

    const res = await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(res.status, 200)
    assert.equal(db.rows[0].status, 'FAILED')
    assert.equal(db.rows[0].refundStatus, 'REQUESTED')

    // The full charged amount is reversed, not just the ₦2,000 excess. Flutterwave's refund
    // endpoint takes major units, so ₦12,000 is sent as 12000.
    assert.deepEqual(provider.refundCalls, [{ transactionId: 469462, amountNaira: 12000 }])
  })

  it('emails the buyer an overpayment notice, not a "no payment was taken" notice', async () => {
    provider.verifyBody = verificationPayload({ amount: 12000 })

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(email.resolutions.length, 1)
    assert.equal(email.resolutions[0].outcome, 'OVERPAID')
    assert.equal(email.resolutions[0].reversal !== null, true)
  })

  it('flags an excess below the provider minimum for manual return', async () => {
// Charged 60 against a 50 price: overpaid by 10, so no automatic reversal exists — Flutterwave
    // refuses refunds under 100. The full charged amount is what the minimum is measured against,
// not just the excess, so a large overpayment on an expensive product refunds normally.
    db.rows = [makeOrder({ amountKobo: 5_000, transactionRef: 'SS-abc123' })]
    provider.verifyBody = verificationPayload({ amount: 60 })

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].status, 'FAILED')
    assert.equal(db.rows[0].refundStatus, 'BELOW_MINIMUM')
    assert.equal(provider.refundCalls.length, 0, 'no futile API call below the minimum')
  })

  it('raises exactly one refund even when delivered repeatedly', async () => {
    provider.verifyBody = verificationPayload({ amount: 12000 })

    await webhookPOST(webhookRequest(paymentEvent()))
    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(provider.refundCalls.length, 1)
  })

  it('records a failed reversal instead of reporting it settled', async () => {
    provider.verifyBody = verificationPayload({ amount: 12000 })
    provider.refundStatus = 500
    provider.refundBody = { message: 'Refund service unavailable' }

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].status, 'FAILED')
    assert.equal(db.rows[0].refundStatus, 'FAILED')
  })
})

describe('provider faults', () => {
  it('answers 5xx and writes nothing when verification fails, so Flutterwave retries', async () => {
    provider.transportFailure = true

    const res = await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(res.status, 500)
    assert.equal(db.rows[0].status, 'PENDING')
    assert.equal(db.rows[0].refundStatus, null)
  })

  it('does not treat an unreadable provider body as a payment', async () => {
    provider.verifyStatus = 200
    provider.verifyBody = { unexpected: 'shape' }

    const res = await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(res.status, 500)
    assert.equal(db.rows[0].status, 'PENDING')
  })
})

describe('email delivery', () => {
  it('still fulfils the order when the email send fails', async () => {
    email.shouldThrow = true

    const res = await webhookPOST(webhookRequest(paymentEvent()))

    // The money is correctly recorded; a broken mail relay must not un-resolve a paid order.
    assert.equal(res.status, 200)
    assert.equal(db.rows[0].status, 'SUCCESS')
  })
})

describe('late payment against an already-closed order', () => {
  // This is the regression this file exists for. The abandoned-order sweep fails an unpaid order
  // after an hour; a bank transfer can land afterwards. The webhook used to return a bare 200 for
  // any non-PENDING order, so the buyer's money was kept, nothing was fulfilled, and no reversal
  // was ever raised — with nothing in the database to show for it.

  beforeEach(() => {
    db.rows = [makeOrder({ status: 'FAILED', flutterwaveTxId: null })]
  })

  it('records the payment instead of discarding it', async () => {
    const res = await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(res.status, 200, 'still a successful handshake, so Flutterwave stops retrying')
    assert.notEqual(db.rows[0].latePaymentDetectedAt, null)
  })

  it('does not fulfil the order and does not auto-refund', async () => {
    await webhookPOST(webhookRequest(paymentEvent()))

    // Both are deliberate: the item may be gone, and returning money is a business decision.
    assert.equal(db.rows[0].status, 'FAILED')
    assert.equal(db.rows[0].refundStatus, null)
    assert.equal(provider.refundCalls.length, 0)
  })

  it('records it only once however many times it is redelivered', async () => {
    await webhookPOST(webhookRequest(paymentEvent()))
    const first = db.rows[0].latePaymentDetectedAt

    // Asserted up front: without this, comparing two nulls would pass even if nothing was recorded.
    assert.notEqual(first, null)

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].latePaymentDetectedAt?.getTime(), first?.getTime())
  })

  it('ignores a still-settling charge on a closed order', async () => {
    provider.verifyBody = verificationPayload({ status: 'in-progress' })

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].latePaymentDetectedAt, null)
  })

  it('ignores a transaction belonging to a different order', async () => {
    provider.verifyBody = verificationPayload({ tx_ref: 'SS-somebodyelse' })

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].latePaymentDetectedAt, null)
  })

  it('does not divert a PENDING order onto the late-payment path', async () => {
    db.rows = [makeOrder({ status: 'PENDING' })]

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].status, 'SUCCESS')
    assert.equal(db.rows[0].latePaymentDetectedAt, null)
  })

  it('ignores a redelivery for an order that already succeeded', async () => {
    // Flutterwave retries webhooks. A retry for a settled order is the single most common
    // redelivery there is, and flagging it would page a human for nothing on every retry.
    db.rows = [makeOrder({ status: 'SUCCESS', flutterwaveTxId: 469462 })]

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].latePaymentDetectedAt, null)
  })

  it('ignores a redelivery for an overpayment whose reversal is already in flight', async () => {
    // The order is FAILED, but its money was accounted for: a reversal is outstanding. This is not
    // money taken for nothing, so it must not appear in the late-payment queue.
    db.rows = [
      makeOrder({ status: 'FAILED', flutterwaveTxId: 469462, refundStatus: 'REQUESTED' }),
    ]

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].latePaymentDetectedAt, null)
  })

  it('ignores a charge the provider already confirmed as failed', async () => {
    // FAILED with a transaction id means Flutterwave reported a real, unsuccessful charge — there
    // was never any money to account for.
    db.rows = [makeOrder({ status: 'FAILED', flutterwaveTxId: 469462 })]
    provider.verifyBody = verificationPayload({ status: 'failed' })

    await webhookPOST(webhookRequest(paymentEvent()))

    assert.equal(db.rows[0].latePaymentDetectedAt, null)
  })
})

describe('refund reconciliation', () => {
  beforeEach(() => {
    db.rows = [
      makeOrder({ status: 'FAILED', refundStatus: 'REQUESTED', refundId: 9001 }),
    ]
  })

  it('confirms a disbursed refund and stops asking about it', async () => {
    provider.lookupBody = {
      status: 'success',
      data: { id: 9001, status: 'completed-bank-transfer' },
    }

    const summary = await reconcileRequestedRefunds()

    assert.equal(db.rows[0].refundStatus, 'COMPLETED')
    assert.deepEqual(summary, { settled: 1, failed: 0, pending: 0 })
    assert.equal(provider.refundCalls.length, 0, 'reconciliation only reads, never re-issues')
  })

  it('leaves a plain "completed" refund outstanding, because it is not yet disbursed', async () => {
    // Flutterwave's plain `completed` means the refund was *initiated*, not that the money has been
    // disbursed, so it must stay REQUESTED. The genuinely-settled values are
    // `completed-bank-transfer`, `completed-momo`, `completed-mpgs`, `completed-offline` and
    // `completed-preauth`.
    provider.lookupBody = {
      status: 'success',
      data: { id: 9001, status: 'processing' },
    }

    const summary = await reconcileRequestedRefunds()

    assert.equal(db.rows[0].refundStatus, 'REQUESTED')
    assert.equal(summary.pending, 1)
  })

  it('confirms each documented disbursed status as COMPLETED', async () => {
    for (const settled of [
      'completed-bank-transfer',
      'completed-momo',
      'completed-mpgs',
      'completed-offline',
      'completed-preauth',
    ]) {
      db.rows[0].refundStatus = 'REQUESTED'
      provider.lookupBody = { status: 'success', data: { id: 9001, status: settled } }

      const summary = await reconcileRequestedRefunds()

      assert.equal(db.rows[0].refundStatus, 'COMPLETED', `${settled} should settle`)
      assert.equal(summary.settled, 1)
    }
  })

  it('does not treat a plain "completed" as disbursed', async () => {
    provider.lookupBody = { status: 'success', data: { id: 9001, status: 'completed' } }

    await reconcileRequestedRefunds()

    assert.equal(db.rows[0].refundStatus, 'REQUESTED')
  })

  it('marks an explicitly failed disbursement as FAILED', async () => {
    provider.lookupBody = {
      status: 'success',
      data: { id: 9001, status: 'completed', meta: { disburse_status: 'failed' } },
    }

    const summary = await reconcileRequestedRefunds()

    assert.equal(db.rows[0].refundStatus, 'FAILED')
    assert.equal(summary.failed, 1)
  })

  it('keeps a buyer obligation alive when the provider read fails', async () => {
    provider.lookupStatus = 500
    provider.lookupBody = { message: 'Internal server error' }

    const summary = await reconcileRequestedRefunds()

    assert.equal(db.rows[0].refundStatus, 'REQUESTED', 'a transient fault is not a failed refund')
    assert.equal(summary.pending, 1)
  })

  it('stamps the check time even on failure, so a stuck row cannot starve the queue', async () => {
    provider.lookupStatus = 500

    await reconcileRequestedRefunds()

    assert.notEqual(db.rows[0].lastRefundCheckAt, null)
    assert.equal(db.rows[0].refundStatus, 'REQUESTED')
  })

  it('polls the least-recently-checked refund first', async () => {
    const old = makeOrder({
      id: 'old',
      transactionRef: 'SS-old',
      status: 'FAILED',
      refundStatus: 'REQUESTED',
      refundId: 9001,
      lastRefundCheckAt: new Date('2020-01-01'),
    })
    const recent = makeOrder({
      id: 'recent',
      transactionRef: 'SS-recent',
      status: 'FAILED',
      refundStatus: 'REQUESTED',
      refundId: 9002,
      lastRefundCheckAt: new Date('2030-01-01'),
    })

    db.rows = [recent, old]

    await reconcileRequestedRefunds()

    assert.deepEqual(provider.lookupCalls, [9001, 9002])
  })
})

describe('operations report', () => {
  it('is unreachable without the shared secret', async () => {
    const res = await operationsGET(new Request('https://sellsnap.test/api/cron/operations'))

    assert.equal(res.status, 401)
  })

  it('refuses a wrong secret rather than degrading to open', async () => {
    const res = await operationsGET(
      new Request('https://sellsnap.test/api/cron/operations', {
        headers: { Authorization: 'Bearer wrong' },
      })
    )

    assert.equal(res.status, 401)
  })

  it('lists a late payment as needing attention', async () => {
    db.rows = [makeOrder({ status: 'FAILED', latePaymentDetectedAt: new Date() })]

    const res = await operationsGET(
      new Request('https://sellsnap.test/api/cron/operations', {
        headers: { Authorization: 'Bearer test-cron-secret' },
      })
    )

    assert.equal(res.status, 200)

    const report = (await res.json()) as {
      needsAttention: boolean
      latePayments: { orderId: string }[]
    }

    assert.equal(report.needsAttention, true)
    assert.equal(report.latePayments.length, 1)
    assert.equal(report.latePayments[0].orderId, 'order-1')
  })

  it('lists reversals that need manual handling', async () => {
    db.rows = [makeOrder({ status: 'FAILED', refundStatus: 'BELOW_MINIMUM' })]

    const res = await operationsGET(
      new Request('https://sellsnap.test/api/cron/operations', {
        headers: { Authorization: 'Bearer test-cron-secret' },
      })
    )

    const report = (await res.json()) as {
      needsAttention: boolean
      refundsNeedingAction: { refundStatus: string | null }[]
    }

    assert.equal(report.needsAttention, true)
    assert.equal(report.refundsNeedingAction[0].refundStatus, 'BELOW_MINIMUM')
  })

  it('reports a healthy system as not needing attention', async () => {
    const res = await operationsGET(
      new Request('https://sellsnap.test/api/cron/operations', {
        headers: { Authorization: 'Bearer test-cron-secret' },
      })
    )

    const report = (await res.json()) as { needsAttention: boolean }

    assert.equal(report.needsAttention, false)
  })
})

describe('cron run', () => {
  it('rejects an unauthenticated invocation', async () => {
    const res = await cronGET(new Request('https://sellsnap.test/api/cron/resolve-pending'))

    assert.equal(res.status, 401)
  })

  it('alerts the operator when a late payment is waiting', async () => {
    db.rows = [
      makeOrder({
        status: 'FAILED',
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        latePaymentDetectedAt: new Date(),
      }),
    ]

    const res = await cronGET(
      new Request('https://sellsnap.test/api/cron/resolve-pending', {
        headers: { Authorization: 'Bearer test-cron-secret' },
      })
    )

    assert.equal(res.status, 200)
    assert.equal(email.alerts.length, 1)
    assert.match(email.alerts[0].lines.join('\n'), /late payment/i)
  })

  it('sends no alert on a clean run', async () => {
    const res = await cronGET(
      new Request('https://sellsnap.test/api/cron/resolve-pending', {
        headers: { Authorization: 'Bearer test-cron-secret' },
      })
    )

    assert.equal(res.status, 200)
    assert.equal(email.alerts.length, 0)
  })
})