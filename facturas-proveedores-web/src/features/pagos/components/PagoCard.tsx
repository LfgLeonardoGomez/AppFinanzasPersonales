/**
 * PagoCard — pure presentational row for a single payment.
 *
 * Redesigned to the new design system: a low-density list row (not a tile),
 * matching FacturasList's row rhythm. Still pure presentational — no data
 * fetching, no hooks; `proveedorNombre` is resolved and passed down by the
 * parent `PagosList` (display-only lookup via the existing `useProveedores`
 * hook — `PagoListItem` only carries `proveedor_id`).
 *
 * INVARIANTS preserved:
 *  - monto (Intl ARS) shown in green with a leading "-" (it's money going out).
 *  - fecha rendered verbatim, as its own text node.
 *  - MetodoBadge renders the raw `metodo` value (RN mirrors RN-FAC-09).
 *  - "Pago al proveedor" reinforcement label (RN-PAG-01 — a pago never
 *    links to a factura, only to a supplier).
 *  - comprobante link only rendered when `comprobante_url` is present.
 *  - edit/delete actions invoke the corresponding prop callback.
 */
import type { PagoListItem } from '@shared/api/api'
import { MetodoBadge } from './MetodoBadge'
import { formatMonto } from '@shared/utils/currency'
import { Pencil, Trash2, ExternalLink, CreditCard } from 'lucide-react'

interface PagoCardProps {
  pago: PagoListItem & { comprobante_url?: string | null }
  proveedorNombre?: string | undefined
  onEdit: (pago: PagoListItem) => void
  onDelete: (pago: PagoListItem) => void
}

function getInitials(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase()
}

function pickChipPalette(seed: string): { bg: string; text: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) % 2
  return hash === 0
    ? { bg: 'bg-violet-50', text: 'text-violet-500' }
    : { bg: 'bg-magenta-50', text: 'text-magenta-500' }
}

export function PagoCard({ pago, proveedorNombre, onEdit, onDelete }: PagoCardProps) {
  const palette = pickChipPalette(pago.proveedor_id)

  return (
    <div
      data-testid={`pago-card-${pago.id}`}
      className="flex items-center gap-3.5 py-3.5 font-inter"
    >
      <div
        aria-hidden="true"
        className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-chip text-xs font-bold ${palette.bg} ${palette.text}`}
      >
        {proveedorNombre ? getInitials(proveedorNombre) : <CreditCard className="h-4 w-4" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-soft">
            Pago al proveedor
          </span>
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-ink">
          {proveedorNombre ?? 'Proveedor'}
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">{pago.fecha}</p>
      </div>

      <MetodoBadge metodo={pago.metodo} />

      <p className="w-24 shrink-0 text-right text-sm font-bold tabular-nums text-success">
        -{formatMonto(pago.monto)}
      </p>

      {pago.comprobante_url && (
        <a
          href={pago.comprobante_url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Ver comprobante"
          className="shrink-0 rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-violet-50 hover:text-violet-500"
        >
          <ExternalLink className="h-4 w-4" />
        </a>
      )}

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(pago)}
          aria-label="Editar"
          className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-violet-50 hover:text-violet-500"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(pago)}
          aria-label={`Eliminar pago ${pago.id}`}
          className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-danger-bg hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default PagoCard
