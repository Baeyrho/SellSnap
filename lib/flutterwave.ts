/** Flutterwave API base URL */
const FLW_BASE_URL = 'https://api.flutterwave.com/v3'

/** Upper bound on a single provider read. Without it a hung connection stalls the webhook
 *  response and the whole cron invocation. */
const PROVIDER_TIMEOUT_MS = 10_000

/** Read the secret key, or fail with a classified configuration error.
 *
 *  A missing key is `unauthorized`, not `unavailable`: it is a deploy-time fault that no amount of
 *  retrying will fix, and every order would otherwise be left PENDING with a misleading reason. */
function getSecretKeyOrThrow(): string {
  const key = process.env.FLUTTERWAVE_SECRET_KEY
  if (!key) {
    throw new VerificationError(
      'unauthorized',
      'FLUTTERWAVE_SECRET_KEY is not set; provider requests cannot be attempted'
    )
  }
  return key
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Why a provider read could not produce a trustworthy transaction outcome.
 *
 *  These are kept distinct on purpose: only `not_found` is evidence that a payment never
 *  happened. Every other kind means SellSnap does not currently know the transaction's state,
 *  and the order must be left unresolved rather than failed. */
export type VerificationFailureKind =
  /** The provider explicitly states no such transaction exists. */
  | 'not_found'
  /** 401/403 — secret key wrong, revoked, or missing permissions. A configuration fault. */
  | 'unauthorized'
  /** 5xx, 429, timeout, DNS, connection reset. The provider is not answering right now. */
  | 'unavailable'
  /** Other 4xx — the request itself was rejected. */
  | 'rejected'
  /** 2xx whose body is not a usable transaction object. */
  | 'malformed'
  /** A refund below Flutterwave's published minimum. It cannot be automated at all, so it is
   *  reported as its own kind instead of being lost inside a generic rejection. */
  | 'below_minimum'

/** A provider read that could not yield a trustworthy outcome. Carries the classification so
 *  callers can log it and decide without string-matching the message. */
export class VerificationError extends Error {
  readonly kind: VerificationFailureKind
  readonly httpStatus: number | null

  constructor(kind: VerificationFailureKind, message: string, httpStatus: number | null = null) {
    super(message)
    this.name = 'VerificationError'
    this.kind = kind
    this.httpStatus = httpStatus
  }
}

/** Map a non-2xx status to a failure kind. `not_found` is never produced here — it requires an
 *  explicit provider message and is decided by the caller. */
function classifyHttpStatus(status: number): VerificationFailureKind {
  if (status === 401 || status === 403) return 'unauthorized'
  // Rate limiting and server faults are both transient from our side; retrying later is correct.
  if (status === 429 || status >= 500) return 'unavailable'
  return 'rejected'
}

/** Read the provider's human-readable message from an error body, if it has one.
 *
 *  The body is consumed. Only `message` is surfaced, truncated, because the full error body can
 *  echo request content. Never returns anything derived from the secret key. */
async function readProviderMessage(res: Response): Promise<string | null> {
  try {
    const body: unknown = await res.json()

    if (isRecord(body) && typeof body.message === 'string' && body.message) {
      return body.message.slice(0, 200)
    }
  } catch {
    // Non-JSON error body (gateway HTML, empty response). Nothing to read.
  }

  return null
}

/** GET a provider resource with a bounded timeout.
 *
 *  Transport failures become `unavailable` rather than escaping as raw `TypeError`/`AbortError`:
 *  a dropped connection says nothing about whether the transaction exists, so it must never be
 *  read as "not found". The thrown error carries no cause, since that can retain request headers. */
async function providerGet(path: string): Promise<Response> {
  // Resolved before the try so an unset secret is reported as the configuration fault it is.
  // Inside the try it would be swallowed and misreported as `unavailable`, which would tell an
  // operator to retry a request that can never succeed.
  const secretKey = getSecretKeyOrThrow()

  try {
    return await fetch(`${FLW_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
  } catch {
    throw new VerificationError(
      'unavailable',
      `Flutterwave verification request failed before a response (timeout or network failure)`
    )
  }
}

/** POST a JSON body to the provider with the same bounds as `providerGet`.
 *
 *  Subaccount creation and payment initialisation previously used a bare `fetch` with no timeout
 *  and no transport classification, so a hung connection stalled the request until the platform
 *  killed it and surfaced an opaque error. Both problems are fixed by routing every provider call
 *  through this helper. */
async function providerPost(path: string, body: unknown): Promise<Response> {
  // Resolved before the try so an unset secret is reported as the configuration fault it is.
  const secretKey = getSecretKeyOrThrow()

  try {
    return await fetch(`${FLW_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    })
  } catch {
    throw new VerificationError(
      'unavailable',
      'Flutterwave request failed before a response (timeout or network failure)'
    )
  }
}

/** Raise a classified error for any non-2xx provider response.
 *
 *  One place decides how a failure is described and logged. Only the provider's own truncated
 *  `message` is surfaced, so the raw body — which can echo request content — and the secret key
 *  never reach a log line. */
async function throwProviderError(res: Response, what: string): Promise<never> {
  const message = await readProviderMessage(res)

  throw new VerificationError(
    classifyHttpStatus(res.status),
    `Flutterwave ${what} failed with status ${res.status}${message ? `: ${message}` : ''}`,
    res.status
  )
}

interface SubaccountPayload {
  account_bank: string
  account_number: string
  business_name: string
  business_email: string
  split_type: 'flat'
  split_value: number
}

interface SubaccountResponse {
  id: number
  subaccount_id: string
}

/** Runtime guard for the subaccount response.
 *
 *  The caller persists `subaccount_id` and then sends it on every payment for this seller, where
 *  it decides whose bank account the money lands in. An unchecked cast let a 2xx carrying
 *  `data: null` through as `{ subaccount_id: undefined }`, which would have been stored as if it
 *  were valid — so validating the shape here is what stops an unusable subaccount id from being
 *  persisted and later sent on a live payment. */
function parseSubaccountResponse(payload: unknown): SubaccountResponse | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null

  const { id, subaccount_id: subaccountId } = payload.data

  if (typeof id !== 'number' || !Number.isFinite(id)) return null
  if (typeof subaccountId !== 'string' || !subaccountId) return null

  return { id, subaccount_id: subaccountId }
}

