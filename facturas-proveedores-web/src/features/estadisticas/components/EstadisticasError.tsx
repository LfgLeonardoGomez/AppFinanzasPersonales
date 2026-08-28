/**
 * Error surface for the estadísticas views (C-38, design.md D5).
 *
 * Purely presentational: it receives whatever the query threw and turns it
 * into copy. The classification lives in `clasificarErrorEstadisticas`.
 *
 * The period-cap 422 gets the most careful copy of the four, because it is
 * the only one that is not a failure at all — the backend is explaining how
 * to ask correctly, and it sends the numbers to say how much smaller the
 * request should be. "Something went wrong" would throw that away.
 */
import { Card } from '@shared/components/Card/Card'
import { clasificarErrorEstadisticas } from '../utils/clasificarError'

interface EstadisticasErrorProps {
  error: unknown
}

export function EstadisticasError({ error }: EstadisticasErrorProps) {
  const clasificado = clasificarErrorEstadisticas(error)

  return (
    <Card className="flex flex-col gap-2 font-inter" hover={false}>
      <div role="alert" className="flex flex-col gap-1">
        {clasificado.tipo === 'tope-excedido' && (
          <>
            <p className="text-sm font-semibold text-ink">
              El rango es demasiado grande para esta granularidad
            </p>
            <p className="text-sm text-ink-soft">
              Produciría{' '}
              <span className="font-semibold tabular-nums text-ink">
                {clasificado.periodosEstimados}
              </span>{' '}
              períodos y el máximo es{' '}
              <span className="font-semibold tabular-nums text-ink">{clasificado.tope}</span>.
              Acortá el rango o elegí una granularidad mayor.
            </p>
          </>
        )}

        {clasificado.tipo === 'rango-invertido' && (
          <>
            <p className="text-sm font-semibold text-ink">El rango no es válido</p>
            <p className="text-sm text-ink-soft">
              La fecha de inicio es posterior a la de fin. Corregí las fechas para ver los datos.
            </p>
          </>
        )}

        {clasificado.tipo === 'proveedor-inexistente' && (
          <>
            <p className="text-sm font-semibold text-ink">Este proveedor no existe</p>
            <p className="text-sm text-ink-soft">
              No se encontró el proveedor solicitado.
            </p>
          </>
        )}

        {clasificado.tipo === 'desconocido' && (
          <>
            <p className="text-sm font-semibold text-ink">No se pudieron cargar las estadísticas</p>
            <p className="text-sm text-ink-soft">
              Volvé a intentar en unos segundos. Si sigue pasando, revisá tu conexión.
            </p>
          </>
        )}
      </div>
    </Card>
  )
}

export default EstadisticasError
