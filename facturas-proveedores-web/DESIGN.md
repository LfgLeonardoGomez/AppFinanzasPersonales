# Design System — Facturas Proveedores

Editorial-luxury UI: warm cream/espresso surfaces, navy as the primary ink,
a Stripe-style violet accent, and a serif/sans type pairing (Playfair Display +
DM Sans). Built on **Tailwind CSS v4** — all design decisions live as `@theme`
tokens in `src/app/index.css`, consumed through utility classes. This document
is the single reference for those tokens, the shared components, and the
conventions that keep the UI coherent.

> **Feeding this to a model:** paste this whole file as context. It captures the
> palette (with hex), typography, spacing/radii/shadows, the component inventory
> with real props, and the patterns to follow. It is kept in sync with
> `src/app/index.css` and `src/shared/components/`.

## Quick path

1. **Colors, fonts, easings** → use the Tailwind tokens below (e.g.
   `bg-card`, `text-navy-800`, `text-accent-500`). Never hardcode hex in
   components.
2. **Common UI** → import from `@shared/components/*` (`Card`, `InputField`,
   `PageHeader`, `EmptyState`, `LoadingState`). Don't re-roll them.
3. **Feedback** → `toast.success(...)` / `toast.error(...)` from
   `@shared/components/Toaster/toast` (sonner). Icons → `lucide-react`.
4. **Dark mode** → every color has a dark variant; gate with `dark:` and let
   the `html.dark` class (managed by `src/app/theme/`) drive it.

## Foundations — color tokens

Source of truth: `src/app/index.css` (`@theme`). Reference as Tailwind classes
(`bg-navy-500`, `text-accent-500`, `ring-danger`, …).

### Navy (primary ink & surfaces)

| Token | Hex | Typical use |
|-------|-----|-------------|
| `navy-50` | `#f0f7ff` | Pill/eyebrow backgrounds, icon chips |
| `navy-100` | `#d6e8ff` | Skeleton blocks, subtle fills |
| `navy-300` | `#6ab3ff` | Placeholder text, muted icons |
| `navy-400` | `#2e90ff` | Secondary text, descriptions |
| `navy-500` | `#0a2540` | **Primary** — brand ink, theme-color |
| `navy-700` | `#062640` | Labels, strong text |
| `navy-800` | `#041a2d` | Body text (light mode) |
| `navy-900` | `#02101c` | Deepest ink |

### Accent (action — premium violet, Stripe-style)

| Token | Hex | Typical use |
|-------|-----|-------------|
| `accent-100` | `#ede9fe` | Focus ring halo (`focus:ring-accent-100`) |
| `accent-500` | `#635bff` | **Primary action** — buttons, focus outline, links |
| `accent-600` | `#7b79ff` | Hover on accent surfaces |
| `accent-700` | `#5b59e6` | Pressed/active accent |

### Semantic

| Role | Solid | Light | Bg | Use |
|------|-------|-------|----|----|
| Success | `success` `#059669` | `success-light` | `success-bg` | Confirmations, positive balances |
| Warning | `warning` `#d97706` | `warning-light` | `warning-bg` | Pending / attention states |
| Danger | `danger` `#dc2626` | `danger-light` | `danger-bg` | Errors, destructive, invalid fields |

### Surfaces

| Token | Hex | Use |
|-------|-----|-----|
| `cream` | `#f5f2eb` | App background (light) |
| `cream-dark` | `#ebe7de` | Drop zones, subtle panels |
| `espresso` | `#0f0e0c` | App background (dark) |
| `card` | `#ffffff` | Card/input surface (light) |
| `card-secondary` | `#faf8f3` | Secondary card surface |
| `card-dark` | `#1a1a1a` | Card surface (dark) |
| `card-dark-secondary` | `#252525` | Input surface (dark) |

## Foundations — typography

Loaded via Google Fonts in `index.html` (preconnected).

| Token | Family | Use |
|-------|--------|-----|
| `font-sans` | **DM Sans** (300–700) | Body, labels, inputs, buttons — the default (`html` uses it) |
| `font-serif` | **Playfair Display** (400–700) | All headings (`h1–h4`) and titled component headers |

Headings are styled globally in the base layer: `font-serif`, `font-weight:600`,
`letter-spacing:-0.02em`. Page titles use `font-serif text-3xl lg:text-4xl`
(see `PageHeader`).

## Foundations — motion, radii, shadows

| Concern | Value | Notes |
|---------|-------|-------|
| Easing `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Default transitions (`ease-[var(--ease-out)]`) |
| Easing `--ease-in-out` | `cubic-bezier(0.77, 0, 0.175, 1)` | Symmetric moves |
| Easing `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | Drawers / sheets |
| Radius — cards | `rounded-[1.5rem]` / `rounded-2xl` | Large, soft |
| Radius — inputs | `rounded-xl` | Fields, banners |
| Radius — pills/buttons | `rounded-full` | Eyebrows, primary buttons |
| Card padding | `p-6 lg:p-8` | Default (skip with `noPadding`) |
| Shadow — rest | `0 2px 8px rgba(10,37,64,0.04)` | Card at rest |
| Shadow — hover | `0 8px 24px rgba(10,37,64,0.10)` | Card hover lift |

