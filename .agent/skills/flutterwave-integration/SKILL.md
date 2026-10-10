# SKILL — Flutterwave Integration

> Use this skill for any task involving Flutterwave: payment initiation, webhook handling, subaccount creation, transaction verification, or overpayment reversal.

---

## Before You Start

1. Read `.agent/rules/security.md` — the mandatory verification steps and the full amount-decision table. **This skill does not replace it.**
2. Read `.agent/rules/architecture.md` — public vs protected routes, database access.
3. Read `.agent/skills/api-route-scaffolder/SKILL.md` — API route conventions and the standard response envelope.

---

## Overview

SellSnap uses **Flutterwave Subaccounts**. Each seller has a Flutterwave subaccount, so a buyer's payment settles directly into the seller's bank account. The platform takes nothing: `split_type: 'flat'`, `split_value: 0`.

Payment gateway: **Flutterwave only.** Paystack is not used.

### The checkout is a server-side redirect — there is no client-side payment modal

This is the single most important thing to know. SellSnap does **not** use `flutterwave-react-v3`, `useFlutterwave`, or any Flutterwave browser SDK. `POST /api/product-page/[slug]/pay` calls the Flutterwave REST API from the server and returns a hosted checkout `link`; the client sets `window.location.href` to it.

Consequences:

- **No Flutterwave public key exists in this project.** `FLUTTERWAVE_PUBLIC_KEY` is not set, not read, and not required. Do not add `NEXT_PUBLIC_FLUTTERWAVE_PUBLIC_KEY` or any client-side key.
- **The only `NEXT_PUBLIC_` variable in the payment path is `NEXT_PUBLIC_APP_URL`**, used to build the redirect URL.
- The buyer leaves the app for Flutterwave's hosted page and returns to `/checkout/confirm`. Fulfillment is decided server-side by the webhook or the cron — never by the browser.

If you are following an older version of this skill that describes a `useFlutterwave` modal, it is stale. Ignore it.

---

## Environment Variables

```
FLUTTERWAVE_SECRET_KEY     → server-side only. Creates subaccounts, charges, verifies, refunds.
FLUTTERWAVE_SECRET_HASH    → server-side only. Compared against the webhook verif-hash header.
NEXT_PUBLIC_APP_URL        → absolute origin used to build the payment redirect URL.
```

`FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_SECRET_HASH` must never appear in a Client Component or in any `NEXT_PUBLIC_` variable. See `.agent/rules/security.md` → *Secret Key Rules*.

---

## Payment Lifecycle

```
1. Buyer submits email on /p/[slug]
2. POST /api/product-page/[slug]/pay
   ├── product must exist AND be ACTIVE
   ├── seller must have flutterwaveSubaccountId
   ├── txRef = `SS-${nanoid(16)}`
   ├── Order created PENDING  ← the txRef must exist before the charge
   └── initializePayment() → hosted checkout link → returned to client
3. Client redirects to the hosted link
4. Buyer pays; Flutterwave redirects back to /checkout/confirm?tx_ref=...
5. Fulfillment decided server-side, by whichever of these runs first:
   ├── POST /api/webhooks/flutterwave  (primary)
   └── GET  /api/cron/resolve-pending   (reconciles PENDING older than 1 hour)
   Both call resolveOrderFromVerification() — they cannot disagree.
```

---

## The Provider Wrapper — `lib/flutterwave.ts`

All Flutterwave API calls go through this module. Never call the Flutterwave REST API directly from a route handler, and never read `process.env.FLUTTERWAVE_SECRET_KEY` outside it.

### Exported surface

| Export | Signature | Returns |
|---|---|---|
| `createSubaccount` | `(bankCode, accountNumber, businessName, businessEmail)` | `{ id: number, subaccount_id: string }` |
| `initializePayment` | `(txRef, amountNaira, customerEmail, customerName, redirectUrl, subaccountId?, meta?)` | `{ link: string }` |
| `verifyTransactionById` | `(transactionId: number)` | `TransactionVerification` — **throws** on anything unusable |
| `verifyTransactionByRef` | `(txRef: string)` | `TransactionVerification \| null` — `null` **only** for confirmed absence |
| `refundTransaction` | `(transactionId: number, amountNaira: number, reason: string)` | `RefundResult` — throws `below_minimum` under NGN 100 |
| `fetchRefundStatus` | `(refundId: number)` | `RefundStatusResult` — **read only**, never refunds |
| `parseTransactionVerification` | `(payload: unknown)` | `TransactionVerification \| null` |
| `VerificationError` | `class`, carries `kind` and `httpStatus` | — |

