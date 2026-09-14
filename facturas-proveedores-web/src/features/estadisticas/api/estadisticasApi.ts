/**
 * API layer for /api/estadisticas (C-38, consuming C-37).
 *
 * Read-only: these three endpoints aggregate on demand and persist nothing
 * (RN-VTA-05). Every response goes through `estadisticasParse` so the rest
 * of the app never sees a Decimal-string.
 *
 * `proveedor_id` is OMITTED rather than sent empty when the call is not
 * scoped to a supplier: the backend treats it as optional, and an empty
 * value would be asking for a supplier whose id is the empty string.
 */
import { apiClient } from '@shared/api/client'
import type { VentasResponse, ResumenResponse, Granularidad } from '@shared/api/api'
import {
  parseVentas,
  parseResumen,
  type RawVentasResponse,
  type RawResumenResponse,
} from './estadisticasParse'

export interface RangoGranularidad {
  desde: string
  hasta: string
  granularidad: Granularidad
}

export type VentasQuery = RangoGranularidad

export interface ResumenQuery {
  desde: string
  hasta: string
}

export async function getVentas(query: VentasQuery): Promise<VentasResponse> {
  const res = await apiClient.get<RawVentasResponse>('/estadisticas/ventas', {
    params: {
      desde: query.desde,
      hasta: query.hasta,
      granularidad: query.granularidad,
    },
  })
  return parseVentas(res.data)
}

export async function getResumen(query: ResumenQuery): Promise<ResumenResponse> {
  const res = await apiClient.get<RawResumenResponse>('/estadisticas/resumen', {
    params: {
      desde: query.desde,
      hasta: query.hasta,
    },
  })
  return parseResumen(res.data)
}
