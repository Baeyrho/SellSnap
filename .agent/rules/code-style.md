---
trigger: always_on
---

# code-style.md

> TypeScript, naming, imports, and formatting rules for SellSnap.

---

## TypeScript

- **Strict mode is on.** `tsconfig.json` must include `"strict": true`. This is non-negotiable.
- No `any`. If a type is genuinely unknown, use `unknown` and narrow it explicitly.
- No `// @ts-ignore` or `// @ts-expect-error` without a comment explaining why it cannot be avoided.
- No `as unknown as X` type casting. If you need a cast, the data shape is wrong — fix the type. **Exception:** the Prisma Client singleton in `lib/prisma.ts` uses `globalThis as unknown as { prisma: PrismaClient }` — this is the only permitted use.
- All function parameters and return types are explicitly typed. No implicit `any` from missing annotations.
- Use `interface` for object shapes that describe data (props, API responses, DB records).
- Use `type` for unions, intersections, and utility types.
- Prefer `const` over `let`. Never use `var`.

---

## Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| React component files | PascalCase | `ProductCard.tsx`, `OrderTable.tsx` |
| Other TS/JS files | kebab-case | `use-orders.ts`, `kobo.ts` |
| Component folders | PascalCase, matching the component | `ProductCard/`, `DashboardShell/` |
| Route folders | kebab-case, matching the URL segment | `product-page/`, `reset-password/` |
| Components | PascalCase | `ProductCard`, `OrderTable` |
| Functions | camelCase | `getProductBySlug`, `formatNaira` |
| Variables | camelCase | `priceKobo`, `sellerEmail` |
| Constants | UPPER_SNAKE_CASE | `MAX_FILE_SIZE_BYTES`, `PROVIDER_TIMEOUT_MS` |
| Prisma models | PascalCase (matches schema) | `User`, `Product`, `Order` |
| Prisma fields | camelCase, no `@map` | `priceKobo`, `transactionRef`, `flutterwaveTxId` |
| CSS classes | camelCase inside module | `styles.cardWrapper`, `styles.priceLabel` |
| API error codes | UPPER_SNAKE_CASE | `NOT_FOUND`, `VALIDATION_ERROR`, `SUBACCOUNT_NOT_CONFIGURED` |

---

## File Naming

- React component files: `ProductCard.tsx`
- CSS Module files: `ProductCard.module.css` — same name as component
- Route handlers: `route.ts`
- Server actions (if used): `actions.ts` inside the relevant route folder
- Utility files: `kobo.ts`, `nanoid.ts`, `email.ts`

---

## Imports

- Use `@/` path aliases for all internal imports. No relative `../` chains beyond one level.
- Group imports in this order, separated by a blank line:
  1. React / Next.js core
  2. Third-party libraries
  3. Internal `@/lib/`
  4. Internal `@/components/`
  5. Internal `@/types/`
  6. CSS Modules (last)

```ts
import { NextResponse } from 'next/server'

import { nanoid } from 'nanoid'

import { prisma } from '@/lib/prisma'
import { auth } from '@/lib/auth'
import { formatNaira } from '@/lib/kobo'
import { errorResponse, successResponse } from '@/lib/api'

import { OrderTable } from '@/components/order/OrderTable'

import styles from './OrderTable.module.css'
```

Named imports only — no default or namespace imports from `lib/`.

- Never use barrel files (`index.ts` re-exporting everything). Import directly from the source file.

---

## Functions & Async

- All async functions use `async/await`. No `.then()` chains.
- Every `async` function that can fail wraps its logic in `try/catch` and handles the error explicitly — no silent failures.
- API route handlers return early on error conditions — no deeply nested if/else chains.

```ts
// Good — early returns
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await auth()
  if (!session?.user?.id) return errorResponse(401, 'UNAUTHENTICATED', 'Log in to continue.')

  const product = await prisma.product.findUnique({ where: { id: params.id } })
  if (!product) return errorResponse(404, 'NOT_FOUND', 'This product does not exist.')
  if (product.sellerId !== session.user.id) return errorResponse(403, 'FORBIDDEN', 'You do not have access to this product.')

  return successResponse({ product })
}
```

Auth is NextAuth v5: `await auth()` from `@/lib/auth`. There is no `authOptions` export and no `getServerSession` call in this project.

---

## Currency — Kobo Rule

**All monetary amounts are stored and passed as integers in kobo.**

- ₦1 = `100` kobo
- ₦12,500 = `1250000` kobo
- Never use `parseFloat` or `toFixed` on monetary values.
- Use `lib/kobo.ts` for all formatting and conversion. Do not add ad-hoc arithmetic elsewhere.

```ts
// lib/kobo.ts
export function koboToNaira(kobo: number): number {
  return Math.floor(kobo / 100)
}

export function formatNaira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString('en-NG')}`
}

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100)
}

/** The exact Naira amount to charge for a kobo price — deliberately not floored. */
export function koboToChargeableNaira(kobo: number): number {
  return kobo / 100
}

/** 'UNDERPAID' | 'PAID_IN_FULL' | 'OVERPAID' — the single amount-comparison decision. */
export function assessPayment(paidNaira: number, requiredKobo: number): PaymentAssessment
```

Two rules that are easy to get wrong:

- **Charge with `koboToChargeableNaira()`**, never `koboToNaira()`. Flooring the charge while comparing against an unrounded expectation rejects orders the buyer actually paid for.
- **Compare with `assessPayment()`**, never a raw `amount >= expected` in Naira. It converts to integer kobo first, and it distinguishes *exactly paid* from *overpaid* — overpayment is a distinct outcome that is reversed, not fulfilled. See `.agent/rules/security.md` → *Flutterwave Payment Verification*.

---

## Error Response Helper

Use this helper in every API route. Do not write ad-hoc error objects.

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

**Import these from `@/lib/api`. Never redefine them inside a route file.** The full error-code table lives in `.agent/skills/api-route-scaffolder/SKILL.md`.

```ts
import { errorResponse, successResponse } from '@/lib/api'
```

---

## Comments

- Write comments to explain **why**, not what. Code explains what.
- Every exported function in `lib/` has a one-line JSDoc comment.
- If a non-obvious decision was made, leave a `// NOTE:` comment.
- If something must be revisited, leave a `// TODO:` comment with a description.

---

## What Not to Do

- Do not use `console.log` for debugging in production code. Use structured logging (see `architecture.md`).
- Do not use `JSON.parse` without a `try/catch`.
- Do not use `!` non-null assertion unless the value is guaranteed non-null by the DB schema or control flow — add a comment if you do.
- Do not export mutable state from modules.
- Do not use default exports from `lib/` files.