Types: `TransactionVerification`, `RefundResult`, `RefundStatusResult`, `VerificationFailureKind`.
Constants: `MINIMUM_REFUND_NAIRA` (100).

Note the argument orders are positional and differ from older versions of this skill. Read the real signatures in `lib/flutterwave.ts` before calling them.

```ts
export interface TransactionVerification {
  id: number        // Flutterwave's numeric transaction id
  status: string    // 'successful' | 'failed' | 'pending' | ...
  amount: number    // in NAIRA, as a decimal
  currency: string
  tx_ref: string    // the SellSnap transaction reference
}
```

### Failure classification — the most important design in this file

`VerificationFailureKind` exists so that "the payment never happened" can never be confused with "we could not find out":

| Kind | Cause | Meaning |
|---|---|---|
| `not_found` | Provider explicitly reports no such transaction | The payment never existed |
| `unauthorized` | `401`, `403`, or missing `FLUTTERWAVE_SECRET_KEY` | Configuration fault; retrying never helps |
| `unavailable` | `429`, any `5xx`, timeout, DNS, connection reset | The provider is not answering right now |
| `rejected` | Any other `4xx` | Our request was refused |
| `malformed` | `2xx` whose body is not a usable transaction | Unreadable, so unknowable |

**Only `not_found` is evidence that a payment never happened.** Every other kind means SellSnap does not currently know, and the order must stay `PENDING`. Never treat a thrown `VerificationError` as absence.

`providerGet()` enforces `PROVIDER_TIMEOUT_MS` (10s) via `AbortSignal.timeout`, converts transport failures into `unavailable` rather than letting a raw `TypeError` escape, and reads the secret key *before* the `try` so an unset key is reported as `unauthorized` instead of being misreported as `unavailable`.

`verifyTransactionByRef()` returns `null` — and only `null` — for a confirmed absence: a `404`, or a `400` whose message matches `/no transaction was found|transaction not found/i`. A `400` with any other message is `rejected`.

### Response shape validation

`json.data` is never cast straight to a transaction type. `parseTransactionVerification()` requires an object `data` containing a finite numeric `id`, a non-empty `status`, a finite numeric `amount`, a non-empty `currency`, and a non-empty `tx_ref`, and returns `null` for anything else. `verifyTransactionById` turns that `null` into a `malformed` throw; `verifyTransactionByRef` throws as well. A malformed body must never become a false success or a false failure.

`readProviderMessage()` surfaces only a truncated (200 char) provider `message`. Never log or return the raw error body or the `Authorization` header.

### Never log the error cause

`VerificationError` is constructed **without** a `cause`, because a cause can retain request headers including the bearer secret key. Keep it that way.

---

## Amount Rules — the single decision point

All payment-resolution paths call `resolveOrderFromVerification()` in `lib/payments.ts`. Do not re-implement the decision inside a route handler.

The authoritative amount is always `order.amountKobo`, captured from the product row when the order was created. Nothing the buyer or the webhook body supplies can change it.

Comparison happens in integer kobo through `assessPayment(paidNaira, requiredKobo)` in `lib/kobo.ts`. Never compare Naira decimals directly.

| Verification | Assessment | Outcome |
|---|---|---|
| `tx_ref` ≠ `order.transactionRef` | — | `REFERENCE_MISMATCH`, nothing written |
| `status === 'failed'` | — | `FAILED` |
| `status` is anything else (e.g. `pending`) | — | stays `PENDING` — bank transfer and USSD settle late |
| `status === 'successful'`, currency ≠ `NGN` | — | `FAILED` — SellSnap only ever charges NGN |
| `successful`, NGN | `UNDERPAID` | stays `PENDING`, **never** `SUCCESS` |
| `successful`, NGN | `PAID_IN_FULL` | `SUCCESS` |
| `successful`, NGN | `OVERPAID` | **not fulfilled** — `FAILED` + full reversal |

`PAID_IN_FULL` means *exactly* the price. **`amount >= expected` is forbidden** — it both fulfils an overpayment that must be reversed and relies on float comparison in Naira.

A non-`successful`, non-`failed` status must never be failed. Marking it `FAILED` would strand a paid order, because no later webhook or cron pass revisits a non-`PENDING` order.

### Compare-and-set writes

Every status write is a guarded `updateMany`, never an unguarded `update`:

```ts
const { count } = await prisma.order.updateMany({
  where: { id: order.id, status: 'PENDING' },
  data: { status: 'SUCCESS', flutterwaveTxId: verification.id },
})
if (count === 0) return 'SETTLEMENT_PENDING'   // lost the race; nothing written
```

