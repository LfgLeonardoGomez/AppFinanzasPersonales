/**
 * Range + granularity state for an estadísticas view (C-38, design.md D3).
 *
 * The state lives in the SEARCH PARAMS of the route this hook is called
 * from — not in a global store. "Shared" means the same piece of UI, not the
 * same value synced across screens: with a store, opening a supplier's ficha
 * would move the range on the estadísticas screen and vice versa, coupling
 * nobody asked for. Search params also make each view linkable and
 * refresh-proof, which is the pattern `VentasPage` already uses (C-34 D9).
 *
 * `granularidad` is validated against the closed enum on the way IN: a
 * hand-edited URL carrying `granularidad=trimestre` must not be forwarded to
 * the API to collect an opaque 422.
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Granularidad } from '@shared/api/api'
import { getTodayInArgentina } from '@shared/utils/date'
import { rangoPorDefecto, type RangoEstadisticas } from './rangos'

const GRANULARIDADES: readonly Granularidad[] = ['dia', 'semana', 'mes']

function esGranularidad(value: string | null): value is Granularidad {
  return value !== null && (GRANULARIDADES as readonly string[]).includes(value)
}

export interface UseRangoGranularidad {
  rango: RangoEstadisticas
  setRango: (rango: RangoEstadisticas) => void
}

export function useRangoGranularidad(
  hoy: string = getTodayInArgentina(),
): UseRangoGranularidad {
  const [searchParams, setSearchParams] = useSearchParams()

  const rango = useMemo<RangoEstadisticas>(() => {
    const porDefecto = rangoPorDefecto(hoy)
    const granularidadParam = searchParams.get('granularidad')

    return {
      desde: searchParams.get('desde') ?? porDefecto.desde,
      hasta: searchParams.get('hasta') ?? porDefecto.hasta,
      granularidad: esGranularidad(granularidadParam)
        ? granularidadParam
        : porDefecto.granularidad,
    }
  }, [searchParams, hoy])

  const setRango = useCallback(
    (siguiente: RangoEstadisticas) => {
      setSearchParams(
        (previos) => {
          const next = new URLSearchParams(previos)
          next.set('desde', siguiente.desde)
          next.set('hasta', siguiente.hasta)
          next.set('granularidad', siguiente.granularidad)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return { rango, setRango }
}
