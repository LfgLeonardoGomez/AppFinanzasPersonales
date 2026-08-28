/**
 * Estadísticas screen (C-38, design.md D2).
 *
 * Hosts the sales series and the purchases-vs-sales contrast under ONE
 * range + granularity selector, whose state lives in this route's search
 * params.
 *
 * It is a SEPARATE route from `VentasPage` on purpose. `VentasPage` already
 * writes `desde`/`hasta` into its own search params, where they mean
 * "filter the list of sales" and default to today. Hosting the statistics
 * there would put two different meanings on the same two parameters of the
 * same URL: the user would move the chart's range and watch the list below
 * it filter itself, or the reverse — and neither is what they asked for.
 *
 * The supplier-scoped purchases panel does NOT live here: it belongs to a
 * supplier's ficha, and it carries its own independent range.
 */
import { useRangoGranularidad } from './utils/useRangoGranularidad'
import { RangoGranularidadSelector } from './components/RangoGranularidadSelector'
import { PanelVentas } from './PanelVentas'
import { PanelContraste } from './PanelContraste'

export function EstadisticasPage() {
  const { rango, setRango } = useRangoGranularidad('ventas')

  return (
    <div data-testid="estadisticas-page" className="flex flex-col gap-5">
      <div>
        <p className="text-[11.5px] font-semibold uppercase tracking-wider text-ink-soft">
          Negocio
        </p>
        <h1 className="mt-1 font-inter text-2xl font-bold tracking-tight text-ink dark:text-zinc-100">
          Estadísticas
        </h1>
      </div>

      <RangoGranularidadSelector rango={rango} onChange={setRango} />

      <PanelContraste desde={rango.desde} hasta={rango.hasta} />
      <PanelVentas rango={rango} />
    </div>
  )
}

export default EstadisticasPage
