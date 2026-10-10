---
trigger: always_on
---

# security.md

> Authentication, payment verification, input validation, and secrets rules for SellSnap.

---

## Authentication

- Auth is handled by **NextAuth.js v5** using the Credentials provider (email + password).
- Session strategy is **JWT**. Sessions expire after 30 days.
- Every authenticated API route calls `await auth()` as the first operation before any business logic. `auth` is exported from `lib/auth` — there is no `authOptions` export and `getServerSession` is not used in this project.
- If `session` is null or `session.user.id` is missing, return `401 UNAUTHENTICATED` immediately.
- Every authenticated route that accesses a product, order, or bank account verifies ownership by comparing `resource.sellerId` against `session.user.id`. Return `403 FORBIDDEN` on mismatch.

```ts
// Standard auth check — use this pattern in every authenticated route
import { auth } from '@/lib/auth'

const session = await auth()
if (!session?.user?.id) {
  return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
}
```

---

## Password Handling

- Passwords are hashed with **bcrypt**, cost factor **12**.
- Raw passwords are never logged, stored, or returned in any API response.
- Password minimum requirements enforced at both client (UX) and server (authoritative): min 8 chars, at least 1 uppercase letter, at least 1 number.
- Password reset tokens are hashed (SHA-256) before storage. The raw token is sent in the email link only. Tokens expire after 1 hour and are invalidated on first use.
- Both ends of the flow use `hashResetToken()` from `lib/password-reset-token.ts`. The issue route stores the digest, the confirm route hashes the submitted token and looks up that digest. Never store or look up the raw token.

---

## Flutterwave Payment Verification — Three-Step Mandatory

Browser-reported payment status is **never trusted**. Every payment must be verified server-side before order status is updated.

**Step 1 — Webhook signature check:**
```ts
const hash = req.headers.get('verif-hash')
if (!hash || hash !== process.env.FLUTTERWAVE_SECRET_HASH) {
  // Log: IP, timestamp
  return new Response(null, { status: 401 })
}
```

**Step 2 — Flutterwave verify API call:**
After the signature check passes, call `GET https://api.flutterwave.com/v3/transactions/:id/verify` using `FLUTTERWAVE_SECRET_KEY`. The verified response must be shape-checked before any field is read — see *Provider Response Validation* below.

Every payment-resolution path then applies the amount rule through `resolveOrderFromVerification()` in `lib/payments.ts`. Do not re-implement the decision inside a route handler: the webhook and the cron must not be able to disagree about what counts as paid.

```ts
const verification = await verifyTransactionById(transactionId)
const resolution = await resolveOrderFromVerification(order, verification)
```

The rule, applied to `order.amountKobo` (captured from the product row, never from the request):

| Provider result | Outcome |
|---|---|
| `status !== 'successful'` and not `'failed'` | Left `PENDING` — bank transfer and USSD settle late |
| `status === 'failed'` | `FAILED` |
| Currency is not `NGN` | `FAILED` — SellSnap only ever charges NGN |
| Paid **less than** the price | Left `PENDING`. **Never `SUCCESS`.** |
| Paid **exactly** the price | `SUCCESS` |
| Paid **more than** the price | **Not fulfilled.** Full reversal requested — see below |

Comparison is made in integer kobo via `assessPayment()` in `lib/kobo.ts`. Never compare Naira decimals directly, and never treat "paid at least the price" as success.

---

## Overpayment — Mandatory Full Reversal

If the provider confirms an amount **greater** than the authoritative price, the order must **not** be fulfilled and the **entire confirmed amount** must be returned to the buyer.

This is handled once, in `lib/payments.ts`, for every resolution path:

