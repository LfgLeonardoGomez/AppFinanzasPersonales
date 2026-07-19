/**
 * Raw Axios calls for the Home screen's data.
 *
 * Two sources power the redesigned Home:
 *  - Proveedores frecuentes: reuses GET /proveedores?order_by=saldo (suppliers
 *    with the most debt first). The backend now returns `ultima_factura_fecha`
 *    on the list item, but the generated OpenAPI types are not regenerated yet
 *    — so we extend the type locally until `npm run gen:api` runs.
 *  - Actividad reciente: GET /actividad-reciente (merged facturas+pagos feed).
 *    No generated type exists yet either → local type below.
 *
 * saldo is NEVER computed here — it arrives from the backend (RN-SALDO).
 */
import { apiClient } from '@shared/api/client'
import type { ProveedorListItem } from '@shared/api/api'

/** ProveedorListItem + the new backend field (pending OpenAPI regen). */
export type ProveedorFrecuente = ProveedorListItem & {
  ultima_factura_fecha: string | null
}

/** One row of the merged recent-activity feed (GET /actividad-reciente). */
export interface ActividadRecienteItem {
  tipo: 'factura' | 'pago'
  id: string
  proveedor_id: string
  proveedor_nombre: string | null
  monto: string
  fecha: string
  created_at: string
}

export async function getProveedoresFrecuentes(limit = 6): Promise<ProveedorFrecuente[]> {
  const res = await apiClient.get<ProveedorFrecuente[]>('/proveedores', {
    params: { page: 1, order_by: 'saldo' },
  })
  return res.data.slice(0, limit)
}

export async function getActividadReciente(limit = 8): Promise<ActividadRecienteItem[]> {
  const res = await apiClient.get<ActividadRecienteItem[]>('/actividad-reciente', {
    params: { limit },
  })
  return res.data
}
