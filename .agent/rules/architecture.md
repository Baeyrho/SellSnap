---
trigger: always_on
---

# architecture.md

> Folder structure, routing conventions, and data access rules for SellSnap.

---

## Folder Structure

```
sellsnap/
├── app/
│   ├── layout.tsx                  # root layout — fonts, tokens.css
│   ├── page.tsx                    # landing page
│   ├── auth/
│   │   └── page.tsx                # single auth page — AuthCard renders login/signup/forgot/reset via ?view=
│   ├── (dashboard)/
│   │   ├── layout.tsx              # auth guard for the whole group — redirects to /auth
│   │   ├── dashboard/              # ← the real dashboard routes live here
│   │   │   ├── layout.tsx          # renders DashboardShell (header + sidebar)
│   │   │   ├── page.tsx            # overview
│   │   │   ├── products/
│   │   │   │   ├── page.tsx        # product list
│   │   │   │   ├── new/page.tsx    # create product
│   │   │   │   └── [id]/page.tsx   # edit product
│   │   │   ├── orders/page.tsx     # order history
│   │   │   ├── settings/
│   │   │   │   ├── page.tsx        # settings index — list of sub-pages
│   │   │   │   ├── [section]/page.tsx  # one settings sub-page per route segment
│   │   │   │   └── settings-data.ts   # shared seller read for both settings routes
│   │   │   └── profile/page.tsx    # legacy → redirects to /dashboard/settings
│   │   ├── products/page.tsx       # legacy → redirects to /dashboard/products
│   │   ├── products/new/page.tsx   # legacy → redirects to /dashboard/products/new
│   │   ├── orders/page.tsx         # legacy → redirects to /dashboard/orders
│   │   └── profile/page.tsx        # legacy → redirects to /dashboard/settings
│   ├── p/
│   │   └── [slug]/page.tsx         # public product page — no auth required
│   ├── checkout/
│   │   └── confirm/page.tsx        # post-payment status polling
│   └── api/
│       ├── auth/
│       │   ├── [...nextauth]/route.ts
│       │   ├── register/route.ts
│       │   └── reset-password/
│       │       ├── request/route.ts
│       │       └── confirm/route.ts
│       ├── seller/
│       │   ├── profile/route.ts
│       │   ├── profile/logo/route.ts
│       │   ├── bank-account/route.ts
│       │   └── security/password/route.ts
│       ├── products/
│       │   ├── route.ts            # GET (list), POST (create, multipart)
│       │   └── [id]/route.ts       # GET, PATCH, DELETE (soft)
│       ├── product-page/
│       │   └── [slug]/
│       │       ├── route.ts        # GET product data (public)
│       │       └── pay/route.ts    # POST initiate payment (public, rate-limited)
│       ├── checkout/
│       │   └── status/[txRef]/route.ts   # GET order status polling (public)
│       ├── orders/
│       │   ├── route.ts
│       │   └── [id]/route.ts
│       ├── webhooks/flutterwave/route.ts
│       └── cron/
│           ├── resolve-pending/route.ts
│           └── operations/route.ts
├── components/
│   ├── ui/                         # Button, Input, Badge, Skeleton
│   ├── layout/                     # DashboardShell, DashboardHeader, DashboardSidebar, PageShell
│   ├── auth/                       # AuthCard
│   ├── landing/                    # LandingNav, HeroSection, FeatureGrid, StepFlow,
│   │                               # EarningsCalculator, FaqSection, CtaBanner, LandingFooter
│   ├── product/                    # ProductCard, ProductForm, ProductPage, ProductsView
│   ├── order/                      # OrderTable
│   └── profile/                    # ProfileView, ProfileSectionNav, ProfileInfoForm,
│                                   # AccountInfoForm, ProfileSecurity, ProfileNotifications
├── lib/
│   ├── prisma.ts                   # Prisma singleton (PrismaPg adapter + pg Pool)
│   ├── auth.ts                     # NextAuth v5 config; exports auth, handlers, signIn, signOut
│   ├── api.ts                      # successResponse / errorResponse envelope helpers
│   ├── payments.ts                 # resolveOrderFromVerification — the single payment state machine
│   ├── operations.ts               # operations report — late payments, reversals, stale orders
│   ├── flutterwave.ts              # Flutterwave API wrapper + VerificationError classification
│   ├── kobo.ts                     # currency conversion + assessPayment amount decision
│   ├── email.ts                    # nodemailer SMTP wrapper
│   ├── blob.ts                     # Vercel Blob upload + magic-byte-derived type/extension
│   ├── logger.ts                   # structured JSON logging
│   ├── validation.ts               # isValidEmail + the shared password policy
│   ├── secure-compare.ts           # constant-time comparison for shared secrets
│   ├── rate-limit.ts               # in-memory fixed-window limiter (Edge + Node)
│   ├── env.ts                      # boot-time required-env validation
│   ├── auth-views.ts               # ?view= aliases → AuthView + page title
│   ├── password-reset-token.ts     # hashResetToken (SHA-256)
│   └── nanoid.ts                   # generateSlug
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts
│   └── migrations/
├── tokens/
│   └── tokens.css                 # CSS custom properties and resets
├── types/
│   ├── index.ts                   # shared API types
│   └── next-auth.d.ts             # session user id augmentation
├── tests/
│   ├── payment-flow.integration.test.ts
│   ├── payment-security.test.ts
│   ├── provider-verification.test.ts
│   ├── refund-reconciliation.test.ts
│   ├── product-multi-image.test.ts
│   └── security-hardening.test.ts
├── proxy.ts                       # rate limiting (Next 16 proxy; formerly middleware)
├── instrumentation.ts             # boot-time config validation (assertRequiredEnv)
├── prisma.config.ts               # Prisma 7 config: schema path, migrations, seed, datasource URL
├── vercel.json                    # hourly cron schedule
└── .agent/
    ├── rules/                     # always-on technical rules
    └── skills/                    # task-specific playbooks
```