1. **Claim, then act.** A single compare-and-set flips the order `PENDING → FAILED`, stores `flutterwaveTxId`, and sets `refundStatus = 'REQUESTED'` with `where: { status: 'PENDING', refundStatus: null }`. Only the request that wins that update may call Flutterwave, so a retried webhook or a concurrent cron run cannot send a second refund.
2. **Reverse the full amount.** `refundTransaction()` in `lib/flutterwave.ts` calls `POST /v3/transactions/{id}/refund` with the provider-confirmed amount in Naira. Never refund a partial or computed amount — the whole transaction is reversed.
3. **Record the real outcome.** Flutterwave refunds are asynchronous. `refundStatus` is only set to `COMPLETED` when Flutterwave confirms disbursement (`completed-bank-transfer`, `completed-momo`, `completed-mpgs`, `completed-offline`, `completed-preauth`). Its plain `completed` means *initiated and pending disbursement* and is recorded as `REQUESTED`, not `COMPLETED`.
4. **Never fulfil on refund failure.** If the refund request or the refund fails, `refundStatus` becomes `FAILED` and the order stays `FAILED`.
5. **Reconcile every outstanding reversal.** An overpaid order is already `FAILED`, so the stale-order sweep never selects it again. `reconcileRequestedRefunds()` in `lib/payments.ts`, called by the same cron, reads each `REQUESTED` refund via `GET /v3/refunds/{id}` and promotes it to `COMPLETED` or `FAILED` on provider-confirmed evidence. It **only ever reads** — it never calls the refund endpoint, so no number of overlapping runs can double-refund a buyer. Flutterwave documents that refund webhooks are not delivered unless the account has them enabled by their internal team, so this poll is the only mechanism available by default.
6. **A refund read that fails leaves the row `REQUESTED`.** A provider fault, an unreadable body, or an id the provider does not recognise is not evidence the refund failed. Writing it off would close a real obligation to the buyer, so it is re-read on the next run.
7. **Below the provider minimum, flag it — never absorb it.** Flutterwave refuses refunds under **NGN 100**, so an excess below that (e.g. a ₦50 overpayment) cannot be reversed through the API at all. `refundTransaction()` rejects it before spending a provider request, and the order is recorded as `refundStatus = 'BELOW_MINIMUM'` rather than a generic `FAILED`. This is a business decision: the buyer is still owed the money and it must be returned manually via the Flutterwave dashboard. Do not quietly keep the excess.

### What the buyer is told about an overpayment

Overpayment has its own email outcome. Reusing the ordinary failure email is actively harmful: it states *"No payment was taken"* and invites a retry, when the money **was** taken and is being returned — a buyer following that advice pays twice. `sendOrderResolutionEmails` takes an `OVERPAID` outcome plus a `reversal.status`, and wording is chosen per status:

| `reversal.status` | Buyer is told |
|---|---|
| `REVERSAL_SETTLED` | The full amount charged has been returned to the payment method. |
| `REVERSAL_IN_PROGRESS` | The full amount is being returned; usually 3–15 working days. Do not pay again. |
| `MANUAL_REQUIRED` | No automatic reversal is possible; the team will return it manually. Nothing to do. |

No variant may claim a refund completed unless Flutterwave confirmed disbursement.

The order `FAILED` and the refund lifecycle are deliberately separate concerns: an overpaid order is finished, but its refund can still be outstanding. Reuse the existing `OrderStatus`; do not add a new one for this.

---

## Provider Response Validation

A 2xx from Flutterwave is not a guarantee of a usable body. `json.data` must never be cast straight to a transaction type — an array, a null `data`, or a missing `amount`/`status`/`tx_ref` would otherwise reach the payment decision as `undefined`.

`parseTransactionVerification()` in `lib/flutterwave.ts` is the single guard. It requires an object `data` containing a finite numeric `id`, a non-empty `status`, a finite numeric `amount`, a non-empty `currency` and a non-empty `tx_ref`, and returns `null` for anything else.

- **Verify by ID** — an unusable shape throws. The webhook answers `500` and Flutterwave redelivers; the order stays `PENDING`.
- **Verify by reference** — `null` is returned **only** for an authoritative "no such transaction" response, which is the safe condition to resolve the order `FAILED`. Everything else throws and leaves the order `PENDING`.

### Distinguishing "never paid" from "could not tell"

An abandoned-order sweep may only mark an order `FAILED` when the provider *positively* confirms no transaction exists. Guessing wrong here destroys revenue: a genuinely paid order gets failed, and the buyer's money is never delivered.

Flutterwave's `GET /v3/transactions/verify_by_reference` documents only `200` and `400`. **A missing transaction is reported as `400`, not `404`**, with `data: null` and a message such as `No transaction was found for this id`. Treat only a `404` and a `400` whose message matches `/no transaction was found|transaction not found/i` as confirmed absence. A `400` with any other message is a rejected request, not an absent transaction.

