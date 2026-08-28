/**
 * Bar series for the estadísticas views (C-38, design.md D1).
 *
 * SVG via visx, never canvas. The reason is not aesthetic: the test suite
 * runs under `jsdom` with no `canvas` package, where `getContext('2d')`
 * returns `null` — a canvas chart would render nothing assertable, and the
 * project has no browser-based e2e tier to fall back on. These `<rect>`s
 * are real DOM nodes.
 *
 * The chart ILLUSTRATES; the list INFORMS. `role="img"` makes an SVG's
 * internals presentational to assistive technology, so a `<title>` per bar
 * would not be reliably announced. The `<ul>` underneath carries every value
 * as text — which is also what makes "the breakdown adds up to the total"
 * something a test can read rather than infer.
 *
 * This component TRANSFORMS NOTHING. It receives the series already shaped
 * and scales it for drawing; it never sums, re-buckets, or drops a period.
 */
import { Bar } from '@visx/shape'
import { scaleBand, scaleLinear } from '@visx/scale'
import { Card } from '@shared/components/Card/Card'
import { formatMonto } from '@shared/utils/currency'

export interface PuntoSerie {
  etiqueta: string
  valor: number
}

interface SerieBarrasProps {
  titulo: string
  datos: PuntoSerie[] | undefined
  isLoading?: boolean
}

const ALTO = 180
const ANCHO = 640
const PADDING_INFERIOR = 4

export function SerieBarras({ titulo, datos, isLoading = false }: SerieBarrasProps) {
  if (isLoading || !datos) {
    return (
      <Card className="flex flex-col gap-3 font-inter" hover={false}>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{titulo}</p>
        <div
          role="status"
          aria-busy="true"
          aria-label="Cargando estadísticas…"
          className="flex flex-col gap-2"
        >
          <div className="h-[180px] w-full animate-shimmer rounded-md bg-navy-100 dark:bg-zinc-800" />
          <div className="h-4 w-48 animate-shimmer rounded-md bg-navy-100 dark:bg-zinc-800" />
        </div>
      </Card>
    )
  }

  const maximo = datos.reduce((max, d) => Math.max(max, d.valor), 0)
  const sinMovimiento = maximo === 0

  const xScale = scaleBand<string>({
    domain: datos.map((d) => d.etiqueta),
    range: [0, ANCHO],
    padding: 0.2,
  })

  // `maximo || 1` keeps the scale valid on an all-zero series: a zero domain
  // makes every height NaN, which drops the bars from the DOM entirely and
  // would look exactly like a broken chart.
  const yScale = scaleLinear<number>({
    domain: [0, maximo || 1],
    range: [ALTO - PADDING_INFERIOR, 0],
    nice: true,
  })

  return (
    <Card className="flex flex-col gap-3 font-inter" hover={false}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{titulo}</p>

      {!sinMovimiento && (
        <svg
          role="img"
          aria-label={titulo}
          viewBox={`0 0 ${ANCHO} ${ALTO}`}
          preserveAspectRatio="none"
          className="h-[180px] w-full"
        >
          {datos.map((d) => {
            const x = xScale(d.etiqueta) ?? 0
            const y = yScale(d.valor)
            const height = Math.max(ALTO - PADDING_INFERIOR - y, 0)
            return (
              <Bar
                key={d.etiqueta}
                data-bar=""
                x={x}
                y={y}
                width={xScale.bandwidth()}
                height={height}
                rx={3}
                className="fill-violet-500"
              />
            )
          })}
        </svg>
      )}

      {sinMovimiento && (
        <p className="text-sm text-ink-soft">
          Sin movimiento en el rango seleccionado.
        </p>
      )}

      <ul
        aria-label={`Valores de ${titulo}`}
        className="flex flex-wrap gap-x-6 gap-y-1 text-sm"
      >
        {datos.map((d) => (
          <li key={d.etiqueta} className="flex items-center gap-1.5">
            <span className="text-ink-soft">{d.etiqueta}</span>
            <span className="font-semibold tabular-nums text-ink">{formatMonto(d.valor)}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export default SerieBarras
