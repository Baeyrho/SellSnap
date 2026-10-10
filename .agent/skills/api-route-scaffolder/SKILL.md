# SKILL — API Route Scaffolder

> Use this skill before creating or changing any API route handler in SellSnap. It covers authenticated routes, public routes, cron routes, validation, error handling, and file uploads.

---

## Before You Start

1. Read `.agent/rules/architecture.md` — folder structure, routing conventions, data access rules.
2. Read `.agent/rules/security.md` — auth checks, ownership verification, input validation rules.
3. Read `.agent/rules/code-style.md` — response helper, TypeScript rules.
4. If building a payment route, also read `.agent/skills/flutterwave-integration/SKILL.md`.

---

## File Location

All API routes live under `app/api/` using Next.js App Router Route Handlers.

```
app/api/
└── [resource]/
    ├── route.ts          ← GET (list), POST (create)
    └── [id]/
        └── route.ts      ← GET (single), PATCH (update), DELETE (soft delete)
```

Each route file exports only named HTTP method handlers: `GET`, `POST`, `PATCH`, `DELETE`.

---

## Steps to Create a New Route

1. **Identify the route path** — check `architecture.md` for the canonical folder location.
2. **Determine auth requirements** — authenticated (seller), public (buyer), or cron (secret bearer token).
3. **Create the file** — `app/api/[resource]/route.ts` or `app/api/[resource]/[id]/route.ts`.
4. **Add imports** — follow the order in `code-style.md`.
5. **Write the handler** — auth check → parse input → validate → business logic → response.
6. **Wrap Prisma and external calls in `try/catch`** — log with context, return a generic `500`.
7. **Run the checklist** at the bottom of this file.

---

## Standard Response Envelope

**Import the helpers from `@/lib/api`. Never redefine them locally in a route file.**

```ts
// lib/api.ts
import { NextResponse } from 'next/server'

export function errorResponse(
  status: number,
  code: string,
  message: string,
  field?: string
): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message, ...(field ? { field } : {}) } },
    { status }
  )
}

export function successResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status })
}
```

Shapes:

```ts
{ success: true, data: { ... } }
{ success: false, error: { code: string, message: string, field?: string } }
```

Messages are plain English — no technical jargon, no provider or database detail leaked to the client.

### Error codes in use

Match these rather than inventing new ones for an equivalent condition:

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Invalid input. Include `field` for field-level errors. |
| 400 | `MISSING_FIELDS` | Required fields absent from a bank-account update |
| 400 | `INVALID_ACCOUNT` | Nigerian account number is not exactly 10 digits |
| 400 | `SUBACCOUNT_NOT_CONFIGURED` | Seller has no `flutterwaveSubaccountId`, so cannot be paid |
| 400 | `EXPIRED_TOKEN` | Password reset token past `expiresAt` |
| 401 | `UNAUTHENTICATED` | No valid session |
| 403 | `FORBIDDEN` | Valid session, wrong owner |
| 404 | `NOT_FOUND` | Resource missing, or not available to this caller |
| 404 | `INVALID_TOKEN` | Password reset token does not match any digest |
| 409 | `EMAIL_EXISTS` | Registration email already registered |
| 409 | `EMAIL_RETTIRED` | Email was permanently retired and can never re-register |
| 429 | `RATE_LIMIT_EXCEEDED` | Rate limited in `proxy.ts` |
| 500 | `INTERNAL_ERROR` | Unhandled error on a create/update path |
| 500 | `SERVER_ERROR` | Unhandled error elsewhere |
| 503 | `DATABASE_UNAVAILABLE` | Database unreachable (registration path only) |

A product that is `INACTIVE` or `DELETED` returns `404 NOT_FOUND` with a buyer-facing message. There is no `410 PRODUCT_UNAVAILABLE` code in this codebase.

---

## Auth Check Pattern

This project uses **NextAuth v5**. The session is read with the `auth()` helper exported from `lib/auth` — there is no `authOptions` export and no `getServerSession` call.

```ts
import { auth } from '@/lib/auth'

const session = await auth()
if (!session?.user?.id) {
  return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
}
```

Put this as the first operation in the handler, before any parsing or business logic.

In Server Components (pages, layouts) the same `await auth()` call is used for reads and redirects. In Client Components use `useSession()` or the exported `signIn` / `signOut`.