/** Create a Flutterwave subaccount for split payments to the seller's bank */
export async function createSubaccount(
  bankCode: string,
  accountNumber: string,
  businessName: string,
  businessEmail: string
): Promise<SubaccountResponse> {
  const payload: SubaccountPayload = {
    account_bank: bankCode,
    account_number: accountNumber,
    business_name: businessName,
    business_email: businessEmail,
    split_type: 'flat',
    split_value: 0, // Platform takes nothing in V1
  }

  const res = await providerPost('/subaccounts', payload)

  if (!res.ok) {
    await throwProviderError(res, 'subaccount creation')
  }

  const subaccount = parseSubaccountResponse(await res.json().catch(() => null))

  if (!subaccount) {
    throw new VerificationError(
      'malformed',
      'Flutterwave subaccount creation returned an unusable response shape'
    )
  }

  return subaccount
}

interface PaymentPayload {
  tx_ref: string
  amount: number
  currency: string
  redirect_url: string
  customer: {
    email: string
    name?: string
  }
  subaccounts?: Array<{
    id: string
  }>
  meta?: Record<string, string>
}

interface PaymentInitResponse {
  link: string
}

/** Runtime guard for the hosted-checkout link.
 *
 *  This value is returned to the buyer and becomes the redirect target, so it must never be taken
 *  on trust. Previously `{ link: json.data.link as string }` threw a bare `TypeError` when `data`
 *  was null and passed any non-string value straight through to the client. Only an absolute
 *  https URL is a usable hosted-checkout target; a relative path, a scheme-relative
 *  `//evil.example`, or a `javascript:` URL is rejected rather than handed to the buyer. */
