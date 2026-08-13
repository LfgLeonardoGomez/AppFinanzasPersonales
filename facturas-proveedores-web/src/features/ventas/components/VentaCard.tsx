/**
 * VentaCard — pure presentational row for a single sale (C-34).
 *
 * Mirrors `PagoCard`/`FacturasList`'s row rhythm. No data fetching —
 * `clienteNombre` is resolved and passed down by the parent `VentasList`
 * (design.md D3): `VentaListItem` carries only `cliente_id`, never a name.
 *
 * The amount is shown WITHOUT a leading "-": unlike `PagoCard` (money going
 * OUT to a supplier), a venta is money coming IN.
 */
import type { VentaListItem } from '@shared/api/api'
import { FormaPagoBadge } from './FormaPagoBadge'
import { formatMonto } from '@shared/utils/currency'
import { Pencil, Trash2, User } from 'lucide-react'

interface VentaCardProps {
  venta: VentaListItem
  clienteNombre?: string | undefined
  onEdit: (venta: VentaListItem) => void
  onDelete: (venta: VentaListItem) => void
}

export function VentaCard({ venta, clienteNombre, onEdit, onDelete }: VentaCardProps) {
  return (
    <div
      data-testid={`venta-card-${venta.id}`}
      className="flex items-center gap-3.5 py-3.5 font-inter"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-semibold text-ink">{venta.fecha}</p>
          {venta.cliente_id && (
            <span className="inline-flex items-center gap-1 text-xs text-ink-soft">
              <User className="h-3 w-3" aria-hidden="true" />
              {/* design.md D3: a sale whose customer isn't in the resolved
                  id→name map renders a neutral placeholder, never the UUID. */}
              {clienteNombre ?? 'Cliente'}
            </span>
          )}
        </div>
        {venta.notas && <p className="mt-0.5 truncate text-xs text-ink-soft">{venta.notas}</p>}
      </div>

      <FormaPagoBadge formaPago={venta.forma_pago} />

      <p className="w-24 shrink-0 text-right text-sm font-bold tabular-nums text-success">
        {formatMonto(venta.monto)}
      </p>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={() => onEdit(venta)}
          aria-label={`Editar venta ${venta.id}`}
          className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-violet-50 hover:text-violet-500"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onDelete(venta)}
          aria-label={`Eliminar venta ${venta.id}`}
          className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-danger-bg hover:text-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

export default VentaCard