There is **no** `app/api/orders/export/` route. CSV export is out of V1 scope.

---

## Routing Rules

- **App Router only.** No Pages Router.
- **`/auth`** is the single auth entry point. `components/auth/AuthCard/AuthCard.tsx` renders all auth forms (login, signup, forgot-password, reset-password) driven by the `?view=` search param (`login | signup | forgot-password | reset-password`). Tabs toggle login/signup; the "Forgot password?" and reset links set `view`. The password-reset email links to `/auth?view=reset-password&token=...`.
- **`(dashboard)/layout.tsx`** is the auth guard for the route group. It calls `auth()` and `redirect('/auth')` when there is no session. It renders no UI of its own.
- **`(dashboard)/dashboard/layout.tsx`** renders the `DashboardShell` (header + sidebar) and resolves the seller's display name and email. It sits *inside* the guard.
- **Legacy dashboard paths** — `(dashboard)/products`, `(dashboard)/products/new`, `(dashboard)/orders`, `(dashboard)/profile` — are one-line `redirect()` stubs to their `/dashboard/*` equivalents. Add new pages under `(dashboard)/dashboard/`, not at the group root.
- **`/dashboard/settings`** is the Settings index and renders only the list of sub-pages (`ProfileSectionNav` — plain rows with a hairline divider, never cards). Each sub-page has its own route, `/dashboard/settings/[section]`, where `section` is one of the keys in `components/profile/profileSections.ts` (`business | account | payout | notifications | security`); unknown values `notFound()`. A sub-page renders only its own section plus the `PageShell` back control to the index — it must not repeat the section list. `ProfileView` receives the `section` and conditionally renders exactly one sub-page; there is no client-side tab state and no hash-based deep linking. `/dashboard/profile` and `(dashboard)/profile` are redirect stubs to `/dashboard/settings`.
- **`/p/[slug]`** is fully public. It must not call `auth()` — product pages must load for unauthenticated buyers.
- **`/api/webhooks/flutterwave`** is public but signature-verified via the `verif-hash` header. It must not call `auth()`.
- **`/api/cron/resolve-pending`** is protected by the `CRON_SECRET` bearer token (`Authorization: Bearer <CRON_SECRET>`), not a session. Vercel Cron invokes it with `GET`.
- **Auth reads use `auth()`**, exported from `lib/auth`. This is NextAuth v5 — there is no `authOptions` export and `getServerSession` is not used anywhere in this project.

