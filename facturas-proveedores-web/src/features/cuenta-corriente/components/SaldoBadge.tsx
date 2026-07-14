/**
 * SaldoBadge — sign-dispatch badge for the cuenta-corriente `saldo` (C-13, D2).
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
 * Visual (D11):
 *   - Deuda  (>0):  red family
 *   - Al día (=0):  green family
 *   - A favor (<0): blue family, with the literal " a favor" suffix
 *   - NaN:          unknown fallback (gray, "—")
 */
import { formatSaldo } from '@shared/utils/currency'

export type SaldoVariant = 'deuda' | 'al-dia' | 'a-favor' | 'unknown'

interface SaldoBadgeProps {
  saldo: number
}

const VARIANT_CLASSES: Record<SaldoVariant, string> = {
  deuda: 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-50 text-red-700 ring-1 ring-red-200',
  'al-dia': 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-green-50 text-green-700 ring-1 ring-green-200',
  'a-favor': 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  unknown: 'inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-gray-100 text-gray-700 ring-1 ring-gray-200',
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