This makes the webhook and the cron safe to run concurrently and repeatedly.

### Notification

Terminal outcomes call `notifyOrderResolution()`, which sends buyer and seller email through `sendOrderResolutionEmails()`. A mail failure is logged and swallowed — it must never fail the resolution. Orders are loaded with `ORDER_RESOLUTION_INCLUDE`, which deliberately excludes seller bank details.

---

## Payment Initiation — `POST /api/product-page/[slug]/pay`

Rate-limited to **10 requests per IP per hour** in `proxy.ts`.

Order of operations:

1. Look up the product by slug, including the seller's `flutterwaveSubaccountId`.
2. `404 NOT_FOUND` if no product, or if `product.status !== 'ACTIVE'`. The client hides its pay form for inactive products, but that is UX only — the server gate is authoritative.
3. `400 SUBACCOUNT_NOT_CONFIGURED` if the seller has no `flutterwaveSubaccountId`.
4. Validate and normalise the buyer's email. **The amount is never read from the request** — it is derived from `product.priceKobo`, so a tampered body cannot change what the buyer is charged.
5. `txRef = \`SS-${nanoid(16)}\``
6. Create the `Order` as `PENDING`, capturing `amountKobo` from the product row.
7. `initializePayment(...)` and return `{ paymentLink }`.

```ts
const txRef = `SS-${nanoid(16)}`
const amountNaira = koboToChargeableNaira(product.priceKobo)
const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
const redirectUrl = `${appUrl}/checkout/confirm?tx_ref=${txRef}`
```

Use `koboToChargeableNaira()`, which divides without rounding. Do not use `koboToNaira()`, which floors — flooring the charge while comparing against an unrounded expectation rejects orders the buyer actually paid for.

The client redirects to `paymentLink`; `/checkout/confirm` then polls `GET /api/checkout/status/[txRef]` and displays the result. That page is display-only and decides nothing.

---

## Webhook — `POST /api/webhooks/flutterwave`

Public but signature-verified. Must not call `auth()`.

1. Compare the `verif-hash` header to `FLUTTERWAVE_SECRET_HASH`; `401` on mismatch or absence.
2. Parse the body; `400` if `data.id` or `data.tx_ref` is missing.
3. Find the order by `transactionRef`. If it is missing or not `PENDING`, answer `200` — a `200` stops Flutterwave retrying, which is what we want for an already-resolved order.
4. `verifyTransactionById(transactionId)`.
5. `resolveOrderFromVerification(order, verification)`.
6. `REFERENCE_MISMATCH` answers `400`: redelivery would keep failing until the mismatch is resolved.
7. `SUCCESS`, `FAILED`, `OVERPAID`, and `SETTLEMENT_PENDING` are all valid handshakes → `200`.
8. Any thrown error → `500`, so Flutterwave redelivers and the order stays `PENDING`.

```ts
const hash = req.headers.get('verif-hash')
if (!hash || hash !== process.env.FLUTTERWAVE_SECRET_HASH) {
  return new Response(null, { status: 401 })
}
// ...
if (!order || order.status !== 'PENDING') {
  return new Response(null, { status: 200 })
}
const verification = await verifyTransactionById(transactionId)
const resolution = await resolveOrderFromVerification(order, verification)
if (resolution === 'REFERENCE_MISMATCH') {
  console.error(`[webhook] tx_ref mismatch for order ${order.id}`)
  return new Response(null, { status: 400 })
}
return new Response(null, { status: 200 })
```

Idempotency comes from the `status: 'PENDING'` filter plus the compare-and-set writes in `lib/payments.ts` — not from a hand-rolled "already SUCCESS" check.

---

## Subaccount Creation — `PATCH /api/seller/bank-account`

1. `auth()` the seller.
2. Require `bankCode` and `accountNumber`; the account number must match `/^\d{10}$/`.
3. If `FLUTTERWAVE_SECRET_KEY` is set, call `createSubaccount(trimmedCode, trimmedAccount, user.name, user.email)`.
4. Store `bankCode`, `accountNumber`, and `flutterwaveSubaccountId` on the `User` row.
5. Return `hasSubaccount: !!flutterwaveSubaccountId`.

A subaccount failure is currently caught and logged as a warning, and the bank details are stored anyway — the route degrades rather than failing, so the seller can still be shown as not-yet-configured. Do not treat that as licence to store partial subaccount data.

