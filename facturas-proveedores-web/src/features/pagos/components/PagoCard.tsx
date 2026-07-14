/**
 * PagoCard — pure presentational card for a single payment.
 *
 * Premium redesign: double-bezel feel with subtle hover lift and iconography.
 */
import type { PagoListItem } from '@shared/api/api'
import { MetodoBadge } from './MetodoBadge'
import { formatMonto } from '@shared/utils/currency'
import { Pencil, Trash2, ExternalLink, CreditCard } from 'lucide-react'

interface PagoCardProps {
  pago: PagoListItem & { comprobante_url?: string | null }
  onEdit: (pago: PagoListItem) => void
  onDelete: (pago: PagoListItem) => void
}

export function PagoCard({ pago, onEdit, onDelete }: PagoCardProps) {
  return (
    <div
      data-testid={`pago-card-${pago.id}`}
      className="group flex flex-col gap-3 rounded-2xl bg-white p-5 shadow-[0_2px_8px_rgba(10,37,64,0.04)] ring-1 ring-black/[0.04] transition-all duration-300 ease-[var(--ease-out)] hover:shadow-[0_8px_24px_rgba(10,37,64,0.10)] dark:bg-card-dark dark:ring-white/10 dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.30)]"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-50 text-navy-500 ring-1 ring-black/[0.04] dark:bg-navy-800/30 dark:text-navy-300 dark:ring-white/5">
            <CreditCard className="h-4 w-4" />
          </div>
          <span className="text-xs font-semibold uppercase tracking-wide text-navy-400 dark:text-zinc-500">
            Pago al proveedor
          </span>
        </div>
        <MetodoBadge metodo={pago.metodo} />
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="font-serif text-2xl font-semibold tracking-tight text-navy-800 dark:text-zinc-100">
            {formatMonto(pago.monto)}
          </p>
          <p className="mt-0.5 text-xs text-navy-400 dark:text-zinc-500">{pago.fecha}</p>
        </div>
      </div>

      {pago.comprobante_url && (
        <a
          href={pago.comprobante_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-accent-500 transition-colors hover:text-accent-600 dark:text-accent-400"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Ver comprobante
        </a>
      )}

      <div className="mt-1 flex items-center gap-2 border-t border-black/[0.04] pt-3 dark:border-white/5">
        <button
          type="button"
          onClick={() => onEdit(pago)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-navy-600 transition-colors hover:bg-navy-50 dark:text-zinc-300 dark:hover:bg-white/[0.04]"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </button>
        <button
          type="button"
          onClick={() => onDelete(pago)}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-bg dark:hover:bg-danger/10"
          aria-label={`Eliminar pago ${pago.id}`}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Eliminar
        </button>
      </div>
    </div>
  )
}

export default PagoCard
