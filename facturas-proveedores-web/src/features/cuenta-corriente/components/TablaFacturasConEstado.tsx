/**
 * TablaFacturasConEstado — premium table of facturas_con_estado for cuenta-corriente.
 *
 * Preserves all test contracts:
 *  - data-testid={`tabla-facturas-row-${f.id}`}
 *  - FiltrosFacturas id="filtro-estado" + label "Estado"
 *  - "No hay facturas con esos filtros." text
 *  - "Limpiar filtros" button
 *
 * C-24: "Ver archivo" opens the shared ArchivoPreviewDialog in-app instead
 * of navigating to a new tab via <a target="_blank"> — cloudinary_signer.py
 * allows both images and PDFs for the factura preset, so the file may be
 * either. One dialog instance is reused for the whole table; clicking a
 * different row's button swaps the previewed URL.
 */
import { useMemo, useState } from 'react'
import { EstadoBadge } from '@features/facturas/components/EstadoBadge'
import { FiltrosFacturas } from './FiltrosFacturas'
import { formatMonto } from '@shared/utils/currency'
import { ExternalLink } from 'lucide-react'
import { ArchivoPreviewDialog } from '@shared/components/ArchivoPreviewDialog/ArchivoPreviewDialog'
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
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null)

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
                    <button
                      type="button"
                      onClick={() =>
                        setPreview({
                          url: f.archivo_url!,
                          title: `Factura ${f.numero ?? f.id}`,
                        })
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-violet-500 transition-colors hover:text-violet-600"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver archivo
                    </button>
                  ) : (
                    <span className="text-ink-soft">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ArchivoPreviewDialog
        url={preview?.url ?? null}
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null)
        }}
        title={preview?.title}
      />
    </div>
  )
}

export default TablaFacturasConEstado