`lib/auth.ts` exports `authConfig`, `handlers`, `auth`, `signIn`, and `signOut`. Route handlers for NextAuth itself live at `app/api/auth/[...nextauth]/route.ts` and only re-export `handlers`.

---

## Route Parameter Extraction

This project is on **Next.js 16**, where `params` and `searchParams` are **Promises and must be awaited**.

```ts
interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, { params }: RouteParams) {
  const { id } = await params
  const product = await prisma.product.findUnique({ where: { id } })
  // ...
}
```

Naming the shape in a local `RouteParams` interface, as above, is the convention used across the existing routes.

> Synchronous access to `params`/`searchParams` was removed in Next.js 16. The same applies to `cookies()`, `headers()`, `draftMode()`, page `generateMetadata`, and the image-metadata generators — all must be awaited.

---

## Ownership Check Pattern

After fetching a resource, verify it belongs to the requesting seller:

```ts
const product = await prisma.product.findUnique({ where: { id } })
if (!product) {
  return errorResponse(404, 'NOT_FOUND', 'This product does not exist.')
}
if (product.sellerId !== session.user.id) {
  return errorResponse(403, 'FORBIDDEN', 'You do not have access to this product.')
}
```

Check ownership on **every** read and write of a seller-owned resource, including single-item GETs.

---

## Route Handler Template (GET — authenticated list)

```ts
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'

/** GET /api/products — list current seller's products */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  try {
    const products = await prisma.product.findMany({
      where: { sellerId: session.user.id, status: { not: 'DELETED' } },
      orderBy: { createdAt: 'desc' },
    })

    return successResponse({ products })
  } catch (error) {
    console.error('Product list error:', error)
    return errorResponse(500, 'SERVER_ERROR', 'Something went wrong. Please try again.')
  }
}
```

Note the soft-delete filter: seller-facing lists exclude `DELETED` rather than relying on a nullable `deletedAt` check alone.

---

## PATCH Template (Update)

```ts
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { errorResponse, successResponse } from '@/lib/api'

interface RouteParams {
  params: { id: string }
}

/** PATCH /api/products/[id] — update a product */
export async function PATCH(req: Request, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user?.id) {
    return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')
  }

  const { id } = params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request body.')
  }

  const product = await prisma.product.findUnique({ where: { id } })
  if (!product) {
    return errorResponse(404, 'NOT_FOUND', 'This product does not exist.')
  }
  if (product.sellerId !== session.user.id) {
    return errorResponse(403, 'FORBIDDEN', 'You do not have access to this product.')
  }

  // Build update data — only include fields that were actually sent
  const updateData: Record<string, unknown> = {}
  if (typeof body.name === 'string' && body.name.trim()) {
    updateData.name = body.name.trim()
  }

  if (Object.keys(updateData).length === 0) {
    return errorResponse(400, 'VALIDATION_ERROR', 'No valid fields to update.')
  }

  try {
    const updated = await prisma.product.update({ where: { id }, data: updateData })
    return successResponse({ product: updated })
  } catch (err) {
    console.error({
      event: 'product_update_error',
      productId: id,
      sellerId: session.user.id,
      error: err instanceof Error ? err.message : 'unknown',
    })
    return errorResponse(500, 'SERVER_ERROR', 'Something went wrong. Please try again.')
  }
}
```

---

## DELETE Template (Soft Delete)

SellSnap soft-deletes: set `status` to `DELETED` and stamp `deletedAt`. Never hard-delete — `Order` rows reference `Product` with `onDelete: Restrict`, and the seller's order history is an audit trail.

```ts
try {
  await prisma.product.update({
    where: { id },
    data: { status: 'DELETED', deletedAt: new Date() },
  })
  return successResponse({ deleted: true })
} catch (err) {
  console.error({ event: 'product_delete_error', productId: id, error: ... })
  return errorResponse(500, 'SERVER_ERROR', 'Something went wrong. Please try again.')
}
```

---

## Input Validation

Validate server-side before touching Prisma. Client-side validation is UX only.

Wrap `req.json()` in `try/catch` — a malformed body throws. Where the caller may send nothing at all, `await req.json().catch(() => null)` and validate the result as `unknown`:

```ts
const body: unknown = await req.json().catch(() => null)
const { customerEmail } =
  body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
```

Common checks:

```ts
// String fields: presence and trim
const name = typeof body.name === 'string' ? body.name.trim() : ''
if (!name) {
  return errorResponse(400, 'VALIDATION_ERROR', 'Product name is required.', 'name')
}

// Email: use the shared helper, and always normalise before storage or lookup
import { isValidEmail } from '@/lib/validation'

const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
if (!isValidEmail(email)) {
  return errorResponse(400, 'VALIDATION_ERROR', 'Enter a valid email address.', 'email')
}
```

`isValidEmail()` in `lib/validation.ts` is deliberately permissive — the authoritative test of deliverability is whether the mail provider accepts the address. Use it rather than adding a second, stricter regex.

### Money

The wire format depends on the route:

- **JSON routes** that accept a kobo integer validate with `Number.isInteger(priceKobo) && priceKobo > 0`.
- **`POST /api/products` is multipart** (`req.formData()`), not JSON. The client sends `priceNaira` as a **string**, and the server converts once with `nairaToKobo()` before validating the result is a positive integer:

```ts
const priceNaira = Number(priceNairaStr)
if (isNaN(priceNaira) || priceNaira <= 0) {
  return errorResponse(400, 'VALIDATION_ERROR', 'Price must be greater than 0.', 'price')
}
const priceKobo = nairaToKobo(priceNaira)
if (!Number.isInteger(priceKobo) || priceKobo <= 0) {
  return errorResponse(400, 'VALIDATION_ERROR', 'Invalid price value.', 'price')
}
```

Never store or compare money as a float. See `.agent/rules/code-style.md` → *Kobo Rule*.

---

## Error Handling

Wrap Prisma and external API calls in `try/catch`. Log internally with context; return a generic `500` to the client.

Never return a raw Prisma message, a provider response body, or a stack trace to the client. `.agent/rules/security.md` → *Provider Response Validation* applies to any upstream API, not just Flutterwave.

---

## Pagination

The current list routes are **not paginated** — `GET /api/products` returns the seller's full product list. Do not add pagination speculatively; it is not an MVP requirement.

If a list genuinely grows large enough to need it, use offset pagination with a bounded limit and wrap the reads in a transaction:

```ts
const rawPage = Number(req.nextUrl.searchParams.get('page')) || 1
const rawLimit = Number(req.nextUrl.searchParams.get('limit')) || 20

const page = Math.max(1, rawPage)
const limit = Math.min(Math.max(1, rawLimit), 50)
const skip = (page - 1) * limit

const [items, total] = await prisma.$transaction([
  prisma.product.findMany({
    where: { sellerId: session.user.id },
    skip,
    take: limit,
    orderBy: { createdAt: 'desc' },
  }),
  prisma.product.count({ where: { sellerId: session.user.id } }),
])

return successResponse({ items, total, page, limit })
```

Always clamp `limit` to prevent abuse.

---

## File Upload Routes

`POST /api/products` accepts `multipart/form-data` and uploads the product image through `lib/blob.ts`.

- Validate with **magic bytes**, never the browser-supplied MIME type. `validateImageMagicBytes()` in `lib/blob.ts` accepts JPEG, PNG, and WebP.
- Maximum size is **5 MB** (`MAX_FILE_SIZE_BYTES`), enforced server-side in `lib/blob.ts`.
- Do not call the provider directly. `uploadProductImage(file)` handles validation, the Vercel Blob upload, and the local `public/uploads` fallback when `BLOB_READ_WRITE_TOKEN` is unset.
- Map a validation failure to `400 VALIDATION_ERROR` with `field: 'image'`. The existing route does this by matching the thrown message:

```ts
if (error.message.includes('5MB') || error.message.includes('Invalid image')) {
  return errorResponse(400, 'VALIDATION_ERROR', error.message, 'image')
}
```

---

## Public Routes (No Auth)

Accessible to unauthenticated buyers. **Do not call `auth()` in these handlers:**

- `GET /api/product-page/[slug]` — product data for the public page
- `POST /api/product-page/[slug]/pay` — initiate payment (rate-limited; see the Flutterwave skill)
- `GET /api/checkout/status/[txRef]` — order status polling for the confirm page
- `POST /api/webhooks/flutterwave` — provider webhook, `verif-hash` verified instead of session verified

