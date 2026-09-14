/**
 * Classifies an estadísticas request failure into something the UI can act
 * on (C-38, design.md D5).
 *
 * The backend already emits the distinction natively:
 *   - period cap exceeded → 422 with a structured OBJECT detail
 *     (`mensaje`, `periodos_estimados`, `tope`, `sugerencia`)
 *   - inverted range      → 422 with a plain STRING detail
 *
 * We classify on that SHAPE, never on the Spanish prose: matching text would
 * break the day someone fixes an accent in the backend's message, and it
 * would break silently — the user would just start seeing "unexpected
 * error" where an actionable instruction used to be.
 *
 * The cap 422 is not a failure. It is the backend explaining how to ask
 * correctly, and it carries the numbers needed to say how much smaller the
 * range should be.
 *
 * `proveedor-inexistente` retired in C-44 alongside `PanelComprasProveedor`
 * — its only caller, the one that ever sent `proveedor_id`. The two
 * endpoints still consumed here (`/ventas`, `/resumen`) never receive one,
 * so a 404 is not a case this classifier specifically recognizes anymore —
 * it falls through to `desconocido`, same as any other unrecognized shape.
 */
import { isAxiosError } from 'axios'
import type { TopeExcedidoDetail } from '@shared/api/api'

export type ErrorEstadisticas =
  | { tipo: 'tope-excedido'; periodosEstimados: number; tope: number; sugerencia: string }
  | { tipo: 'rango-invertido' }
  | { tipo: 'desconocido' }

export function clasificarErrorEstadisticas(error: unknown): ErrorEstadisticas {
  if (!isAxiosError(error) || !error.response) {
    return { tipo: 'desconocido' }
  }

  const { status, data } = error.response
  const detail: unknown = (data as { detail?: unknown } | undefined)?.detail

  if (status === 422) {
    if (isTopeExcedidoDetail(detail)) {
      return {
        tipo: 'tope-excedido',
        periodosEstimados: detail.periodos_estimados,
        tope: detail.tope,
        sugerencia: detail.sugerencia,
      }
    }
    if (typeof detail === 'string') {
      return { tipo: 'rango-invertido' }
    }
  }

  return { tipo: 'desconocido' }
}

/**
 * Deliberately stricter than "is an object".
 *
 * FastAPI's own request-validation errors are ALSO 422, with an ARRAY
 * detail — and `typeof [] === 'object'`. A loose check would report a
 * malformed date parameter to the user as "your range is too big", sending
 * them off to shrink a range that was never the problem.
 */
function isTopeExcedidoDetail(detail: unknown): detail is TopeExcedidoDetail {
  return (
    typeof detail === 'object' &&
    detail !== null &&
    !Array.isArray(detail) &&
    typeof (detail as TopeExcedidoDetail).periodos_estimados === 'number' &&
    typeof (detail as TopeExcedidoDetail).tope === 'number'
  )
}
