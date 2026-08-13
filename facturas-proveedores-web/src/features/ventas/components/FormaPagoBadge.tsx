/**
 * FormaPagoBadge — sale payment-method badge (C-34, task 7.1).
 *
 * Mirrors `MetodoBadge` (C-13) exactly in structure and never computes or
 * transforms the value — it only displays the `forma_pago` passed in.
 * `FormaPago` is deliberately separate from `MetodoPago` (design.md D4): it
 * carries `CUENTA_CORRIENTE`, which `MetodoBadge` has no notion of, so this
 * is its own component rather than a widened prop type on `MetodoBadge`.
 */
import type { FormaPago } from '@shared/api/api'

interface FormaPagoBadgeProps {
  formaPago: FormaPago
}

const FORMA_PAGO_STYLES: Record<string, string> = {
  EFECTIVO:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
  TRANSFERENCIA:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-800 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20',
  TARJETA:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-800 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20',
  // "amber", not "magenta": magenta only has the 50/500/600/900 shades this
  // app registers in src/app/index.css's @theme block — 100/200/800 would
  // resolve to nothing. "amber" is one of Tailwind v4's built-in palettes
  // (imported wholesale via `@import "tailwindcss"`), so every shade exists.
  CUENTA_CORRIENTE:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 ring-1 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
  OTRO:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700',
}

const DEFAULT_STYLE =
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700'

export function FormaPagoBadge({ formaPago }: FormaPagoBadgeProps) {
  const className = FORMA_PAGO_STYLES[formaPago] ?? DEFAULT_STYLE
  return <span className={className}>{formaPago}</span>
}

export default FormaPagoBadge