Every other failure is classified and thrown as `VerificationError` by `classifyHttpStatus()`, and the order stays `PENDING` for the next sweep:

| Failure | Kind | Effect on the order |
|---|---|---|
| `401`, `403`, missing/rotated secret | `unauthorized` | stays `PENDING` — configuration problem, not buyer behaviour |
| `429`, any `5xx` | `unavailable` | stays `PENDING` — retry next sweep |
| Network failure, DNS failure, abort/timeout (`PROVIDER_TIMEOUT_MS`) | `unavailable` | stays `PENDING` |
| `400` with any other message | `rejected` | stays `PENDING` |
| `2xx` with an unusable body | `malformed` | stays `PENDING` — webhook answers `500`, Flutterwave redelivers |
| Refund below the provider's published minimum (NGN 100) | `below_minimum` | order stays `FAILED`, `refundStatus = 'BELOW_MINIMUM'` for manual return |

### The same discipline applies to every provider call

The guard is not limited to transaction verification. A `2xx` proves nothing about a body, and every value that is persisted or shown to a buyer is validated before use:

| Call | Guard | Why it matters |
|---|---|---|
| `createSubaccount()` | `parseSubaccountResponse()` requires a numeric `id` and a non-empty string `subaccount_id` | This id decides whose bank account the money lands in. An unchecked cast let `data: null` become `{ subaccount_id: undefined }`, which would have been stored and then sent on live payments. |
| `initializePayment()` | `parsePaymentLink()` requires an absolute **https** URL | The link becomes the buyer's redirect target. A relative, scheme-relative, or `javascript:` value is rejected rather than handed over. |
| `refundTransaction()` | requires a record `data` with a finite `id` and non-empty `status` | The id is the only handle for reconciliation. |
| `fetchRefundStatus()` | `parseRefundStatus()` requires a record `data` with a non-empty `status` | A malformed read must not resolve an outstanding reversal. |

Every provider call — including the POSTs — goes through `providerGet()`/`providerPost()`, so all of them share the same `PROVIDER_TIMEOUT_MS` bound and transport classification. Failures are described by `throwProviderError()`, which surfaces only the provider's truncated `message`; raw bodies are never logged because they can echo request content back into logs.

A transaction the provider explicitly reports as `failed` is *not* an error: it is returned as a normal verification so the state machine can resolve the order `FAILED`. Requesting verification must never itself resolve an order.

Never treat a thrown `VerificationError` as absence, and never log its cause — errors carry only the status and a truncated provider message so the secret key and `Authorization` header cannot leak into logs.

Malformed responses must never produce a successful or fulfilled order, and provider responses and secrets must never be returned to the buyer.

**Never do this:**
```ts
// WRONG — trusting the browser redirect or webhook payload status without server verification
if (req.body.status === 'successful') {
  await updateOrderToSuccess() // ← NEVER
}
```

Also never do this:
```ts
// WRONG — unvalidated cast; every critical field can silently be undefined
const verification = (await res.json()).data as TransactionVerification
```

---

## Secret Key Rules

| Variable | Allowed in | Forbidden in |
|---|---|---|
| `FLUTTERWAVE_SECRET_KEY` | Server-side only (`lib/flutterwave.ts`, route handlers) | Client Components, `NEXT_PUBLIC_` vars |
| `FLUTTERWAVE_SECRET_HASH` | Server-side only (webhook handler) | Client Components, `NEXT_PUBLIC_` vars |
| `NEXTAUTH_SECRET` | NextAuth config only | Anywhere else |
| `DATABASE_URL` | `lib/prisma.ts` only | Anywhere else |
| `SMTP_PASS` | `lib/email.ts` only | Anywhere else |
| `BLOB_READ_WRITE_TOKEN` | `lib/blob.ts` only | Anywhere else |
| `CRON_SECRET` | `api/cron/*` route handlers only | Anywhere else |

**There is no `FLUTTERWAVE_PUBLIC_KEY` in this project.** Checkout is a server-side redirect to Flutterwave's hosted page, not a browser SDK integration, so no public key is needed, set, or read. `FLUTTERWAVE_PUBLIC_KEY` appearing in a task description or an older document is stale — do not add it, and do not add a `NEXT_PUBLIC_` Flutterwave variable.

