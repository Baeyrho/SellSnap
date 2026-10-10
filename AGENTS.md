# AGENTS.md — SellSnap

> This file is read by the AI agent before every task. It defines the project, the rules, and how the agent must behave. Do not skip it.

---

## What is SellSnap

SellSnap is a free, link-based commerce platform for Nigerian social sellers. Sellers upload a product (image, name, price, optional description) and receive a unique product page link. Buyers open the link, view the product, and pay. Flutterwave routes payment directly into the seller's bank account via Subaccounts.

**This is an MVP.** Do not add features not defined in the PRD. Do not over-engineer.

---

## Project Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript — strict mode, no exceptions |
| Database | PostgreSQL |
| ORM | Prisma — all DB access goes through Prisma Client |
| Payment | Flutterwave (Subaccounts) |
| Auth | NextAuth.js v5 (Credentials provider, JWT strategy) |
| Styling | CSS Modules + CSS custom properties |
| Image storage | Vercel Blob |
| Email | SMTP (nodemailer) — provider via env vars |
| Hosting | Vercel |

---

## Rules

All agent rules live in `.agent/rules/`. The agent must load and apply all of them before writing any code.

| File | Covers |
|---|---|
| `.agent/rules/architecture.md` | Folder structure, routing conventions, data access rules |
| `.agent/rules/code-style.md` | TypeScript, naming, imports, formatting |
| `.agent/rules/design-system.md` | CSS custom properties, CSS Modules, component layout |
| `.agent/rules/security.md` | Auth, payment verification, input validation, secrets |

---

## Skills

Skills provide step-by-step instructions for repeatable tasks. Use the matching skill before starting any of the tasks below.

| Task | Skill |
|---|---|
| Flutterwave payment flow or webhook | `.agent/skills/flutterwave-integration/SKILL.md` |
| Building a UI component | `.agent/skills/component-builder/SKILL.md` |
| Adding an API route | `.agent/skills/api-route-scaffolder/SKILL.md` |
| Adding or editing a database model | `.agent/skills/db-migration-runner/SKILL.md` |

---

## Non-Negotiable Constraints

These apply to every task. No exceptions.

1. **TypeScript strict mode is on.** No `any`. No `// @ts-ignore`. No `as unknown as X` (except for the Prisma singleton in `lib/prisma.ts`).
2. **All database access goes through Prisma Client.** Raw SQL in application code is forbidden. `$queryRaw` requires explicit justification in a code comment.
3. **Flutterwave webhook verification is three-step.** (1) Verify `verif-hash` header. (2) Call Flutterwave's `/v3/transactions/:id/verify` endpoint and shape-check the response. (3) Verify the amount against `order.amountKobo` and confirm `currency === 'NGN'`. Order status is never updated from browser input alone.
4. **The amount comparison is exact, in integer kobo.** Call `assessPayment()` from `lib/kobo.ts` — never compare Naira decimals, and never treat "paid at least the price" as success. Paid **exactly** → fulfilled. Paid **less** → stays `PENDING`, never fulfilled. Paid **more** → not fulfilled, full reversal.
5. **All order status writes go through `resolveOrderFromVerification()` in `lib/payments.ts`,** using a guarded `updateMany` on `status: 'PENDING'`. The webhook and the cron must not be able to disagree, and neither may mark an order paid on a provider fault. Only a positively confirmed "no such transaction" may fail an order.
6. **Refunds are asynchronous and are reconciled by polling.** A refund request is not a refund. `refundStatus` becomes `COMPLETED` only on provider-confirmed disbursement — Flutterwave's plain `completed` means *initiated, pending disbursement* and stays `REQUESTED`. `reconcileRequestedRefunds()` reads `GET /v3/refunds/{id}` from the cron; it must only ever **read**, never re-issue a refund, and a failed read must leave the row `REQUESTED` rather than writing it off.
7. **An overpayment below the provider minimum is flagged, never absorbed.** Flutterwave refuses refunds under NGN 100. `refundTransaction()` throws `below_minimum` and the order is recorded as `refundStatus = 'BELOW_MINIMUM'`, which is a queue for manual return via the Flutterwave dashboard. The buyer is still owed that money.
8. **Overpayment emails must not reuse the payment-failure wording.** That copy claims no money was taken and invites a retry, which is false for an overpayment and risks a double payment. Use the `OVERPAID` outcome with the real `reversal.status`.
9. **`FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_SECRET_HASH` are server-side only.** They must never appear in any file prefixed `NEXT_PUBLIC_` or be imported in a Client Component.
10. **CSS is written in CSS Modules.** No inline styles. No Tailwind. No styled-components.
11. **Mobile-first layout.** Base styles at 375px. Desktop styles in `@media (min-width: 768px)`.
12. **All monetary amounts are integers in kobo.** ₦12,500 = `1250000`. Never use floats for money.
13. **Product links lead to a product page, not a bare payment URL.** The buyer views the product before paying.
14. **Checkout is a server-side redirect.** There is no Flutterwave public key and no browser payment SDK. `NEXT_PUBLIC_APP_URL` is the only `NEXT_PUBLIC_` variable in use.
15. **A confirmed payment for an already-closed order is recorded, never dropped.** A bank transfer can land after the abandoned-order sweep has failed the order. `isLatePaymentCandidate()` then `markLatePaymentDetected()` set `latePaymentDetectedAt` under a guarded write. It must **not** fulfil the order and must **not** auto-refund — both are deliberate non-actions awaiting a human. Eligibility is `status === 'FAILED'` **and** `flutterwaveTxId === null`: the second condition is what keeps ordinary webhook redeliveries and already-reversed overpayments out of the queue. See `docs/OPERATIONS.md`.
16. **The reconciliation cron must never fail silently.** Every outcome is logged as structured JSON through `lib/logger.ts` with a stable `event` key, and anything needing a human triggers `sendOperationalAlertEmail()`. An alert failure must never fail the run.
17. **Operational data is served only from the `CRON_SECRET` boundary.** `app/api/cron/operations/route.ts` is read-only and must fail closed when the secret is unset. There is no admin role; do not add one, and do not expose refund or reversal detail through the seller dashboard.
18. **Email is never authoritative.** A mail failure must never change a resolved order's fate, and it must never be silent — `sendEmail()` logs when no relay is configured and logs the order id on a failed send.