function parsePaymentLink(payload: unknown): string | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null

  const { link } = payload.data

  if (typeof link !== 'string' || !link.trim()) return null

  let parsed: URL
  try {
    parsed = new URL(link)
  } catch {
    return null
  }

  return parsed.protocol === 'https:' ? parsed.toString() : null
}

/** Initiate a Flutterwave payment — returns the hosted checkout URL */
export async function initializePayment(
  txRef: string,
  amountNaira: number,
  customerEmail: string,
  customerName: string | undefined,
  redirectUrl: string,
  subaccountId?: string,
  meta?: Record<string, string>
): Promise<PaymentInitResponse> {
  const payload: PaymentPayload = {
    tx_ref: txRef,
    amount: amountNaira,
    currency: 'NGN',
    redirect_url: redirectUrl,
    customer: {
      email: customerEmail,
      ...(customerName ? { name: customerName } : {}),
    },
    ...(subaccountId ? { subaccounts: [{ id: subaccountId }] } : {}),
    ...(meta ? { meta } : {}),
  }

  const res = await providerPost('/payments', payload)

  if (!res.ok) {
    await throwProviderError(res, 'payment init')
  }

  const link = parsePaymentLink(await res.json().catch(() => null))

  if (!link) {
    throw new VerificationError(
      'malformed',
      'Flutterwave payment init returned no usable checkout link'
    )
  }

  return { link }
}

export interface TransactionVerification {
  id: number
  status: string
  amount: number
  currency: string
  tx_ref: string
}

/** Runtime guard for the provider's verify payload.
 *
 *  The verify endpoints are trusted only after this check: `json.data` was previously cast
 *  straight to `TransactionVerification`, so an array, a null `data`, or an object missing
 *  `amount`/`status`/`tx_ref` flowed into the payment decision as `undefined`. Rejecting the
 *  shape here is what makes every downstream comparison fail safely instead of accidentally
 *  passing. Only the fields SellSnap's payment logic actually reads are required. */
export function parseTransactionVerification(
  payload: unknown
): TransactionVerification | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null

  const { id, status, amount, currency, tx_ref: txRef } = payload.data

  if (typeof id !== 'number' || !Number.isFinite(id)) return null
  if (typeof status !== 'string' || !status) return null
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return null
  if (typeof currency !== 'string' || !currency) return null
  if (typeof txRef !== 'string' || !txRef) return null

  return { id, status, amount, currency, tx_ref: txRef }
}

/** Verify a transaction by its Flutterwave transaction ID.
 *
 *  Used by the webhook, where Flutterwave supplies the transaction id. Throws a
 *  `VerificationError` for every condition other than a usable transaction, so no caller can
 *  mistake an unreadable provider response for a payment outcome. */
export async function verifyTransactionById(
  transactionId: number
): Promise<TransactionVerification> {
  const res = await providerGet(`/transactions/${transactionId}/verify`)

  if (!res.ok) {
    await throwProviderError(res, 'verification')
  }

  // A 2xx response is not a guarantee of a usable body. Classifying this as `malformed` keeps
  // the order PENDING for the cron to re-check rather than letting undefined fields decide the
  // payment outcome — neither a false success nor a false failure.
  const verification = parseTransactionVerification(await res.json().catch(() => null))

  if (!verification) {
    throw new VerificationError(
      'malformed',
      'Flutterwave verification returned an unusable response shape'
    )
  }

  return verification
}

/** The provider's wording for "no such transaction". Flutterwave documents this as
 *  `{ "status": "error", "message": "No transaction was found for this id", "data": null }`,
 *  and its error reference states such errors are returned with a 400 status. The wording for the
 *  by-reference endpoint is not documented separately, so both known phrasings are accepted. */
const NOT_FOUND_MESSAGE = /no transaction was found|transaction not found/i

