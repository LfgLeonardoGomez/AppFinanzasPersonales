/**
 * Purchases vs. sales for one range (C-38).
 *
 * The third value is `diferencia` and is labelled exactly that. It is NOT a
 * margin: the system does not know what the goods it sold cost — a supplier
 * invoice is the shop's own purchase, not the cost of any particular sale
 * (C-37 D6). Calling it "margen" or "rentabilidad" would be a made-up
 * number wearing an accounting label, and it would look perfectly credible.
 *
 * Takes its range as props rather than reading the URL itself: on the
 * estadísticas screen it shares ONE selector with the sales panel, so the
 * page owns the range and hands it down.
 */
import { useResumen } from './api/estadisticasHooks'
import { EstadisticasError } from './components/EstadisticasError'
import { Card } from '@shared/components/Card/Card'
import { formatMonto } from '@shared/utils/currency'

interface PanelContrasteProps {
  desde: string
  hasta: string
}

export function PanelContraste({ desde, hasta }: PanelContrasteProps) {
  const { data, isPending, isError, error } = useResumen({ desde, hasta })

  if (isError) {
    return <EstadisticasError error={error} />
  }

  return (
    <section
      aria-label="Compras contra ventas"
      className="flex flex-col gap-3"
    >
      <Card className="flex flex-col gap-3 font-inter" hover={false}>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Compras contra ventas
        </p>

        {isPending || !data ? (
          <div
            role="status"
            aria-busy="true"
            aria-label="Calculando el contraste…"
            className="flex flex-col gap-2"
          >
            <div className="h-7 w-40 animate-shimmer rounded-md bg-navy-100 dark:bg-zinc-800" />
            <div className="h-4 w-56 animate-shimmer rounded-md bg-navy-100 dark:bg-zinc-800" />
          </div>
        ) : (
          <dl className="flex flex-wrap gap-x-8 gap-y-2">
            <div className="flex flex-col">
              <dt className="text-sm text-ink-soft">Compras</dt>
              <dd
                data-testid="contraste-compras"
                className="text-xl font-bold tabular-nums text-ink"
              >
                {formatMonto(data.compras)}
              </dd>
            </div>

            <div className="flex flex-col">
              <dt className="text-sm text-ink-soft">Ventas</dt>
              <dd
                data-testid="contraste-ventas"
                className="text-xl font-bold tabular-nums text-ink"
              >
                {formatMonto(data.ventas)}
              </dd>
            </div>

            <div className="flex flex-col">
              <dt className="text-sm text-ink-soft">Diferencia</dt>
              <dd
                data-testid="contraste-diferencia"
                className="text-xl font-bold tabular-nums text-ink"
              >
                {formatMonto(data.diferencia)}
              </dd>
            </div>
          </dl>
        )}
      </Card>
    </section>
  )
}

export default PanelContraste
