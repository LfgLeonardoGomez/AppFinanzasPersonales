/**
 * Raw Axios calls for the customers (clientes) API (C-32 backend, C-34 frontend).
 *
 * All calls go through the shared client (withCredentials + 401 interceptor).
 * Identity — which names count as "the same person" — is decided exclusively
 * by the backend (design.md D8, `app/core/normalizacion.py`). This layer
 * implements no normalization, no fuzzy matching, no client-side re-ranking:
 * it sends fragments trimmed and returns results in the order the server sent
 * them.
 */
import { apiClient } from '@shared/api/client'
import type { Cliente, ClienteCreate, ClienteListItem } from '@shared/api/api'

export async function listClientes(): Promise<ClienteListItem[]> {
  const res = await apiClient.get<ClienteListItem[]>('/clientes')
  return res.data
}

/**
 * Autocomplete search (RN-CLI-02). The backend returns the exact normalized
 * match first, then partial matches — this function does NOT re-sort,
 * re-rank, or filter the response.
 */
export async function buscarClientes(fragment: string): Promise<ClienteListItem[]> {
  const res = await apiClient.get<ClienteListItem[]>('/clientes/buscar', {
    params: { nombre: fragment.trim() },
  })
  return res.data
}

/**
 * Create a customer from the name alone (RN-CLI-01). No `nombre_normalizado`,
 * no `negocio_id` — both are derived/assigned server-side.
 */
export async function crearCliente(data: ClienteCreate): Promise<Cliente> {
  const res = await apiClient.post<Cliente>('/clientes', data)
  return res.data
}
