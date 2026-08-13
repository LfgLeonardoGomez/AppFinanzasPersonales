/**
 * TotalesDelDia — the day's total plus its per-payment-method breakdown
 * (C-34, design.md D2).
 *
 * Purely presentational and purely derived: `ventas` is the SAME array the
 * list below it renders (never a second request — design.md D2), reduced
 * through `calcularTotalesDelDia`. This component owns no fetching.
 *
 * The totals region is ALWAYS present, from first render — while
 * `isLoading`, it shows a loading affordance instead of `$0`, because a zero
 * that means "not loaded yet" is indistinguishable from a zero that means
 * "you sold nothing today" (design.md D2), and only the second one is true.
 */
import { Card } from '@shared/components/Card/Card'
import { formatMonto } from '@shared/utils/currency'
import { calcularTotalesDelDia } from '../utils/totales'
import { FORMA_PAGO_LABELS } from '../utils/formaPagoLabels'
import type { VentaListItem, FormaPago } from '@shared/api/api'

interface TotalesDelDiaProps {
  ventas: VentaListItem[] | undefined
  isLoading: boolean
}

export function TotalesDelDia({ ventas, isLoading }: TotalesDelDiaProps) {
  if (isLoading) {
    return (
      <Card className="flex flex-col gap-2 font-inter" hover={false}>
        <div
          role="status"
          aria-busy="true"
          aria-label="Calculando totales…"
          className="flex flex-col gap-2"
        >
          <div className="h-7 w-32 animate-shimmer rounded-md bg-navy-100 dark:bg-zinc-800" />
          <div className="h-4 w-48 animate-shimmer rounded-md bg-navy-100 dark:bg-zinc-800" />
        </div>
      </Card>
    )
  }

  const { total, porFormaPago } = calcularTotalesDelDia(ventas ?? [])
  const breakdown = Object.entries(porFormaPago) as [FormaPago, number][]

  return (
    <Card className="flex flex-col gap-3 font-inter" hover={false}>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          Total del día
        </p>
        <p className="text-2xl font-bold tabular-nums text-ink">{formatMonto(total)}</p>
      </div>

      {breakdown.length > 0 && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {breakdown.map(([forma, monto]) => (
            <div key={forma} className="flex items-center gap-1.5">
              <dt className="text-ink-soft">{FORMA_PAGO_LABELS[forma]}</dt>
              <dd className="font-semibold tabular-nums text-ink">{formatMonto(monto)}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  )
}

export default TotalesDelDia
