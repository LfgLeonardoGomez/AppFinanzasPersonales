/**
 * EstadoBadge — displays the computed invoice estado with color semantics.
 *
 * Restyled to the new design system (BRAND.md/DESIGN_SYSTEM.md — "indicador
 * de estado"): rounded-pill, Inter, and the dedicated
 * `--color-badge-{estado}-{bg,text}` tokens (src/app/index.css) instead of
 * generic Tailwind color scales.
 */
import type { EstadoFactura } from '@shared/api/api'

interface EstadoBadgeProps {
  estado: EstadoFactura
}

const ESTADO_STYLES: Record<string, string> = {
  PENDIENTE:
    'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-inter text-[11px] font-bold uppercase tracking-wide bg-badge-pendiente-bg text-badge-pendiente-text',
  PARCIAL:
    'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-inter text-[11px] font-bold uppercase tracking-wide bg-badge-parcial-bg text-badge-parcial-text',
  PAGADA:
    'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-inter text-[11px] font-bold uppercase tracking-wide bg-badge-pagada-bg text-badge-pagada-text',
}

const DEFAULT_STYLE =
  'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-inter text-[11px] font-bold uppercase tracking-wide bg-surface-alt text-ink-soft ring-1 ring-border-subtle'

export function EstadoBadge({ estado }: EstadoBadgeProps) {
  const className = ESTADO_STYLES[estado] ?? DEFAULT_STYLE
  return <span className={className}>{estado}</span>
}

export default EstadoBadge