Store the id in **`User.flutterwaveSubaccountId`**. Earlier versions of this skill refer to `flwSubaccountId` / `flw_subaccount_id`; those names are wrong. The value returned by the provider is `subaccount_id` (a string) — the numeric `id` is also returned and is not what SellSnap stores.

A seller without `flutterwaveSubaccountId` cannot accept payments; the pay route rejects with `SUBACCOUNT_NOT_CONFIGURED`.

---

## PENDING Order Resolution (Cron) — `GET /api/cron/resolve-pending`

Vercel Cron invokes a cron path with **GET** and, when `CRON_SECRET` is set on the project, sends it as `Authorization: Bearer <CRON_SECRET>`. Do not read a custom `CRON_SECRET` header — Vercel never sends one, and the job would reject every invocation. See `vercel.json` for the hourly schedule.

This is also the abandoned-order sweep: an order whose payment was never completed has no transaction at Flutterwave, so verification returns `null` and the order is resolved `FAILED`. Orders are kept, never deleted — they are the seller's audit trail.

Key properties, all of which must be preserved:

- **Guard the cron** with `authHeader !== \`Bearer ${cronSecret}\``, returning `401`.
- **Cutoff** is 1 hour, not 30 minutes.
- **Deterministic batch:** `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]`. `createdAt` alone is not a total order, so `id` breaks ties and makes batch membership reproducible.
- **Bounded batch:** `take: 50`. Verification is one HTTP call per order, so an unbounded query could time out the invocation. It still drains, because processing moves settled orders out of `PENDING`.
- **Per-order `try/catch`:** one provider or SMTP failure must not abandon the rest of the batch. The order stays `PENDING` and its `VerificationError` kind is logged so an outage is distinguishable from a SellSnap bug.
- **`null` → `FAILED`,** via the same guarded `updateMany`. Anything else goes through `resolveOrderFromVerification()`.

```ts
const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
const staleOrders = await prisma.order.findMany({
  where: { status: 'PENDING', createdAt: { lt: oneHourAgo } },
  include: ORDER_RESOLUTION_INCLUDE,
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  take: 50,
})
```

Because the batch is bounded, a backlog larger than 50 needs successive runs. That is expected, not a failure.

---

## Refunds

**Seller-initiated refunds are out of V1 scope.** If asked to build a refund flow, decline — sellers process refunds manually via their Flutterwave dashboard.

**The one exception is the automatic overpayment reversal**, which is a payment-integrity control rather than a refund feature. Do not generalise it into a refund system.

When the provider confirms more than the authoritative price, the order is **not** fulfilled and the **entire confirmed amount** is returned:

1. **Claim, then act.** One compare-and-set flips `PENDING → FAILED`, stores `flutterwaveTxId`, and sets `refundStatus = 'REQUESTED'` with `where: { status: 'PENDING', refundStatus: null }`. `refundStatus: null` is the duplicate-refund guard — only the request that wins the update may call Flutterwave.
2. **Reverse the full amount.** `refundTransaction()` calls `POST /v3/transactions/{id}/refund` with the provider-confirmed amount in Naira. Never refund a partial or computed amount.
3. **Record the real outcome.** Refunds are asynchronous. `COMPLETED` is written only when Flutterwave confirms disbursement: `completed-bank-transfer`, `completed-momo`, `completed-mpgs`, `completed-offline`, `completed-preauth`. Flutterwave's plain `completed` means *initiated, pending disbursement* and is recorded as `REQUESTED`.
4. **Never fulfil on refund failure.** A failed refund sets `refundStatus = 'FAILED'`; the order stays `FAILED`.
5. **Reconcile outstanding reversals.** An overpaid order is already `FAILED`, so the stale-order sweep never revisits it. `reconcileRequestedRefunds()` in `lib/payments.ts` (run by `/api/cron/resolve-pending`) reads each `REQUESTED` refund via `GET /v3/refunds/{id}` and promotes it to `COMPLETED` or `FAILED` on provider-confirmed evidence. It only ever **reads** — never calls the refund endpoint — so overlapping runs cannot double-refund. A read that fails leaves the row `REQUESTED`; it is not evidence the refund failed. Flutterwave does not send refund webhooks unless the account has them enabled by their internal team, so this poll is the only mechanism available by default.
6. **Below the provider minimum, flag it.** Flutterwave refuses refunds under **NGN 100**, returning `400` with `"Amount should be above NGN100"`. `refundTransaction()` detects this before spending a request and throws `below_minimum`; `reverseOverpayment()` records `refundStatus = 'BELOW_MINIMUM'`. The buyer is still owed that money and it must be returned manually — never quietly absorbed.
7. **Email the overpayment honestly.** Overpayment uses its own `OVERPAID` email outcome with a `reversal.status` (`REVERSAL_SETTLED` / `REVERSAL_IN_PROGRESS` / `MANUAL_REQUIRED`). The ordinary failure email claims *"No payment was taken"* and invites a retry, which is false for an overpayment and risks a double payment. No variant may claim a refund completed unless Flutterwave confirmed disbursement.

