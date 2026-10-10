# SellSnap Setup Guide

## Prerequisites

- Node.js **20.19 or newer** — `package.json` sets `engines.node: ">=20.19.0"`, and Prisma 7 requires it. The app will not run reliably on Node 18.
- PostgreSQL installed and running, or a hosted PostgreSQL provider.
- Copy `.env.example` to `.env.local` and fill in the values.

## Environment Files

Two files are needed, and they are read by different processes:

| File | Read by | Contents |
|---|---|---|
| `.env.local` | The Next.js app (`next dev` / `next build`) | Everything the running app needs |
| `.env` | The Prisma CLI, via the `dotenv/config` import in `prisma.config.ts` | At minimum `DATABASE_URL` |

`DATABASE_URL` must be present in **both**. This is the single most common cause of "migrations work but the app cannot reach the database", or the reverse.

Both files are git-ignored. Never commit real values.

## Database Setup

### Option 1 — Local PostgreSQL

1. Install PostgreSQL if you have not already.
2. Create a database:
   ```bash
   createdb sellsnap
   ```
3. Set `DATABASE_URL` in both `.env.local` and `.env`:
   ```
   DATABASE_URL="postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/sellsnap?schema=public"
   ```

### Option 2 — Hosted PostgreSQL

Neon, Supabase, Vercel Postgres, or any other provider. Use the connection string they give you in both files.

## Initialize the Database

This project ships real migrations, so use them rather than `db push` — `db push` would create tables from the schema without recording them, leaving the migration history out of sync.

```bash
# Apply migrations to the development database and generate Prisma Client
npx prisma migrate dev

# Confirm what is applied
npx prisma migrate status
```

`prisma generate` runs automatically after `migrate dev`. Run it on its own only if you need to regenerate the client without touching the database.

### Seed development data (optional)

```bash
npx prisma db seed
```

This runs `tsx prisma/seed.ts` — the command is registered in `prisma.config.ts`, not in `package.json`. It creates seller accounts with known passwords for local testing. Do not run it against a production database.

### Applying migrations to production

**Never run `prisma migrate dev` in production.** It can prompt to reset the database.

```bash
# 1. Confirm what is pending — read-only, safe at any time.
npx prisma migrate status

# 2. Take a backup and confirm it restores.

# 3. Apply. Additive only; never edit an already-applied migration file.
npx prisma migrate deploy
```

All migrations in this repository are additive — new columns, new enum values, new indexes. None
rewrite or drop existing data.

If `migrate status` reports drift, stop and investigate rather than force-resolving it. Full
procedure in [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Run the App

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`.

## Verifying the Setup

```bash
npm run typecheck   # tsc --noEmit
npm test            # node --test via tsx
npm run lint        # eslint .
```

`npm test` runs the payment-security, provider-verification, refund-reconciliation and payment-flow suites. They need no database and no network — Prisma is an in-memory fake and `fetch` is stubbed — so they are the fastest way to confirm the install is sound. The payment-flow suite exercises the real webhook, cron and operations routes and needs `--experimental-test-module-mocks`, which the `test` script already passes.

## Payments in Local Development

Payments require Flutterwave **test** keys in `.env.local`:

```
FLUTTERWAVE_SECRET_KEY=FLWTESTK_TEST-...
FLUTTERWAVE_SECRET_HASH=...
```

- Test card: `4187427415564246`, expiry `09/32`, CVV `828`.
- Checkout runs on Flutterwave's hosted page, so the app must be reachable from the internet to complete a payment. Expose it with ngrok or a Vercel tunnel, then set that URL under **Settings → Webhooks** in the Flutterwave dashboard.
- If `FLUTTERWAVE_SECRET_KEY` is unset, sellers can still save bank details — `PATCH /api/seller/bank-account` logs the subaccount failure and stores the details anyway — but `POST /api/product-page/[slug]/pay` will reject with `SUBACCOUNT_NOT_CONFIGURED`.
- Transactional email is skipped entirely when `SMTP_HOST` is unset. Payment resolution is unaffected: mail failures are logged, never propagated to the order outcome. It is not silent though — check for `email.smtp_not_configured` in the logs.

## Cron and Operations

One scheduled job runs hourly (`vercel.json`), guarded by `CRON_SECRET`:

```bash
# Stale-order sweep plus refund reconciliation
curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/resolve-pending

# Read-only report of anything waiting on a human
curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/operations
```

`/api/cron/operations` is how you find late payments and reversals that need returning by hand —
Flutterwave's dashboard is only the place to act on them, not a place to find them. Add `?alert=1`
to email yourself the summary.

Two things to check before relying on the schedule: **Vercel's Hobby plan runs crons once a day**,
not hourly, and `CRON_SECRET` must be set on the Vercel project or every invocation returns 401.

Procedures: [`docs/OPERATIONS.md`](docs/OPERATIONS.md).

### No mock mode

There is no mock or demo mode in this project. Without a working database you can still run the app to view the landing page and auth UI; anything that queries data fails with a plain "Database is not available" message.

## Image Uploads

Without `BLOB_READ_WRITE_TOKEN`, uploaded images are written to `public/uploads` and are **lost on every redeploy**. Set the token for anything beyond local development.

## Troubleshooting

### "Can't reach database server"

- Ensure PostgreSQL is running.
- Check `DATABASE_URL` in **both** `.env.local` and `.env`.
- Verify the database exists: `psql -U your_user -d sellsnap`.
- If migrations fail but the app runs, you are probably missing `DATABASE_URL` in `.env` — the Prisma CLI does not read `.env.local`.

### Orders stay PENDING

Payment resolution depends on the webhook. Locally, Flutterwave cannot reach `localhost`, so nothing confirms the payment. Run `GET /api/cron/resolve-pending` with `Authorization: Bearer <CRON_SECRET>` to reconcile manually, or expose the app with a tunnel.

This is the intended fail-safe behaviour: an unverifiable payment stays `PENDING` rather than being failed.

### Registration fails silently

- Open DevTools → Network, submit the form, and inspect the `POST /api/auth/register` response.
- A `503 DATABASE_UNAVAILABLE` means Prisma could not reach the database — see the first troubleshooting entry.
- Check the server console for the underlying error.