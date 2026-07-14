/**
 * MetodoBadge — payment method badge.
 *
 * Premium redesign with rounded-full pills and subtle rings.
 * Preserves original Tailwind color keywords for test compatibility.
 */
import type { MetodoPago } from '@shared/api/api'

interface MetodoBadgeProps {
  metodo: MetodoPago
}

const METODO_STYLES: Record<string, string> = {
  EFECTIVO:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
  TRANSFERENCIA:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-800 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20',
  TARJETA:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-violet-100 text-violet-800 ring-1 ring-violet-200 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20',
  MERCADOPAGO:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-sky-100 text-sky-800 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20',
  OTRO:
    'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700',
}

const DEFAULT_STYLE =
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700'

export function MetodoBadge({ metodo }: MetodoBadgeProps) {
  const className = METODO_STYLES[metodo] ?? DEFAULT_STYLE
  return <span className={className}>{metodo}</span>
}

export default MetodoBadge