Public routes still validate every input, and never expose seller bank details or provider responses.

---

## Middleware Context

Rate limiting is handled in `proxy.ts` (the Next 16 proxy, formerly `middleware.ts`), not inside route handlers. Do not duplicate it.

- `POST /api/product-page/[slug]/pay` — 10 requests per IP per hour
- `POST /api/auth/reset-password/request` — 5 requests per IP per hour, plus 3 per email address per hour counted in the route from `PasswordResetToken` rows
- `POST /api/auth/register` — 5 per IP per hour
- `POST /api/auth/reset-password/confirm` — 10 per IP per hour
- `POST /api/auth/callback/credentials` — 20 per IP per 15 minutes, plus a per-account soft lockout in `lib/auth.ts`

The rate limiter lives in `lib/rate-limit.ts` and is process-local, so it is per-instance and resets on cold start or deploy. See `.agent/rules/security.md` → *Rate Limiting* for why that is accepted rather than fixed.

Authenticated dashboard routes are protected at the layout level, not per page.

---

## Cron Route

`GET /api/cron/resolve-pending` is protected by the `CRON_SECRET` bearer token, not a session. Vercel Cron sends the secret as `Authorization: Bearer <CRON_SECRET>` and always invokes a cron path with GET:

```ts
export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(null, { status: 401 })
  }
  // ...
}
```

Do not read `CRON_SECRET` from a custom header — Vercel never sends one, and the job would reject every invocation. See the Flutterwave skill for the sweep's batching rules.

---

## Common Mistakes

| Mistake | Correct approach |
|---|---|
| Importing `getServerSession` / `authOptions` | NextAuth v5: `const session = await auth()` from `@/lib/auth` |
| `await params` | Next.js 16 — `params`/`searchParams` are Promises; `await` them |
| Redefining `errorResponse` / `successResponse` in the route | Import from `@/lib/api` |
| Returning ad-hoc JSON instead of the envelope | Use `successResponse` / `errorResponse` |
| Not wrapping `req.json()` in `try/catch` | Always wrap, or use `.catch(() => null)` |
| Skipping the ownership check on a GET, PATCH, or DELETE | Verify `resource.sellerId === session.user.id` on every access |
| Hard-deleting a product | Soft delete: `status: 'DELETED'` + `deletedAt` |
| Trusting a client-reported price or payment status | Derive the amount server-side; verify payments via `lib/flutterwave.ts` |
| Sending `priceNaira` where kobo is expected | Convert once with `nairaToKobo()`; store kobo |
| Not normalising email | `email.trim().toLowerCase()` before storage or lookup |
| Writing a second, stricter email regex | Use `isValidEmail()` from `lib/validation` |
| Returning a raw Prisma or provider error to the client | Log internally, return a generic message |
| Instantiating Prisma Client directly | Always import `prisma` from `@/lib/prisma` |
| Adding a client SDK or `FLUTTERWAVE_PUBLIC_KEY` | Checkout is a server-side redirect; no browser SDK |
| Adding pagination to a list that does not need it | Not an MVP requirement — do not speculatively add |

---

## Checklist Before Submitting a Route

- [ ] `auth()` check at the top of every authenticated handler
- [ ] No `auth()` call in a public, webhook, or cron route
- [ ] Ownership check on every seller-owned resource access
- [ ] `req.json()` wrapped in `try/catch`
- [ ] `params` typed as a plain object, not awaited
- [ ] All input validated server-side before the Prisma call
- [ ] Email normalised with `.trim().toLowerCase()` and checked with `isValidEmail()`
- [ ] Money converted to integer kobo and validated as a positive integer
- [ ] All Prisma and external calls wrapped in `try/catch`
- [ ] All responses use `successResponse` / `errorResponse` imported from `@/lib/api`
- [ ] Error codes drawn from the table above
- [ ] No raw SQL in application code
- [ ] No secrets referenced outside their permitted module
- [ ] Logs include an event name and relevant IDs, and no PII
- [ ] Image uploads validated with magic bytes and the 5 MB limit
- [ ] Deletes are soft deletes
- [ ] `npm run typecheck` and `npm test` pass