---

## Data Access Rules

- **All database reads and writes go through `lib/prisma.ts`.** No Prisma Client instantiation elsewhere.
- **Prisma 7 requires the driver adapter.** `lib/prisma.ts` constructs a `pg` `Pool` and wraps it in `PrismaPg`:

```ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter, log: ['error'] })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

The global cache avoids exhausting connections during development hot-reload. The `globalThis as unknown as { prisma: PrismaClient }` cast is the **only** permitted `as unknown as` in the codebase (`.agent/rules/code-style.md`).

- **The datasource URL is not in `schema.prisma`.** It comes from `prisma.config.ts` via `env("DATABASE_URL")`. Do not add `url` to the schema's `datasource` block.
- **Raw SQL in application code is forbidden.** If `$queryRaw` is truly necessary, add a comment explaining why and get a code review.
- **Migration files** in `prisma/migrations/` may contain raw SQL — that is their purpose.
- **Order is the payment record.** There is no `Payment` model. See `.agent/skills/flutterwave-integration/SKILL.md`.
- **Schema conventions** — `uuid()` ids, PascalCase tables with no `@@map`, `Int` kobo for money — are documented in `.agent/skills/db-migration-runner/SKILL.md`.

---

## API Route Conventions

- Every route file exports only named HTTP method handlers: `GET`, `POST`, `PATCH`, `DELETE`.
- Every JSON response uses the standard envelope via `successResponse` / `errorResponse` imported from `@/lib/api`. Do not hand-roll response shapes.
- Authenticated routes call `await auth()` at the top, before any other logic, and return `401 UNAUTHENTICATED` when `session.user.id` is missing.
- Ownership is checked on every product and order read/write — compare `resource.sellerId` against `session.user.id`.
- **This is Next.js 16, so `params` and `searchParams` are Promises and must be awaited** (`const { id } = await params`; `const { q } = await searchParams`). Sync access was removed in 16. Applies to pages, layouts, route handlers, and `generateMetadata`. See `.agent/skills/api-route-scaffolder/SKILL.md`.
- Deletes are soft: `status: 'DELETED'` plus `deletedAt`.

---

## Component Conventions

- Every component lives in its own folder: `ComponentName/ComponentName.tsx` + `ComponentName.module.css`.
- **Server Components by default.** Add `'use client'` only when the component needs `useState`, `useEffect`, `usePathname`, event handlers, or browser APIs.
- A `'use client'` boundary is not inherited implicitly by anything a Client Component renders unless that child is itself imported into a client graph. Any component using hooks or handlers needs its own `'use client'`, even if its only importer is a Client Component.
- Props are typed with an explicit `interface` defined in the same file, above the component.
- No default exports from `lib/` files. Named exports only.

---

## Module Aliases

`tsconfig.json` defines a single catch-all mapping:

```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

So `@/lib/prisma`, `@/components/...`, `@/types`, and `@/tokens/tokens.css` all resolve. Use `@/` aliases for internal imports. No relative `../../../` chains.

The one exception is `prisma/seed.ts`, which runs outside the Next.js build and therefore cannot use the alias — it imports `../lib/prisma` relatively.

---

## Dependencies

`package.json` carries one deliberate override:

```json
"overrides": { "nodemailer": "^10.0.15" }
```

`next-auth` → `@auth/core` declares an **optional** peer of `nodemailer: "^7.0.7 || ^8.0.5"`, which caps resolution below the versions that fix the SMTP command-injection advisories. SellSnap only ever calls `createTransport({ host, port, secure, requireTLS, auth })` and `sendMail({ from, to, subject, text, html })` from `lib/email.ts`, and never configures `@auth/core`'s nodemailer email provider — auth is Credentials-only — so the wider range is safe here. Without the override npm hits `ERESOLVE` on operations other than a plain install.

**Do not remove the override to satisfy the declared peer range.** The correct fix is an upstream `@auth/core` peer bump. `@types/nodemailer` was dropped at the same time: nodemailer 10 ships its own types.

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (flat config, `eslint .`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | `node --import tsx --test tests/*.test.ts` |
| `npm run postinstall` | `prisma generate` |

Run `typecheck` and `test` before submitting any change.
