# SellSnap

A free, link-based commerce platform for Nigerian social sellers. A seller uploads a product, gets a unique product page link, and shares it. A buyer opens the link, views the product, and pays — Flutterwave routes the money straight into the seller's bank account through subaccounts. SellSnap holds no float and takes no platform fee.

**This is an MVP.** Cart, multi-product checkout, seller-initiated refunds, CSV export, and OAuth are deliberately out of scope.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript, strict mode |
| Database | PostgreSQL via Prisma 7 (`@prisma/adapter-pg` + `pg` pool) |
| ORM | Prisma — all DB access goes through `@/lib/prisma` |
| Auth | NextAuth.js v5, Credentials provider, JWT sessions |
| Payments | Flutterwave subaccounts (0% platform split) |
| Image storage | Vercel Blob, with a local `public/uploads` fallback |
| Email | SMTP via nodemailer — skipped entirely when `SMTP_HOST` is unset |
| Styling | CSS Modules + custom properties from `tokens/tokens.css` |
| Hosting | Vercel |

## Getting Started

Requires **Node.js 20.19+** and a PostgreSQL database.

```bash
npm install
cp .env.example .env.local     # and put DATABASE_URL in .env as well
npx prisma migrate dev         # apply migrations + generate Prisma Client
npm run dev
```

See [SETUP.md](./SETUP.md) for the environment-file split, seeding, Flutterwave test keys, and troubleshooting.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (flat config, `eslint .`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Unit tests — `node --test` via `tsx` |
| `npm run postinstall` | `prisma generate` |

## How a Payment Works

```
buyer submits email on /p/[slug]
  → POST /api/product-page/[slug]/pay   creates Order(PENDING), gets a hosted checkout link
  → buyer pays on Flutterwave's page, returns to /checkout/confirm
  → fulfillment decided server-side, never by the browser:
      POST /api/webhooks/flutterwave    (primary)
      GET  /api/cron/resolve-pending     (hourly reconciliation, Vercel Cron)
    both call resolveOrderFromVerification() in lib/payments.ts
```

Amount rules are strict, and deliberately asymmetric:

- Paid **exactly** the price → `SUCCESS`
- Paid **less** → stays `PENDING`, never fulfilled
- Paid **more** → **not fulfilled**; the full confirmed amount is reversed automatically

The authoritative amount is `order.amountKobo`, captured from the product row when the order was created. Nothing the buyer or the provider's webhook body supplies can change it. Comparison happens in integer kobo via `assessPayment()`, never on Naira decimals.

A payment is only ever failed when Flutterwave *positively confirms* no transaction exists. Provider outages, rejected keys, timeouts, and unreadable responses all leave the order `PENDING` — a payment that may well have succeeded is never destroyed by a transient fault.

### When the buyer pays too late

A bank transfer or USSD payment can land *after* the hourly sweep has already failed the order. The money reaches the seller's account but nothing is fulfilled, so the webhook records it as `latePaymentDetectedAt` instead of dropping the event.

SellSnap does not fulfil or refund it automatically — the item may be sold, and returning money is a business decision. It shows up in the operations report for a person to decide:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/operations
```

The same report lists reversals Flutterwave could not complete on its own — including amounts under its ₦100 minimum refund floor, which no API call can return and must be refunded from the dashboard. Full procedures in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Routes

| Path | Purpose |
|---|---|
| `/` | Landing page |
| `/auth?view=` | Single auth page — login, signup, forgot, reset |
| `/dashboard` | Seller overview |
| `/dashboard/products`, `/orders`, `/profile` | Seller management |
| `/p/[slug]` | Public product page — no auth |
| `/checkout/confirm` | Post-payment status polling |
| `/api/cron/resolve-pending` | Hourly sweep + refund reconciliation — `CRON_SECRET` |
| `/api/cron/operations` | Read-only report of anything needing a human — `CRON_SECRET` |

## Project Layout

```
app/          routes, layouts, API handlers
components/   one folder per component: Name/Name.tsx + Name.module.css
lib/          prisma, auth, api, payments, flutterwave, kobo, email, logger, operations, blob, validation
prisma/       schema.prisma, migrations, seed
docs/         OPERATIONS.md — the money-path runbook
tokens/       tokens.css — the design-token source of truth
tests/        payment-security, provider-verification, refund-reconciliation, payment-flow
.agent/       rules (always on) and skills (task playbooks)
```

## Contributing

`AGENTS.md` defines the workflow. `.agent/rules/` holds the always-on technical rules — architecture, code style, design system, and security — and `.agent/skills/` holds task-specific playbooks for Flutterwave work, UI components, API routes, and database migrations.

Run `npm run typecheck`, `npm test`, and `npm run lint` before submitting a change.