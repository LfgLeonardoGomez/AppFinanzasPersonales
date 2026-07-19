/**
 * SaldoBadge — large sign-dispatch display for the cuenta-corriente `saldo`
 * (C-13, D2; retheme: design/screen-proveedores).
 *
 * INVARIANTS (RN-SALDO, hard rule #4):
 *   - This component NEVER recomputes the saldo. It receives it as a prop
 *     and dispatches on the sign. The triple comes from the response
 *     verbatim (the C-12 service layer does the math).
 *   - The `data-variant` attribute is the semantic test hook that
 *     exposes the sign dispatch (`deuda | al-dia | a-favor | unknown`).
 *     The visual color is wired to the variant via Tailwind classes
 *     (D11) — class names are not asserted in tests (implementation
 *     details, per strict-tdd.md).
 *
 * Visual (Detalle Proveedor handoff — "$36px bold, red if debt"):
 *   - Deuda  (>0):  large bold red (--color-danger)
 *   - Al día (=0):  large bold ink
 *   - A favor (<0): large bold success green, with the literal " a favor" suffix
 *   - NaN:          unknown fallback (muted, "—")
 */
import { formatSaldo } from '@shared/utils/currency'

export type SaldoVariant = 'deuda' | 'al-dia' | 'a-favor' | 'unknown'

interface SaldoBadgeProps {
  saldo: number
}

const BASE_CLASSES = 'font-inter text-3xl font-extrabold tracking-tight lg:text-4xl'

const VARIANT_CLASSES: Record<SaldoVariant, string> = {
  deuda: `${BASE_CLASSES} text-danger`,
  'al-dia': `${BASE_CLASSES} text-ink dark:text-zinc-100`,
  'a-favor': `${BASE_CLASSES} text-success`,
  unknown: `${BASE_CLASSES} text-ink-soft`,
}

function variantFor(saldo: number): SaldoVariant {
  if (Number.isNaN(saldo)) return 'unknown'
  if (saldo > 0) return 'deuda'
  if (saldo < 0) return 'a-favor'
  return 'al-dia'
}

export function SaldoBadge({ saldo }: SaldoBadgeProps) {
  const variant = variantFor(saldo)
  const className = VARIANT_CLASSES[variant]

  // Defensive default for NaN / uninitialized cache.
  if (variant === 'unknown') {
    return (
      <span data-testid="saldo-badge" data-variant={variant} className={className}>
        —
      </span>
    )
  }

  // Invert sign for display: positive backend saldo = debt = negative display.
  const formatted = formatSaldo(saldo)
  const text = variant === 'a-favor' ? `${formatted} a favor` : formatted

  return (
    <span data-testid="saldo-badge" data-variant={variant} className={className}>
      {text}
    </span>
  )
}

export default SaldoBadge
