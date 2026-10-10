# SKILL — Component Builder

> Use this skill before building any UI component in SellSnap. It covers folder structure, CSS Modules with the project's design tokens, Server vs Client Components, accessibility, and concrete specs for core UI elements.

---

## Before You Start

1. Read `.agent/rules/design-system.md` — tokens, layout rules, CSS Modules conventions.
2. Read `.agent/rules/code-style.md` — TypeScript rules, naming, import order.
3. Open `tokens/tokens.css` and review the available CSS custom properties — this is the source of truth for all color and typography values.
4. Confirm whether the component needs interactivity. If it does not use `useState`, `useEffect`, event handlers, or browser APIs, it is a **Server Component** (no `'use client'`).

---

## Folder Structure

Every component gets its own folder:

```
components/
└── [category]/
    └── [ComponentName]/
        ├── [ComponentName].tsx
        └── [ComponentName].module.css
```

Import components directly from their source file — do not create `index.ts` barrel files (see `code-style.md`).

```ts
// Correct — direct import
import { ProductCard } from '@/components/product/ProductCard/ProductCard'

// Wrong — barrel file
import { ProductCard } from '@/components/product/ProductCard'
```

Categories:
- `ui/` — generic, reusable elements (Button, Input, Badge, Skeleton)
- `product/` — product-specific components (ProductCard, ProductForm, ProductPage, ProductsView)
- `order/` — order-related components (OrderTable)
- `layout/` — shells, headers, sidebars, page wrappers (DashboardShell, DashboardHeader, DashboardSidebar, PageShell)
- `auth/` — the single AuthCard
- `landing/` — landing-page sections (HeroSection, FeatureGrid, StepFlow, EarningsCalculator, FaqSection, CtaBanner, LandingNav, LandingFooter)
- `profile/` — seller settings sections (ProfileView, ProfileSectionNav, ProfileInfoForm, AccountInfoForm, ProfileSecurity, ProfileNotifications)

---

## Token Quick Reference

All styling values must come from `tokens/tokens.css`. Never hardcode hex colours, font sizes, or font families.

### Colours (Light theme — dark theme switches automatically via semantic tokens)

| Purpose | Token |
|---|---|
| Primary brand colour | `--color-primary` |
| Text on primary | `--color-on-primary` |
| Primary container | `--color-primary-container` |
| Text on primary container | `--color-on-primary-container` |
| Page background | `--color-background` |
| Text on background | `--color-on-background` |
| Card / component surface | `--color-surface` |
| Text on surface | `--color-on-surface` |
| Subtle surface variation | `--color-surface-variant` |
| Text on surface variant | `--color-on-surface-variant` |
| Borders / dividers | `--color-outline` |
| Subtle borders | `--color-outline-variant` |
| Error state | `--color-error` |
| Text on error | `--color-on-error` |
| Error container | `--color-error-container` |
| Elevated surface layers | `--color-surface-container-low`, `--color-surface-container`, `--color-surface-container-high` |

### Typography Scale (Material Design 3)

Tokens follow the pattern: `--{role}-{size}-{property}`

| Role | Use for | Font size token | Line height token | Font weight token |
|---|---|---|---|---|
| `display-large` | Hero sections | `--display-large-font-size` (64px) | `--display-large-line-height` (96px) | `--display-large-font-weight` (400) |
| `headline-large` | Page titles | `--headline-large-font-size` (40px) | `--headline-large-line-height` (60px) | `--headline-large-font-weight` (500) |
| `headline-small` | Section titles | `--headline-small-font-size` (32px) | `--headline-small-line-height` (48px) | `--headline-small-font-weight` (400) |
| `title-medium` | Card titles | `--title-medium-font-size` (24px) | `--title-medium-line-height` (36px) | `--title-medium-font-weight` (500) |
| `title-small` | Subtitles | `--title-small-font-size` (22px) | `--title-small-line-height` (33px) | `--title-small-font-weight` (500) |
| `body-large` | Large body text | `--body-large-font-size` (24px) | `--body-large-line-height` (36px) | `--body-large-font-weight` (400) |
| `body-medium` | Default body text | `--body-medium-font-size` (22px) | `--body-medium-line-height` (33px) | `--body-medium-font-weight` (400) |
| `body-small` | Secondary text | `--body-small-font-size` (20px) | `--body-small-line-height` (30px) | `--body-small-font-weight` (400) |
| `label-large` | Button labels | `--label-large-font-size` (22px) | `--label-large-line-height` (33px) | `--label-large-font-weight` (500) |
| `label-medium` | Form labels | `--label-medium-font-size` (20px) | `--label-medium-line-height` (30px) | `--label-medium-font-weight` (500) |
| `label-small` | Captions, badges | `--label-small-font-size` (16px) | `--label-small-line-height` (24px) | `--label-small-font-weight` (500) |

