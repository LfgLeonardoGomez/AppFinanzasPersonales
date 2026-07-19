/**
 * PagosRegistrados — light table of the "Pagos" tab in the cuenta-corriente
 * toggle (Facturas / Pagos / Historial — Detalle Proveedor handoff).
 *
 * Derived from the existing `historial` array (tipo === 'PAGO') instead of
 * a new query: CuentaCorrientePage is purely presentational (no HTTP calls)
 * and the C-12 `cuenta-corriente` response already carries every payment's
 * `fecha` and `monto` (absolute value, sign lives in `tipo`). This keeps the
 * "Pagos" tab consistent with the "no invented backend capability" rule —
 * it does NOT show `metodo` (medio de pago), since that field is not part
 * of the cuenta-corriente response (only of the dedicated /api/pagos
 * resource). See ProveedorDetailPage's redesign report for this deviation
 * from the Claude Design handoff, which does show a "Medio" column.
 */
import type { EntradaHistorial } from '@shared/api/api'
import { formatMonto } from '@shared/utils/currency'

interface PagosRegistradosProps {
  pagos: EntradaHistorial[]
}

export function PagosRegistrados({ pagos }: PagosRegistradosProps) {
  if (pagos.length === 0) {
    return (
      <p role="status" className="text-sm text-ink-soft">
        No hay pagos registrados.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-card-sm border border-border-subtle">
      <table className="w-full text-left text-sm" aria-label="Pagos registrados">
        <thead>
          <tr className="border-b border-border-subtle bg-page/40">
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Fecha
            </th>
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Monto
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle-2">
          {pagos.map((p) => (
            <tr key={p.id} data-testid={`pagos-row-${p.id}`} className="transition-colors hover:bg-page/30">
              <td className="px-4 py-3 tabular-nums text-ink-soft-2">{p.fecha}</td>
              <td className="px-4 py-3 tabular-nums font-semibold text-success">
                -{formatMonto(p.monto)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default PagosRegistrados
