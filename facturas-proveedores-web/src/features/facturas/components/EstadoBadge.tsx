/**
 * EstadoBadge — displays the computed invoice estado with color semantics.
 *
 * Premium redesign with rounded-full pills and subtle rings.
 * Preserves original Tailwind color classes for test compatibility.
 */
import type { EstadoFactura } from '@shared/api/api'

interface EstadoBadgeProps {
  estado: EstadoFactura
}

const ESTADO_STYLES: Record<string, string> = {
  PENDIENTE:
    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-orange-100 text-orange-800 ring-1 ring-orange-200 dark:bg-orange-500/10 dark:text-orange-300 dark:ring-orange-500/20',
  PARCIAL:
    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-yellow-100 text-yellow-800 ring-1 ring-yellow-200 dark:bg-yellow-500/10 dark:text-yellow-300 dark:ring-yellow-500/20',
  PAGADA:
    'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-green-100 text-green-800 ring-1 ring-green-200 dark:bg-green-500/10 dark:text-green-300 dark:ring-green-500/20',
}

const DEFAULT_STYLE =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-gray-100 text-gray-700 ring-1 ring-gray-200 dark:bg-zinc-800 dark:text-zinc-400 dark:ring-zinc-700'

export function EstadoBadge({ estado }: EstadoBadgeProps) {
  const className = ESTADO_STYLES[estado] ?? DEFAULT_STYLE
  return <span className={className}>{estado}</span>
}

export default EstadoBadge