Font family is `--{role}-{size}-font-family` (all are `Inter`, loaded via `next/font` on `<body>` in `app/layout.tsx`).

### Compact Scale (dashboard surfaces)

`tokens/tokens.css` also defines a second, tighter scale for dashboard and data-dense UI, where the Material scale is too large. Prefer these inside `/dashboard`.

| Token pair | Size / line height | Use for |
|---|---|---|
| `--text-xs-font-size` / `--text-xs-line-height` | 12px / 16px | Metadata, timestamps, table captions |
| `--text-sm-*` | 13px / 18px | Secondary text, helper copy |
| `--text-md-*` | 14px / 20px | **Dashboard body default** |
| `--text-lg-*` | 16px / 24px | Card and section headings |
| `--text-xl-*` | 18px / 26px | Page headings |
| `--text-2xl-*` | 20px / 28px | Large figures, totals |
| `--text-3xl-*` | 24px / 32px | Dashboard hero figures |

Each also has a `-font-weight` companion: 400 for `xs`/`sm`/`md`, 500 for `lg`, 600 for `xl`/`2xl`/`3xl`.

Do not mix the two scales inside a single component.

### Font Weight

Three weights are tokenized, and only three:

```css
--font-weight-regular: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
```

**There is no token for 700 or 800.** A hardcoded `font-weight: 700` is both off-system and unfixable by reaching for a variable. If a design needs something heavier, ask for the token file to be extended rather than writing the literal.

### Spacing and Radius Are Not Tokenized

Spacing and radius have **no CSS variables**. They are written as literal `px` from these fixed scales, and must not be widened:

- Spacing: `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `64px`
- Radius: `4px` badges/tags, `8px` buttons/inputs, `12px` cards/modals

Values like `2px`, `6px`, `10px`, or a `16px` radius are not part of the system.

---

## Dark Mode

**There is no dark mode in this project.** `tokens/tokens.css` contains a single `:root` block with light-theme values only — there is no `.dark` class, no `[data-theme="dark"]` selector, and no `prefers-color-scheme` media query anywhere in `tokens/` or `app/`.

The colour tokens are *semantic* (`--color-surface`, `--color-on-surface`, `--color-primary`), not literal, which means a dark theme could later be added to the token file alone without touching components. That is the reason for the semantic naming — not evidence that dark mode currently works.

Do **not** write component-level dark mode overrides, `.dark` selectors, or `prefers-color-scheme` queries. There is nothing for them to hook into, and adding one produces a component that appears to support a mode the app does not have. If dark mode is required, the token file needs a dark block first.

---

## Component Template (Server Component)

```tsx
// components/[category]/[ComponentName]/[ComponentName].tsx

import styles from './[ComponentName].module.css'

interface [ComponentName]Props {
  // Define all props explicitly — no implicit any
}

export function [ComponentName]({ prop1, prop2 }: [ComponentName]Props) {
  return (
    <div className={styles.wrapper}>
      {/* component content */}
    </div>
  )
}
```

---

## Client Component Template

Add `'use client'` only when the component needs `useState`, `useEffect`, event handlers, or browser APIs.

```tsx
// components/ui/Counter/Counter.tsx
'use client'

import { useState } from 'react'

import styles from './Counter.module.css'

interface CounterProps {
  initialCount?: number
}

export function Counter({ initialCount = 0 }: CounterProps) {
  const [count, setCount] = useState(initialCount)

  function handleIncrement(): void {
    setCount((prev) => prev + 1)
  }

  return (
    <div className={styles.wrapper}>
      <span className={styles.count}>{count}</span>
      <button className={styles.button} onClick={handleIncrement} type="button">
        Add
      </button>
    </div>
  )
}
```

---

## CSS Module Template

```css
/* components/[category]/[ComponentName]/[ComponentName].module.css */

.wrapper {
  /* Mobile-first base styles — use tokens only */
  padding: 16px;
  background: var(--color-surface);
  color: var(--color-on-surface);
  border: 1px solid var(--color-outline-variant);
  border-radius: 12px;
}