/** Verify a transaction by its tx_ref (used by the cron job).
 *
 *  Returns `null` **only** for a confirmed "no such transaction", which is the single case where
 *  the provider has told us the payment never existed and the order can safely be resolved as
 *  failed. Every other outcome throws a classified `VerificationError`, so a provider outage,
 *  a rejected key, or an unreadable body leaves the order PENDING for the next run instead of
 *  failing a payment that may well have succeeded. */
export async function verifyTransactionByRef(
  txRef: string
): Promise<TransactionVerification | null> {
  const res = await providerGet(
    `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(txRef)}`
  )

  if (!res.ok) {
    const message = await readProviderMessage(res)

    // 404 is not documented for this endpoint but is unambiguous if it ever occurs.
    if (res.status === 404) return null

    // The documented not-found response is a 400 carrying that message. Anything else that is a
    // 400 is a rejected request, which is a fault on our side and says nothing about the payment.
    if (res.status === 400 && message !== null && NOT_FOUND_MESSAGE.test(message)) {
      return null
    }

    await throwProviderError(res, 'reference verification')
  }

  // A 2xx with no usable transaction object is not evidence of anything. Keeping it unresolved
  // is the fail-safe choice: it can become neither a false success nor a false failure.
  const verification = parseTransactionVerification(await res.json().catch(() => null))

  if (!verification) {
    throw new VerificationError(
      'malformed',
      'Flutterwave reference verification returned an unusable response shape'
    )
  }

  return verification
}

/** Refund statuses that mean the refund has actually been disbursed to the customer.
 *
 *  Flutterwave's plain `completed` is documented as "refund has been initiated and is pending
 *  disbursement", so it is deliberately absent — treating it as settled would let SellSnap claim
 *  a buyer's money had been returned before it had. `processing`, `pending-momo` and
 *  `failed` are likewise not settled. */
const REFUND_SETTLED_STATUSES = new Set([
  'completed-bank-transfer',
  'completed-momo',
  'completed-mpgs',
  'completed-offline',
  'completed-preauth',
])

/** Smallest refund Flutterwave accepts, in Naira.
 *
 *  Documented as "The minimum amount for refunds is NGN 100 and KES 10", with a 400 carrying
 *  "Amount should be above NGN100". Below this the reversal cannot be raised through the API at
 *  all, so it is detected before the request is made and reported as `below_minimum` — a distinct,
 *  actionable outcome rather than an anonymous provider rejection that looks like a bug. */
export const MINIMUM_REFUND_NAIRA = 100

/** Flutterwave's wording for a below-minimum refund. Capturing the number keeps the failure
 *  classified correctly if the published minimum is ever raised. */
const BELOW_MINIMUM_MESSAGE = /should be above\s*ngn\s*?(\d+)/i

export interface RefundResult {
  /** Flutterwave's refund ID — the handle for `GET /v3/refunds/{id}` status checks. */
  refundId: number
  amountRefundedNaira: number
  /** True only when Flutterwave confirmed the refund was disbursed to the customer. */
  settled: boolean
}

/** Refund a transaction in full.
 *
 *  `POST /v3/transactions/{id}/refund`, authenticated with the secret key. The amount is sent in
 *  Naira (major units), the unit Flutterwave uses on this endpoint, derived from the
 *  provider-confirmed kobo amount so the reversal matches what was actually charged.
 *
 *  Refunds are asynchronous: a 2xx means the refund was *accepted*, not that the money has moved.
 *  Callers must persist the returned state and treat anything not settled as still outstanding. */
