/**
 * Purchases-by-period panel for one supplier (C-38).
 *
 * Mounted inside `ProveedorDetailPage`, which passes nothing but the id —
 * the page gains no statistics logic of its own (design.md Risks). The
 * panel owns its own range instance via `useRangoGranularidad`, so it does
 * NOT share state with the estadísticas screen (design.md D3).
 *
 * Every number rendered here came from the endpoint. Nothing is summed,
 * averaged or re-bucketed on the way to the screen.
 */
import { useRangoGranularidad } from './utils/useRangoGranularidad'
import { useCompras } from './api/estadisticasHooks'
import { etiquetaPeriodo } from './utils/etiquetas'
import { RangoGranularidadSelector } from './components/RangoGranularidadSelector'
import { SerieBarras } from './components/SerieBarras'
import { EstadisticasError } from './components/EstadisticasError'

interface PanelComprasProveedorProps {
  proveedorId: string
}

export function PanelComprasProveedor({ proveedorId }: PanelComprasProveedorProps) {
  const { rango, setRango } = useRangoGranularidad('compras')
  const { data, isPending, isError, error } = useCompras({ ...rango, proveedorId })

  return (
    <section aria-label="Compras por período" className="flex flex-col gap-3">
      <RangoGranularidadSelector rango={rango} onChange={setRango} />

      {isError ? (
        <EstadisticasError error={error} />
      ) : (
        <SerieBarras
          titulo="Compras por período"
          isLoading={isPending}
          datos={data?.periodos.map((p) => ({
            etiqueta: etiquetaPeriodo(p.periodo, data.granularidad),
            valor: p.total,
          }))}
        />
      )}
    </section>
  )
}

export default PanelComprasProveedor
