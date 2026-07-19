/**
 * TablaFacturasConEstado — premium table of facturas_con_estado for cuenta-corriente.
 *
 * Preserves all test contracts:
 *  - data-testid={`tabla-facturas-row-${f.id}`}
 *  - FiltrosFacturas id="filtro-estado" + label "Estado"
 *  - "No hay facturas con esos filtros." text
 *  - "Limpiar filtros" button
 */
import { useMemo } from 'react'
import { EstadoBadge } from '@features/facturas/components/EstadoBadge'
import { FiltrosFacturas } from './FiltrosFacturas'
import { formatMonto } from '@shared/utils/currency'
import { ExternalLink } from 'lucide-react'
import type {
  FacturaConEstado,
  FiltrosFacturas as FiltrosFacturasType,
} from '@shared/api/api'

interface TablaFacturasConEstadoProps {
  facturas: FacturaConEstado[]
  filters: FiltrosFacturasType
  onChangeFilters: (next: FiltrosFacturasType) => void
}

function applyFilters(
  facturas: FacturaConEstado[],
  filters: FiltrosFacturasType,
): FacturaConEstado[] {
  return facturas.filter((f) => {
    if (filters.estado && f.estado !== filters.estado) return false
    if (filters.fecha_desde && f.fecha_emision < filters.fecha_desde) return false
    if (filters.fecha_hasta && f.fecha_emision > filters.fecha_hasta) return false
    return true
  })
}

export function TablaFacturasConEstado({
  facturas,
  filters,
  onChangeFilters,
}: TablaFacturasConEstadoProps) {
  const filtered = useMemo(() => applyFilters(facturas, filters), [facturas, filters])

  if (filtered.length === 0) {
    return (
      <div>
        <FiltrosFacturas filters={filters} onChange={onChangeFilters} />
        <div className="mt-4 rounded-card-sm bg-page/40 p-4 text-center ring-1 ring-border-subtle">
          <p role="status" className="text-sm text-ink-soft">
            No hay facturas con esos filtros.
          </p>
          <button
            type="button"
            onClick={() => onChangeFilters({})}
            className="mt-2 text-sm font-semibold text-violet-500 transition-colors hover:text-violet-600"
          >
            Limpiar filtros
          </button>
        </div>
      </div>
    )
  }

  return (
    <div>
      <FiltrosFacturas filters={filters} onChange={onChangeFilters} />

      <div className="mt-4 overflow-hidden rounded-card-sm border border-border-subtle">
        <table className="w-full text-left text-sm" aria-label="Facturas con estado">
          <thead>
            <tr className="border-b border-border-subtle bg-page/40">
              <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Número
              </th>
              <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Fecha emisión
              </th>
              <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Monto
              </th>
              <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Estado
              </th>
              <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Archivo
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle-2">
            {filtered.map((f) => (
              <tr
                key={f.id}
                data-testid={`tabla-facturas-row-${f.id}`}
                className="transition-colors hover:bg-page/30"
              >
                <td className="px-4 py-3 font-medium text-ink">
                  {f.numero ?? '—'}
                </td>
                <td className="px-4 py-3 tabular-nums text-ink-soft-2">
                  {f.fecha_emision}
                </td>
                <td className="px-4 py-3 tabular-nums font-medium text-ink-soft-2">
                  {formatMonto(f.monto_total)}
                </td>
                <td className="px-4 py-3">
                  <EstadoBadge estado={f.estado} />
                </td>
                <td className="px-4 py-3">
                  {f.archivo_url ? (
                    <a
                      href={f.archivo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-violet-500 transition-colors hover:text-violet-600"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver archivo
                    </a>
                  ) : (
                    <span className="text-ink-soft">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default TablaFacturasConEstado