.title {
  font-size: var(--title-medium-font-size);
  font-weight: var(--title-medium-font-weight);
  line-height: var(--title-medium-line-height);
  letter-spacing: var(--title-medium-letter-spacing);
  color: var(--color-on-surface);
  margin: 0 0 8px;
}

.body {
  font-size: var(--body-medium-font-size);
  font-weight: var(--body-medium-font-weight);
  line-height: var(--body-medium-line-height);
  color: var(--color-on-surface-variant);
}

@media (min-width: 768px) {
  .wrapper {
    padding: 24px;
    border-radius: 12px;
  }

  .title {
    font-size: var(--headline-small-font-size);
    line-height: var(--headline-small-line-height);
  }
}
```

Rules:
- Use only CSS custom properties from `tokens/tokens.css`. No hard-coded hex or pixel values for colours/typography.
- Spacing uses the 4px scale: `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `64px`.
- Border radius: badges `4px`, buttons/inputs `8px`, cards/modals `12px`.
- No inline `style={{}}` props except for truly dynamic values (e.g., progress bar width).
- Class names are camelCase.

---

## className Forwarding

When a component needs to accept external styles for composition, merge the external class:

```tsx
interface CardProps {
  className?: string
  children: React.ReactNode
}

export function Card({ className, children }: CardProps) {
  return (
    <div className={`${styles.wrapper}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  )
}
```

Only add `className` forwarding when the component is genuinely used in multiple layout contexts. Not every component needs it.

---

## Steps to Build a Component

1. **Identify the category** — `ui/`, `product/`, `order/`, or `layout/`.
2. **Create the folder**: `components/[category]/[ComponentName]/`.
3. **Check `tokens/tokens.css`** for the colour and typography tokens you need.
4. **Write the `.tsx` file**:
   - Define the `interface` for props above the component.
   - Add `'use client'` only if required (see Server vs Client section).
   - Import CSS Module as `styles`.
   - Use `@/` aliases for all internal imports.
5. **Write the `.module.css` file**:
   - Mobile-first layout.
   - All colour and typography values from `tokens/tokens.css` custom properties.
   - Spacing from the 4px scale.
   - Minimum touch target 44×44px on interactive elements.
6. **Verify TypeScript** — no implicit `any`, all props typed.
7. **Run the accessibility checklist** (see bottom of this file).

---

## Server vs Client Components

| Needs | Component type |
|---|---|
| `useState`, `useEffect`, event handlers, browser APIs | Client Component — add `'use client'` |
| Data fetched via `async/await` directly in the component | Server Component — no directive needed |
| Static rendering, no interactivity | Server Component — no directive needed |

Prefer Server Components. Only add `'use client'` when required. For data fetching inside components, see `.agent/skills/api-route-scaffolder/SKILL.md` for API endpoint patterns.

Note that `'use client'` is **not** inherited by a component merely because a Client Component imports it. Any component using hooks, event handlers, or browser APIs needs its own `'use client'` directive even when its only importer is already a Client Component.

---

## Component States

Every component that displays data should handle four states:

| State | Pattern |
|---|---|
| **Loading** | Render a `Skeleton` placeholder matching the component's layout |
| **Loaded** | Render the component normally with data |
| **Empty** | Render a message like "No products yet" with an optional CTA |
| **Error** | Render an error message with a retry option if applicable |

```tsx
// Example: product list with states
if (isLoading) return <ProductCardSkeleton />
if (error) return <p className={styles.error}>Failed to load products.</p>
if (products.length === 0) return <p className={styles.empty}>No products yet. Create your first one!</p>
return products.map((p) => <ProductCard key={p.id} product={p} />)
```

---

## Specific Component Rules

### Button

```tsx
interface ButtonProps {
  variant: 'primary' | 'secondary' | 'ghost' | 'danger'
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  loading?: boolean
  type?: 'button' | 'submit' | 'reset'
  fullWidth?: boolean
}
```

- Pay button label: `Pay ₦[price] Now` — include price in label.
- Min height 44px on all variants.
- When `loading` is true: show a spinner, set `disabled`, and prevent clicks.
- Use `--label-large-font-size` and `--label-large-font-weight` for button text.
- Use `--color-primary` background for primary variant, `--color-on-primary` for text.
- Use `--color-error` background for danger variant.
- Border radius: `8px`.

### Input

```tsx
interface InputProps {
  id: string
  name: string           // required for form submissions
  label: string          // always required — no placeholder-only labels
  type?: 'text' | 'email' | 'password' | 'number' | 'tel'
  error?: string         // shown below input in --color-error
  placeholder?: string
  value?: string         // optional — for controlled inputs
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  required?: boolean
  disabled?: boolean
}
```

- Always render a `<label htmlFor={id}>` above the input.
- Use `--label-medium-font-size` for the label text.
- Use `--body-medium-font-size` for the input value text.
- Render error message below the input when `error` is defined, using `--color-error`.
- Border: `1px solid var(--color-outline)`. On focus: `var(--color-primary)`. On error: `var(--color-error)`.
- Border radius: `8px`. Min height: 44px.

### Textarea

```tsx
interface TextareaProps {
  id: string
  name: string
  label: string
  error?: string
  placeholder?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  rows?: number          // default: 4
  maxLength?: number
  required?: boolean
}
```

- Same label/error/border patterns as Input.
- Show character count when `maxLength` is provided: `{length}/{maxLength}`.

### Select

```tsx
interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  id: string
  name: string
  label: string
  options: SelectOption[]
  error?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void
  placeholder?: string   // e.g. "Select a bank"
  required?: boolean
}
```

- Same label/error/border patterns as Input.
- Include a disabled placeholder option when `placeholder` is provided.

### Badge (status)

```tsx
type BadgeVariant = 'success' | 'pending' | 'inactive' | 'failed'
interface BadgeProps { variant: BadgeVariant; label: string }
```

- Use `--label-small-font-size` and `--label-small-font-weight` for badge text.
- Border radius: `4px`.
- Colour mapping:
  - `success` → `--color-primary-container` background, `--color-on-primary-container` text
  - `pending` → `--color-secondary-container` background, `--color-on-secondary-container` text
  - `inactive` → `--color-surface-variant` background, `--color-on-surface-variant` text
  - `failed` → `--color-error-container` background, `--color-on-error-container` text

### Skeleton

```tsx
interface SkeletonProps {
  width?: string   // e.g. '100%', '200px'
  height?: string  // e.g. '24px', '120px'
  borderRadius?: string
}
```

Use `--color-surface-container` as the skeleton background with a shimmer animation:

```css
/* In the Skeleton.module.css */
.skeleton {
  background: var(--color-surface-container);
  border-radius: 8px;
  overflow: hidden;
  position: relative;
}

