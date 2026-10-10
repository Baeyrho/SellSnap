---
trigger: always_on
---

# Rule: Design System

## Token Files Are the Source of Truth

The project has one token file. The agent must never modify it:

- `tokens/tokens.css` — all color values, all font sizes, weights, line heights, and font families

The file exports CSS custom properties (CSS variables) that are available globally. It is imported once via `app/globals.css`.

## What the Token File Actually Provides

Read this before hunting for a variable. The token file covers **color and typography only**.

**Color** — semantic role tokens: `--color-primary`, `--color-on-primary`, `--color-primary-container`, `--color-secondary*`, `--color-tertiary*`, `--color-error*` (from `--color-palette-error-*`), `--color-background`, `--color-on-background`, `--color-surface`, `--color-surface-variant`, `--color-on-surface`, `--color-on-surface-variant`, `--color-outline`, `--color-outline-variant`, `--color-inverse-*`, and the `--color-surface-dim` / `-bright` / `-container-*` family.

**Typography — two scales.** Pick one deliberately; do not mix them in a single component.

| Scale | Tokens | Use for |
|---|---|---|
| Standard | `--display-large-*` … `--label-small-*` (display, headline, title, body, label) | Marketing and landing surfaces |
| Compact | `--text-xs-*`, `--text-sm-*`, `--text-md-*`, `--text-lg-*`, `--text-xl-*`, `--text-2xl-*`, `--text-3xl-*` | Dashboard surfaces, where vertical space is tight |

Both expose `-font-size`, `-line-height`, and `-font-weight`. The standard scale additionally exposes `-font-family`, `-letter-spacing`, `-font-style`, `-font-stretch`, `-text-decoration`, `-text-case`, `-paragraph-indent`, and `-paragraph-spacing`.

**Font weights** — only three are tokenized:

```css
--font-weight-regular: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
```

**There is no token for 700 or 800.** If a design calls for a heavier weight, do not hardcode `font-weight: 700` — it violates the rule below and there is no variable to reach for. Raise it with the project owner and have `tokens/tokens.css` extended. The two rules "never hardcode typography values" and "never modify the token file" otherwise deadlock.

**Font family** — the tokens declare `Inter`, and `app/layout.tsx` loads it with `next/font` and applies it on `<body>`. Use the `--*-font-family` tokens rather than naming a family.

**Not tokenized:** spacing and border radius have **no CSS variables at all**. The scales below are literal `px` values and are written as literals for that reason.

## Mandatory: Use CSS Variables, Never Raw Values

The agent must never write hardcoded color values or typography values anywhere in this codebase.

**Wrong:**
```css
color: #1a1a1a;
font-size: 16px;
font-weight: 700;
font-family: 'Inter', sans-serif;
background: #f5f5f5;
```

**Correct:**
```css
color: var(--color-on-surface);
font-size: var(--body-medium-font-size);
font-weight: var(--font-weight-medium);
font-family: var(--body-medium-font-family);
background: var(--color-surface);
```

Before writing any style value, check the token file. If a variable exists for what you need, use it. If it does not exist, ask before inventing a new value.

Derived or translucent colors are the common exception, and they still must be built from tokens rather than literals. The token values are complete colors (`hsl(154, 100%, 42%)`), not exposed channel triplets, so use `color-mix()`:

```css
background: color-mix(in srgb, var(--color-primary) 10%, transparent);
```

Do not write `rgba(0, 0, 0, 0.04)` or a bare hex to achieve the same effect.

## Spacing Scale

Use multiples of 4px for all spacing (margin, padding, gap). Do not use arbitrary values.

Allowed: `4px`, `8px`, `12px`, `16px`, `24px`, `32px`, `48px`, `64px`

Values outside this list — `2px`, `6px`, `10px`, and similar — are not permitted. There are no spacing variables, so these are written literally.

## Border Radius

The product has a consistent border radius. Use these values only:

- Small elements (badges, tags): `4px`
- Buttons and inputs: `8px`
- Cards and modals: `12px`

Other radii, including `6px` and `16px`, are not part of the system.

## Spacing and Radius Are Not Tokenized

Both scales above are written as literal `px`. This is a known gap, not permission to add arbitrary values — `tokens/tokens.css` does not define spacing or radius variables, so there is nothing to reference. Follow the scales exactly; do not widen them on your own initiative.

## Styling Method

- All component styles use CSS Modules (`.module.css` files).
- No inline `style={{}}` props except for truly dynamic values that cannot be expressed in CSS (e.g., a progress bar width driven by a number).
- No Tailwind. No styled-components. CSS Modules only.

## Mobile-First

SellSnap users are primarily on mobile. Every component must be built mobile-first:

- Default styles target mobile (small screens).
- Use `@media (min-width: 768px)` to layer in desktop styles.
- Touch targets must be a minimum of 44px tall.
- The product checkout page (`/p/[slug]`) must be fully functional on a 375px viewport.