---

## Environment Variables

Defined in `.env.local` (local) and Vercel dashboard (production). Never hard-code secrets.

```
DATABASE_URL
NEXTAUTH_SECRET
NEXTAUTH_URL
FLUTTERWAVE_SECRET_KEY
FLUTTERWAVE_SECRET_HASH
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASS
SMTP_FROM
OPS_ALERT_EMAIL
BLOB_READ_WRITE_TOKEN
NEXT_PUBLIC_APP_URL
CRON_SECRET
```

There is no `FLUTTERWAVE_PUBLIC_KEY`. Checkout is a server-side redirect to Flutterwave's hosted page, so no public key and no browser SDK are involved. `NEXT_PUBLIC_APP_URL` is the only `NEXT_PUBLIC_` variable in use.

`MOCK_MODE` and `FLUTTERWAVE_PUBLIC_KEY` are **intentionally unused** — no code reads them, they are not part of the supported configuration, and no behaviour should be added behind them. See `.env.example` → *Intentionally unused*. `NEXT_PUBLIC_APP_URL` is validated at boot by `instrumentation.ts`; in production it must be set and use `https` or the server refuses to start.

`CRON_SECRET` guards both the scheduled job and the read-only operations report. `OPS_ALERT_EMAIL` receives late-payment, failed-reversal and cron-failure alerts; it falls back to `SMTP_FROM`.

The Prisma CLI reads `.env` (via `prisma.config.ts`); the Next.js app reads `.env.local`. Keep `DATABASE_URL` present in both.

---

## Out of Scope for V1

Do not build these. If asked, refuse and state they are out of V1 scope.

- Cart or multi-product checkout
- WhatsApp Business API notifications
- Real-time WebSocket order updates
- Seller-initiated refund flow (manual via Flutterwave dashboard only)

  The single exception is the **automatic overpayment reversal**, which is a payment-integrity requirement rather than a refund feature: if the provider confirms more than the authoritative price, the order is not fulfilled and the full confirmed amount is returned. See `.agent/rules/security.md` → *Overpayment — Mandatory Full Reversal*. Do not generalise it into a refund system.
- CSV export
- OAuth (Google, etc.)

---

## When in Doubt

Read the PRD. The PRD is the source of truth for product decisions. The rules in `.agent/rules/` are the source of truth for technical decisions.

> **Note:** no PRD file is checked into this repository. For product-scope questions, ask the project owner rather than inferring intent from the code.