The order status and the refund lifecycle are deliberately separate: an overpaid order is finished, but its refund can still be outstanding. Reuse the existing `RefundStatus` enum; do not add an order status for it.

---

## Field Names — Use These

Earlier versions of this skill used `txRef`, `flwRef`, `priceKobo` on the order, and a `prisma.payment` model. **There is no `Payment` model in this schema.** The correct names:

| Concept | Field |
|---|---|
| Order transaction reference | `Order.transactionRef` (unique) |
| Flutterwave transaction id | `Order.flutterwaveTxId` (`Int?`) |
| Amount billed | `Order.amountKobo` (`Int`, captured from the product) |
| Refund state | `Order.refundStatus` (`RefundStatus?`) |
| Refund handle | `Order.refundId` (`Int?`) |
| Seller's subaccount | `User.flutterwaveSubaccountId` |
| Status values | `PENDING`, `SUCCESS`, `FAILED` |
| API query param on the confirm page | `tx_ref` |

There is no separate payment record and no payment method column. Payment method is not persisted.

---

## Testing

- Use Flutterwave **test** keys in `.env.local`.
- To receive webhooks locally, expose the app with ngrok or a Vercel tunnel and set that URL under **Settings → Webhooks** in the Flutterwave dashboard.
- Flutterwave test card: `4187427415564246`, expiry `09/32`, CVV `828`.
- Provider-failure behaviour is covered by `tests/provider-verification.test.ts`; the amount decision by `tests/payment-security.test.ts`. Extend those rather than writing ad-hoc scripts.
- Run `npm run typecheck` and `npm test` before submitting.

---

## Common Mistakes

| Mistake | Correct approach |
|---|---|
| Trusting the webhook body's `status` | Call the verify API and trust only its response |
| Using `amount >= expected` | `assessPayment()` — exact match only; overpayment is reversed |
| Comparing Naira decimals | Convert to integer kobo first via `nairaToKobo()` |
| Flooring the charge with `koboToNaira()` | `koboToChargeableNaira()` — do not round |
| Re-implementing the amount check in a route | Call `resolveOrderFromVerification()` |
| Writing order status with `update()` | Guarded `updateMany` on `status: 'PENDING'` |
| Failing an order on a provider outage | Only `not_found` may fail it; everything else stays `PENDING` |
| Casting `(await res.json()).data as TransactionVerification` | `parseTransactionVerification()` |
| Treating a `VerificationError` as absence | Check `err.kind`; never string-match the message |
| Logging the error `cause` | It can retain the `Authorization` header |
| Using `flwRef`, `flwSubaccountId`, or `prisma.payment` | `flutterwaveTxId`, `flutterwaveSubaccountId`, no payment model |
| Adding a client-side Flutterwave modal or public key | Checkout is a server-side redirect; no browser SDK |
| Reading the amount from the pay request body | Derive from `product.priceKobo` |
| Creating the `Order` after the charge | Create it `PENDING` first — the `txRef` must exist |
| Reading `CRON_SECRET` from a custom header | `Authorization: Bearer <CRON_SECRET>` |
| Unbounded cron query | `take: 50` with `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]` |

---

## Checklist Before Submitting a Flutterwave Change

- [ ] No secret key in a Client Component or a `NEXT_PUBLIC_` variable
- [ ] No new Flutterwave public key or browser SDK introduced
- [ ] Webhook verifies the `verif-hash` header
- [ ] Verification goes through `verifyTransactionById` / `verifyTransactionByRef`, never the payload
- [ ] Provider response passes `parseTransactionVerification()` before any field is read
- [ ] The amount decision goes through `resolveOrderFromVerification()` / `assessPayment()`
- [ ] No `amount >= expected` anywhere; overpayment is reversed, not fulfilled
- [ ] Status writes are guarded `updateMany` calls, not `update()`
- [ ] A thrown `VerificationError` leaves the order `PENDING`
- [ ] Order creation (`PENDING`) still precedes payment initiation
- [ ] Cron guard, 1-hour cutoff, deterministic order, and `take: 50` preserved
- [ ] Per-order `try/catch` in the cron loop
- [ ] `npm run typecheck` and `npm test` pass