The only `NEXT_PUBLIC_` variable in use is `NEXT_PUBLIC_APP_URL`, and it holds an origin, not a secret. Treat any new `NEXT_PUBLIC_` variable as a decision that requires justification: the prefix makes the value readable in the browser.

---

## Image Upload Validation

File type must be validated on the **server using magic bytes** — not the browser-supplied MIME type, which can be spoofed.

```ts
async function validateImageMagicBytes(buffer: Buffer): Promise<boolean> {
  const jpgSignature  = [0xFF, 0xD8, 0xFF]
  const pngSignature  = [0x89, 0x50, 0x4E, 0x47]
  const webpSignature = [0x52, 0x49, 0x46, 0x46] // followed by WEBP at offset 8

  const bytes = Array.from(buffer.subarray(0, 12))

  const isJpg  = jpgSignature.every((b, i)  => bytes[i] === b)
  const isPng  = pngSignature.every((b, i)  => bytes[i] === b)
  const isWebp = webpSignature.every((b, i) => bytes[i] === b) &&
                 buffer.slice(8, 12).toString('ascii') === 'WEBP'

  return isJpg || isPng || isWebp
}
```

Maximum file size: **5 MB**. Enforce on the server — client validation is UX only.

If either check fails, return `400 VALIDATION_ERROR` with `field: "image"`. Do not upload to Vercel Blob.

---

## Rate Limiting

The payment initiation route `POST /api/product-page/[slug]/pay` is rate-limited in `proxy.ts`:

- Max **10 requests per IP per hour**.
- Exceed limit: return `429 RATE_LIMIT_EXCEEDED`.

**Known limitation — per-instance, not global.** The counter is module-level state in `lib/rate-limit.ts` (invoked from `proxy.ts`), so it is process-local. On Vercel each concurrent serverless instance keeps its own bucket, and a cold start or deploy clears every counter. The effective ceiling is therefore roughly `10 × instances` per hour per IP, and **no** limit is guaranteed across a restart.

This control is intentionally left in place rather than replaced: it still bounds abuse within an instance, and removing it would leave payment initiation unprotected. A genuinely global limit requires a shared external store — Redis, Upstash, or an equivalent rate-limiting service — read by every instance.

**Decision (reviewed): no shared store is warranted today.** Do not add one without an explicit owner decision. The reasoning, so it is not re-litigated blindly:

- **Neither limited endpoint moves money.** `POST /api/product-page/[slug]/pay` only creates a `PENDING` order and returns Flutterwave's hosted link. Funds move only after a buyer completes Flutterwave's page, and the outcome is always re-derived server-side by `resolveOrderFromVerification()`. Exceeding the limit costs order rows and provider quota, not money.
- **The abusable side effect is already globally limited.** Sending mail to a caller-supplied address is the one genuinely harmful action, and the reset route already carries a **database-backed** 3/hour/email cap. That cap is consistent across every instance and survives restarts, so the worst outcome of the per-instance limit is spam that is already stopped.
- **A mandatory shared store would reduce protection if unprovisioned.** The credentials are owner-supplied. A Redis dependency that is unset would either fail closed and block all checkout, or fail open and silently remove the limit.

If traffic or abuse warrants it later, the upgrade path is to keep these same two rules and back them with a shared store. Do not change the limits without an explicit decision.

The password reset request route `POST /api/auth/reset-password/request` is also rate-limited, more strictly because it sends an email to an address supplied by the caller:

- Max **5 requests per IP per hour** in `proxy.ts`.
- Max **3 requests per email address per hour**, enforced in the route by counting `PasswordResetToken` rows created in the last hour for that user.
- Throttled requests still return the same generic `200` response so the endpoint cannot be used to enumerate accounts or measure the limit.

Additional per-IP rules in `proxy.ts` (all per-instance): registration **5/hour**, reset-confirm **10/hour**, and credential login (`/api/auth/callback/credentials`) **20/15 min**. Login is additionally protected by a **per-account soft lockout** in `lib/auth.ts` (5 consecutive failures → 15-minute lock, stored on `User.failedLoginAttempts`/`lockedUntil`), which is consistent across instances even though the IP limit is not.

---

## Cron Job Authentication

The PENDING order resolution cron route is not protected by a session. It is protected by a shared secret passed as a bearer token:

