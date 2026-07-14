/**
 * Raw Axios calls for the proveedores (suppliers) API.
 *
 * All calls go through the shared client (withCredentials + 401 interceptor).
 * saldo is NEVER computed here — it arrives from the backend (RN-SALDO).
 */
import { apiClient } from '@shared/api/client'
import type {
  Proveedor,
  ProveedorCreate,
  ProveedorUpdate,
  ProveedorDeleteResponse,
  ProveedorListItem,
} from '@shared/api/api'

export interface ListProveedoresParams {
  page?: number
  orderBy?: 'nombre' | 'saldo'
}

export async function listProveedores(
  params: ListProveedoresParams = {},
): Promise<ProveedorListItem[]> {
  const { page = 1, orderBy = 'nombre' } = params
  const res = await apiClient.get<ProveedorListItem[]>('/proveedores', {
    params: { page, order_by: orderBy },
  })
  return res.data
}

export async function getProveedor(id: string): Promise<Proveedor> {
  const res = await apiClient.get<Proveedor>(`/proveedores/${id}`)
  return res.data
}

export async function createProveedor(data: ProveedorCreate): Promise<Proveedor> {
  const res = await apiClient.post<Proveedor>('/proveedores', data)
  return res.data
}

export async function updateProveedor(id: string, data: ProveedorUpdate): Promise<Proveedor> {
  const res = await apiClient.patch<Proveedor>(`/proveedores/${id}`, data)
  return res.data
}

export async function deleteProveedor(id: string): Promise<ProveedorDeleteResponse> {
  const res = await apiClient.delete<ProveedorDeleteResponse>(`/proveedores/${id}`)
  return res.data
}

export async function buscarProveedores(nombre: string): Promise<ProveedorListItem[]> {
  const res = await apiClient.get<ProveedorListItem[]>('/proveedores/buscar', {
    params: { nombre },
  })
  return res.data
}
