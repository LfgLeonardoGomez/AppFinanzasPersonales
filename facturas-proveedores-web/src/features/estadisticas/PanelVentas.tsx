/**
 * Sales-by-period panel with its payment-method breakdown (C-38).
 *
 * The `total` shown for a period is the one the backend sent — never the
 * sum of the breakdown rendered next to it. The backend already guarantees
 * `sum(desglose) === total` because it computes both from the same grouped
 * rows; re-deriving it here would create a second implementation of that
 * sum, and two implementations of one number eventually disagree.
 *
 * Labels come from `FORMA_PAGO_LABELS` (C-34): a shouted `CUENTA_CORRIENTE`
 * in prose reads as a bug, not as a label.
 */
import { useVentasEstadisticas } from './api/estadisticasHooks'
import { etiquetaPeriodo } from './utils/etiquetas'
import { SerieBarras } from './components/SerieBarras'
import { EstadisticasError } from './components/EstadisticasError'
import { Card } from '@shared/components/Card/Card'
import { formatMonto } from '@shared/utils/currency'
import { FORMA_PAGO_LABELS } from '@features/ventas/utils/formaPagoLabels'
import type { FormaPago, VentaPeriodo, Granularidad } from '@shared/api/api'
import type { RangoEstadisticas } from './utils/rangos'

interface PanelVentasProps {
  rango: RangoEstadisticas
}

/**
 * CONTROLLED on purpose: it receives the range instead of reading the URL
 * itself, because on `/estadisticas` it shares ONE selector with the
 * contraste panel (design.md D2). A panel that owned its own selector could
 * not be put under a shared one without showing two.
 */
export function PanelVentas({ rango }: PanelVentasProps) {
  const { data, isPending, isError, error } = useVentasEstadisticas(rango)

  return (
    <section aria-label="Ventas por período" className="flex flex-col gap-3">
      {isError ? (
        <EstadisticasError error={error} />
      ) : (
        <>
          <SerieBarras
            titulo="Ventas por período"
            isLoading={isPending}
            datos={data?.periodos.map((p) => ({
              etiqueta: etiquetaPeriodo(p.periodo, data.granularidad),
              valor: p.total,
            }))}
          />

          {data?.periodos.map((periodo) => (
            <DesglosePeriodo
              key={periodo.periodo}
              periodo={periodo}
              granularidad={data.granularidad}
            />
          ))}
        </>
      )}
    </section>
  )
}

interface DesglosePeriodoProps {
  periodo: VentaPeriodo
  granularidad: Granularidad
}

function DesglosePeriodo({ periodo, granularidad }: DesglosePeriodoProps) {
  const entradas = Object.entries(periodo.desglose) as [FormaPago, number][]

  return (
    <Card className="flex flex-col gap-3 font-inter" hover={false}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          {etiquetaPeriodo(periodo.periodo, granularidad)}
        </p>
        <p data-testid="periodo-total" className="text-2xl font-bold tabular-nums text-ink">
          {formatMonto(periodo.total)}
        </p>
      </div>

      <ul
        aria-label={`Desglose por forma de pago — ${etiquetaPeriodo(periodo.periodo, granularidad)}`}
        className="flex flex-wrap gap-x-6 gap-y-1 text-sm"
      >
        {entradas.map(([forma, monto]) => (
          <li key={forma} className="flex items-center gap-1.5">
            <span className="text-ink-soft">{FORMA_PAGO_LABELS[forma]}</span>
            <span
              data-testid="desglose-monto"
              className="font-semibold tabular-nums text-ink"
            >
              {formatMonto(monto)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default PanelVentas
