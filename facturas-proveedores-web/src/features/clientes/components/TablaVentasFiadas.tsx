/**
 * TablaVentasFiadas — table of a customer's fiados with FIFO estado
 * (C-36, design.md D3).
 *
 * NOT a generalization of `TablaFacturasConEstado`. A fiado is a `Venta`:
 * it has no `numero`, no `fecha_vencimiento`, no `origen`, and never will —
 * a sale at a counter has no invoice number and no due date. Reuses the
 * supplier ledger's `badge-*` colour tokens (design.md D3) so the two
 * ledgers read as one visual system without sharing a component whose
 * columns would be half-optional.
 *
 * `EstadoVentaFiada` is `PENDIENTE | PARCIAL | COBRADA` — deliberately not
 * `PAGADA` (C-35's reason: a customer's sale reported as "paid" reads as
 * though the shop had paid it).
 */
import type { VentaConEstado, EstadoVentaFiada } from '@shared/api/api'
import { formatMonto } from '@shared/utils/currency'

interface TablaVentasFiadasProps {
  fiados: VentaConEstado[]
}

const ESTADO_STYLES: Record<EstadoVentaFiada, string> = {
  PENDIENTE:
    'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-inter text-[11px] font-bold uppercase tracking-wide bg-badge-pendiente-bg text-badge-pendiente-text',
  PARCIAL:
    'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-inter text-[11px] font-bold uppercase tracking-wide bg-badge-parcial-bg text-badge-parcial-text',
  COBRADA:
    'inline-flex items-center gap-1 rounded-pill px-2.5 py-0.5 font-inter text-[11px] font-bold uppercase tracking-wide bg-badge-pagada-bg text-badge-pagada-text',
}

export function TablaVentasFiadas({ fiados }: TablaVentasFiadasProps) {
  if (fiados.length === 0) {
    return (
      <p role="status" className="text-sm text-ink-soft">
        Sin fiados registrados.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-card-sm border border-border-subtle">
      <table className="w-full text-left text-sm" aria-label="Fiados con estado">
        <thead>
          <tr className="border-b border-border-subtle bg-page/40">
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Fecha
            </th>
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Monto
            </th>
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Estado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle-2">
          {fiados.map((f) => (
            <tr
              key={f.id}
              data-testid={`venta-fiada-row-${f.id}`}
              className="transition-colors hover:bg-page/30"
            >
              <td className="px-4 py-3 tabular-nums text-ink-soft-2">{f.fecha}</td>
              <td className="px-4 py-3 tabular-nums font-medium text-ink-soft-2">
                {formatMonto(f.monto)}
              </td>
              <td className="px-4 py-3">
                <span data-testid="venta-fiada-estado" className={ESTADO_STYLES[f.estado]}>
                  {f.estado}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default TablaVentasFiadas