```ts
// api/cron/resolve-pending/route.ts
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(null, { status: 401 })
  }
  // ...
}
```

Vercel Cron invokes a `vercel.json` cron path with an **HTTP GET**. When `CRON_SECRET` is configured on the Vercel project, the value is sent automatically in the `Authorization` header with a `Bearer` prefix. Do not read it from a custom header such as `CRON_SECRET` — Vercel never sends that header, and the job would reject every invocation.

### What the cron runs

One invocation does two independent sweeps, in order:

1. **Stale `PENDING` orders** — abandoned payments, verified through `resolveOrderFromVerification()`.
2. **Outstanding reversals** — `reconcileRequestedRefunds()` reads every `REQUESTED` refund. This runs second so a reversal raised during step 1 is not immediately re-read.

Both are bounded and both are safe to overlap. See *Overpayment — Mandatory Full Reversal* for why the second sweep is necessary and why it may only read.

### Sweep Batching

The sweep reads at most `take: 50` eligible orders per invocation and resolves them through `resolveOrderFromVerification()`. Two properties matter:

- **Deterministic order.** The query is `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`. `createdAt` alone is not a total order — many orders share a checkout timestamp — so `id` breaks the ties and makes batch membership reproducible instead of dependent on the query planner. The oldest orders are always handled first.
- **A bounded batch drains.** Backing off a batch is what lets the rest advance, so the query, the per-order write, and the email must all stay inside the loop. Hoisting them out re-selects the same head rows on every run and the tail never drains. Because the batch is bounded, a backlog larger than 50 needs successive runs to clear — that is expected, not a failure.

Every order is resolved in its own `try/catch`. One provider or SMTP failure must not abandon the remaining orders in the batch, and a failure leaves that order `PENDING` for the next run with its `VerificationError` kind logged.

### The cron must not fail silently

A scheduled job that only writes to stdout is indistinguishable from a healthy one. The cron therefore reports rather than merely logs:

- Every operational event goes through `lib/logger.ts` as a single-line JSON object with a stable `event` key, so Vercel's log search can filter on it. Never pass secrets or full provider bodies to it.
- The run emits `cron.run_completed` with `resolved`, `verificationFailures` and the refund summary.
- Anything the sweep cannot fix on its own — a late payment, a reversal below the provider minimum, a backlog it did not reach, a stale `PENDING` count — triggers `sendOperationalAlertEmail()`. A run that throws at all alerts too.
- **An alert failure must never fail the run.** The sweep's work is already correctly persisted; wrap the alert and log `cron.operational_alert_failed` instead.

Alerting is an accountability mechanism, not a payment control. No order state may depend on an alert being sent.

### Fair batching in the refund sweep

`reconcileRequestedRefunds()` orders by `[{ lastRefundCheckAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }]` and stamps `lastRefundCheckAt` on **every** attempt — success, pending, and read failure alike.

The reason is starvation. Ordering by `updatedAt` (the previous behaviour) never changed while a refund sat unsettled, so a refund the provider never finishes held the same slot on every run; once enough such rows accumulated they filled the batch and newer reversals were never polled at all. `lastRefundCheckAt` is bookkeeping only — `refundStatus` remains the single authoritative signal, and stamping it never changes a refund's state.

---

## Operational Visibility

There is no admin role in the data model, and adding one would mean a new authorisation model for a single screen. The operations queue is therefore served from the boundary that already exists — the shared `CRON_SECRET`:

```ts
// app/api/cron/operations/route.ts — read-only, CRON_SECRET guarded
```

This route is the answer to "how do I find stuck reversals?". It reports, bounded and oldest-first:

| Field | Condition |
|---|---|
| `latePayments` | Provider confirmed a payment for an order already closed |
| `refundsNeedingAction` | `refundStatus` is `BELOW_MINIMUM` or `FAILED` |
| `refundBacklog` | Reversals awaiting disbursement, and the age of the oldest |
| `stalePendingOrders` | `PENDING` orders older than the sweep window |

Both the cron's alert decision and this report read from `collectOperationsReport()` in `lib/operations.ts`, so the alert can never describe a different set of problems from the one an operator is shown.