**Animations** (utilities in `index.css`):
- `.animate-fade-in-up` — 500ms entrance (opacity + 12px rise). For banners, cards.
- `.animate-shimmer` — 1.5s looping skeleton shimmer. For loading placeholders.

## Foundations — base & accessibility

Applied globally in `@layer base` (`index.css`):

- **Focus ring** — `:focus-visible` → `2px solid accent-500`, `offset 2px`. Consistent app-wide; don't override per component.
- **Scrollbar** — thin (6px), `navy-200` thumb (light) / `#3f3f46` (dark).
- **Font smoothing** — antialiased on `html`.
- Components carry ARIA: inputs wire `aria-invalid` + `aria-describedby`;
  loading uses `role="status"` + `aria-busy`; errors use `role="alert"`.

## Component inventory

All under `src/shared/components/`. Import via `@shared/components/...`.

| Component | Purpose | Key props | Appearance |
|-----------|---------|-----------|------------|
| `Card` | Premium container with depth + hover lift | `noPadding`, `hover`, `className` | `rounded-[1.5rem] bg-card`, subtle ring + shadow, hover elevation |
| `InputField` | Labelled input with error/hint/icon | `label`, `error`, `hint`, `icon`, + native input attrs | `rounded-xl`, accent focus ring, danger border on error, optional left icon |
| `PageHeader` | Page title block | `eyebrow`, `title`, `description` | Uppercase pill eyebrow + serif `text-3xl/4xl` title + muted description |
| `EmptyState` | Empty-list placeholder (wraps `Card`) | `title`, `description`, `icon`, `children` (CTA slot) | Centered icon chip + serif title + description; defaults to `Inbox` icon |
| `LoadingState` | Skeleton for async boundaries | `label` | Three stacked `animate-shimmer` blocks; `role=status` |
| `Toaster` + `toast` | Global feedback | `toast.success/error(msg)` | Re-export of **sonner**; mounted in `AuthenticatedLayout` |
| `SupplierSearch` | Supplier autocomplete/search | (feature-specific) | Shared control used in filters and the IA proposal flow |
| `AppLayout` | Authenticated shell (sidebar + content) | — | Sidebar nav + main outlet; hosts the app chrome |
| `SuccessMessage` | ⚠️ **Deprecated** — use `toast.success` | `message`, `onDismiss` | Green auto-dismiss banner; kept only for the C-20 migration window |

### Usage examples

```tsx
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { Card } from '@shared/components/Card/Card'
import { InputField } from '@shared/components/InputField/InputField'
import { toast } from '@shared/components/Toaster/toast'

<PageHeader eyebrow="Proveedores" title="Nuevo proveedor" description="Cargá los datos del proveedor." />

<Card>
  <InputField label="Nombre" name="nombre" error={errors.nombre} />
</Card>

toast.success('Proveedor creado.')
```

## Patterns & conventions

| Pattern | Rule |
|---------|------|
| Tokens over hex | Style with Tailwind tokens (`bg-card`, `text-navy-800`). Never inline raw hex in components. |
| Iconography | `lucide-react` only. Chip icons sit in a `rounded-2xl bg-navy-50` container. |
| Feedback | `toast.*` (sonner) for transient confirmations/errors — not ad-hoc banners. |
| Dark mode | Pair every color with its `dark:` variant. Drive via the `html.dark` class from `src/app/theme/`. |
| Serif = headings only | Body/labels/buttons are DM Sans; Playfair is reserved for `h1–h4` and titled headers. |
| Motion | Use the `--ease-*` tokens and the two animation utilities; don't invent one-off keyframes. |
| Accessibility | Keep the ARIA wiring these components already ship (`aria-invalid`, `role=status/alert`). |

## Known gaps (design debt)

- **No shared `Button` primitive.** Buttons are styled inline per component
  (e.g. `FileUploadField` uses `rounded-full bg-accent-500 …`). This drifts over
  time — the top candidate to extract next into `@shared/components/Button`.
- **`SuccessMessage` is deprecated** — migrate remaining call sites to `toast`.
- **No living styleguide / Storybook** — this doc is the reference; there is no
  rendered catalog page.

## Keeping this in sync

When you change design, update this file in the same PR:

- [ ] Added/changed a token in `src/app/index.css` → update the token tables.
- [ ] Added/changed a shared component → update the inventory row + example.
- [ ] Introduced a new pattern (icon set, feedback, motion) → add a conventions row.
- [ ] Closed a design-debt item (e.g. extracted `Button`) → move it out of *Known gaps*.