.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--color-surface-container-high) 50%,
    transparent 100%
  );
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

---

## Price Display

Always use `formatNaira()` from `@/lib/kobo`:

```tsx
import { formatNaira } from '@/lib/kobo'
<span className={styles.price}>{formatNaira(product.priceKobo)}</span>
```

Never interpolate raw kobo values into the UI.

---

## Common Mistakes

| Mistake | Correct approach |
|---|---|
| Using hardcoded hex colours (`#1a1a1a`) | Use tokens: `var(--color-on-surface)` |
| Using hardcoded font sizes (`16px`) | Use tokens: `var(--body-medium-font-size)` |
| Referencing `styles/globals.css` for tokens | The token file is `tokens/tokens.css` |
| Guessing token names (`--color-text-primary`) | Check `tokens/tokens.css` — names follow Material Design 3 (e.g. `--color-on-surface`) |
| Adding `'use client'` to a component that doesn't need it | Only add when using `useState`, `useEffect`, event handlers, or browser APIs |
| Using inline `style={{}}` | Use CSS Modules — only exception is truly dynamic values like progress width |
| Creating `index.ts` barrel files | Import directly: `from '@/components/ui/Button/Button'` |
| Touch targets under 44px | Set `min-height: 44px` on all buttons, inputs, and interactive elements |
| Missing `<label>` on form inputs | Always pair `<label htmlFor={id}>` with `<input id={id}>` |
| Writing component-level dark mode overrides | Use semantic tokens — they switch automatically via `tokens.css` |

---

## Accessibility Checklist

Before marking a component done:
- [ ] All interactive elements have min 44×44px tap target
- [ ] Images have `alt` text
- [ ] Form inputs have associated `<label>` elements
- [ ] Focus ring is visible (do not remove `outline`)
- [ ] Colour contrast passes WCAG 2.1 AA (4.5:1 for body, 3:1 for large text)
- [ ] No content conveyed by colour alone
- [ ] Error states are communicated via text, not just colour
- [ ] `aria-label` or `aria-describedby` used where visual label is insufficient