**Non-negotiable:** this route must fail closed when `CRON_SECRET` is unset. An unset secret must never degrade to "no auth" — the response contains sellers' and buyers' email addresses. Do not hang refund or reversal detail off the seller dashboard to make it easier to reach; that exposes one seller's counterparties to another.

Manual procedures live in `docs/OPERATIONS.md`. Owner: `[Assign owner]`.

### Late payments against a closed order

A buyer paying by bank transfer or USSD can legitimately complete a payment *after* the abandoned-order sweep has resolved the order `FAILED`. The money reaches the seller's subaccount, but the order is closed, so nothing is fulfilled and no reversal is raised.

The webhook therefore records this rather than discarding the event:

- `isLatePaymentCandidate(order)` is the single eligibility rule, and it requires **all three** of `status === 'FAILED'`, `flutterwaveTxId === null`, and `latePaymentDetectedAt === null`. `FAILED` alone is not enough: a provider-confirmed *failed* charge and an overpayment whose reversal is in flight both also leave the order `FAILED`, and both already have their money accounted for. Flagging them would page a human on every webhook redelivery — the commonest redelivery there is. A null `flutterwaveTxId` on a `FAILED` order is exactly the abandoned-order sweep's signature.
- `markLatePaymentDetected()` repeats that same rule in its `where` clause rather than trusting the caller's copy of the order, so a concurrent sweep cannot slip a row past the check. `latePaymentDetectedAt: null` makes the write idempotent under redelivery.
- The webhook checks eligibility **before** spending a provider round trip, so redeliveries for settled orders stay free.
- **It must not fulfil the order** — the item may be sold — **and must not auto-refund** — returning money is a business decision. Both are recorded as deliberate non-actions with the reasoning in `docs/OPERATIONS.md`.
- A verification error in this path propagates and answers 5xx on purpose, so a provider blip gets a second chance via Flutterwave's redelivery.
- Only a provider-confirmed `successful` transaction bound back to this order's `tx_ref` may be recorded.

### Email is never authoritative

`sendOrderResolutionEmails()` and `sendOperationalAlertEmail()` are best-effort. A mail failure must never change a resolved order's fate — the money is recorded in the database, not in an inbox.

It must not be invisible either. `sendEmail()` emits `email.smtp_not_configured` naming the recipient when no relay is configured, and a failed send is logged with the order id. Every caller wraps the send so the failure cannot propagate.

---

## Input Sanitisation

- All user input is validated server-side before touching the database. Client-side validation is UX only — never authoritative.
- String fields are trimmed before storage: `name.trim()`, `email.trim().toLowerCase()`.
- Email fields are validated with `isValidEmail()` from `lib/validation.ts`. It is deliberately permissive; the authoritative test of deliverability is whether the provider accepts the address. Do not add a second, stricter regex.
- Price inputs are converted to integer kobo server-side and validated as positive integers. `POST /api/products` is multipart and receives `priceNaira` as a string, which it converts once with `nairaToKobo()`; JSON routes that accept a kobo integer validate it with `Number.isInteger(priceKobo) && priceKobo > 0`.
- The billing amount on the pay route is derived from the product row, never read from the request body.

---

## Ownership Checks

Never skip this check. A seller must only be able to read, modify, or delete their own resources.

```ts
const product = await prisma.product.findUnique({ where: { id: params.id } })
if (!product) return errorResponse(404, 'NOT_FOUND', 'This product does not exist.')
if (product.sellerId !== session.user.id) return errorResponse(403, 'FORBIDDEN', 'You do not have access to this product.')
```

---

## HTTPS

HTTPS is enforced by Vercel in production. No HTTP fallback is permitted. Do not write HTTP URLs in any application code.

---

## Privacy (NDPR)

- Buyer PII (name, email) is used only for order fulfilment and seller notification.
- Seller bank details (`accountNumber`, `bankCode`) are stored as plain columns on `User`. They are **not** application-level encrypted — do not claim otherwise in documentation. Whatever encryption-at-rest the database provider applies is theirs, not a control this codebase implements. Treat these columns as sensitive: never select them into a public response, never log them, and keep them out of `ORDER_RESOLUTION_INCLUDE`.
- The privacy policy link must be visible in the footer of every product page.
- Do not log full buyer email addresses or bank account numbers in server logs. Truncate or hash identifiable fields before logging.