export async function refundTransaction(
  transactionId: number,
  amountNaira: number,
  reason: string
): Promise<RefundResult> {
  // Checked first so the impossible case is never reported as a provider fault, and so no
  // pointless request is made. The provider's own message is still matched below, in case the
  // published minimum and this constant ever drift apart.
  if (!Number.isFinite(amountNaira) || amountNaira < MINIMUM_REFUND_NAIRA) {
    throw new VerificationError(
      'below_minimum',
      `Refund of NGN${amountNaira} is below Flutterwave's minimum refund amount of ` +
        `NGN${MINIMUM_REFUND_NAIRA} and cannot be automated`
    )
  }

  const res = await providerPost(`/transactions/${transactionId}/refund`, {
    amount: String(amountNaira),
    comments: reason,
  })

  if (!res.ok) {
    // Only the provider's own message is surfaced; the raw body and the secret key are never
    // logged or propagated to the buyer.
    const detail = await readProviderMessage(res)

    if (detail !== null && BELOW_MINIMUM_MESSAGE.test(detail)) {
      throw new VerificationError(
        'below_minimum',
        `Flutterwave rejected the refund as below its minimum amount: ${detail}`,
        res.status
      )
    }

    await throwProviderError(res, 'refund')
  }

  const payload = await res.json().catch(() => null)

  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new VerificationError(
      'malformed',
      'Flutterwave refund returned an unusable response shape'
    )
  }

  const { id, status } = payload.data

  if (typeof id !== 'number' || !Number.isFinite(id) || typeof status !== 'string' || !status) {
    throw new VerificationError(
      'malformed',
      'Flutterwave refund returned an unusable response shape'
    )
  }

  const amountRefunded =
    typeof payload.data.amount_refunded === 'number' && Number.isFinite(payload.data.amount_refunded)
      ? payload.data.amount_refunded
      : amountNaira

  return {
    refundId: id,
    amountRefundedNaira: amountRefunded,
    settled: REFUND_SETTLED_STATUSES.has(status),
  }
}

/** What one refund-status read can establish. */
export interface RefundStatusResult {
  /** The provider's raw status string, for the operational log. */
  status: string
  /** True only for a provider-confirmed disbursement to the customer. */
  settled: boolean
  /** True only when the provider explicitly reports the refund as failed. */
  failed: boolean
}

/** Detect an explicit provider failure signal on a refund.
 *
 *  Flutterwave publishes no `failed` value in its refund status table, but documents the lookup
 *  response as carrying the outcome in `meta` — a JSON string such as
 *  `disburse_status: "failed"`. Only that explicit signal, or a status literally reading `failed`,
 *  counts as a failure. The mere absence of a success is never read as one: an unsettled refund
 *  is the normal state of a reversal that Flutterwave documents as taking 3–15 working days. */
function isDisbursementFailed(meta: unknown): boolean {
  if (typeof meta === 'string') {
    try {
      return isDisbursementFailed(JSON.parse(meta) as unknown)
    } catch {
      // Not JSON. Nothing to read, and nothing to conclude.
      return false
    }
  }

  return isRecord(meta) && meta.disburse_status === 'failed'
}

/** Runtime guard for the refund-lookup payload. */
function parseRefundStatus(payload: unknown): RefundStatusResult | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null

  const { status } = payload.data

  if (typeof status !== 'string' || !status) return null

  const settled = REFUND_SETTLED_STATUSES.has(status)

  return {
    status,
    settled,
    failed: status === 'failed' || (!settled && isDisbursementFailed(payload.data.meta)),
  }
}

/** Read the current state of an already-raised refund.
 *
 *  `GET /v3/refunds/{id}`. Flutterwave documents this as the way to check a refund's final status
 *  when the `callbackurl` option is not used, and it is the only mechanism available by default:
 *  the docs state that refund webhooks are not sent unless the account has them enabled by
 *  Flutterwave's internal team.
 *
 *  This is strictly a read. It never raises a refund, so reconciliation cannot double-refund.
 *  A non-2xx response throws, because it is not evidence about the refund's state — an unknown id
 *  is a fault on our side, and reporting it as a failed reversal would wrongly close an
 *  outstanding obligation to the buyer. */
export async function fetchRefundStatus(refundId: number): Promise<RefundStatusResult> {
  const res = await providerGet(`/refunds/${refundId}`)

  if (!res.ok) {
    await throwProviderError(res, 'refund status lookup')
  }

  const result = parseRefundStatus(await res.json().catch(() => null))

  if (!result) {
    throw new VerificationError(
      'malformed',
      'Flutterwave refund status lookup returned an unusable response shape'
    )
  }

  return result
}
