/**
 * Raw Axios calls for the proveedores (suppliers) API.
 *
 * All calls go through the shared client (withCredentials + 401 interceptor).
 * saldo is NEVER computed here — it arrives from the backend (RN-SALDO).
 *
 * INVARIANT (C-41, D3, D9): the backend serializes `saldo` as a Pydantic-v2
 * Decimal STRING. `parseProveedor` / `parseProveedorListItem` convert it to
 * the `number` the public `Proveedor` / `ProveedorListItem` types promise —
 * mirroring `parseCuentaCorriente` (C-13) and `estadisticasParse.ts` (C-38).
 * A malformed Decimal throws rather than degrading to `0` (D4, D-88): a
 * fabricated zero on a supplier's balance is indistinguishable from a real
 * one. `cuit` is never touched by this conversion — it is a digit string
 * that must stay a string (D3).
 *
 * The `Raw*` interfaces mirror the wire exactly and are internal to this
 * module.
 */
import { apiClient } from '@shared/api/client'
import { toFiniteNumber } from '@shared/utils/decimal'
import type {
  Proveedor,
  ProveedorCreate,
  ProveedorUpdate,
  ProveedorDeleteResponse,
  ProveedorListItem,
  Categoria,
} from '@shared/api/api'

// ── Wire (raw) shape — strings for decimals ───────────────────────────────────

interface RawProveedor {
  id: string
  nombre: string
  cuit: string | null
  telefono: string | null
  categoria: Categoria
  notas: string | null
  saldo: string
  created_at: string
  updated_at: string
}

interface RawProveedorListItem {
  id: string
  nombre: string
  cuit: string | null
  categoria: Categoria
  saldo: string
  ultima_factura_fecha?: string | null
}

// ── Wire → public boundary ────────────────────────────────────────────────────

export function parseProveedor(raw: RawProveedor): Proveedor {
  return {
    id: raw.id,
    nombre: raw.nombre,
    cuit: raw.cuit,
    telefono: raw.telefono,
    categoria: raw.categoria,
    notas: raw.notas,
    saldo: toFiniteNumber(raw.saldo, 'saldo', 'parseProveedor'),
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  }
}

export function parseProveedorListItem(raw: RawProveedorListItem): ProveedorListItem {
  return {
    id: raw.id,
    nombre: raw.nombre,
    cuit: raw.cuit,
    categoria: raw.categoria,
    saldo: toFiniteNumber(raw.saldo, 'saldo', 'parseProveedorListItem'),
    ultima_factura_fecha: raw.ultima_factura_fecha ?? null,
  }
}

/**
 * Adapts a full `Proveedor` (GET /proveedores/{id}) down to the lean
 * `ProveedorListItem` shape (C-41).
 *
 * `Proveedor` and `ProveedorListItem` stopped being structurally identical
 * once `ProveedorListItem`'s known drift was resolved (the backend's list
 * row omits `telefono`/`notas`/timestamps and adds `ultima_factura_fecha`,
 * design.md task 3.5) — call sites that need to feed a full `Proveedor`
 * into something typed for the list/search shape (a supplier pre-filled
 * from a direct fetch instead of a search result) need this adapter instead
 * of passing the value straight through.
 *
 * `ultima_factura_fecha` is always `null` here: a single `GET /{id}` never
 * carries it, and every consumer of this adapter only reads `id` / `nombre`.
 */
export function toProveedorListItem(proveedor: Proveedor): ProveedorListItem {
  return {
    id: proveedor.id,
    nombre: proveedor.nombre,
    cuit: proveedor.cuit,
    categoria: proveedor.categoria,
    saldo: proveedor.saldo,
    ultima_factura_fecha: null,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ListProveedoresParams {
  page?: number
  orderBy?: 'nombre' | 'saldo'
}

export async function listProveedores(
  params: ListProveedoresParams = {},
): Promise<ProveedorListItem[]> {
  const { page = 1, orderBy = 'nombre' } = params
  const res = await apiClient.get<RawProveedorListItem[]>('/proveedores', {
    params: { page, order_by: orderBy },
  })
  return res.data.map(parseProveedorListItem)
}

export async function getProveedor(id: string): Promise<Proveedor> {
  const res = await apiClient.get<RawProveedor>(`/proveedores/${id}`)
  return parseProveedor(res.data)
}

export async function createProveedor(data: ProveedorCreate): Promise<Proveedor> {
  const res = await apiClient.post<RawProveedor>('/proveedores', data)
  return parseProveedor(res.data)
}

export async function updateProveedor(id: string, data: ProveedorUpdate): Promise<Proveedor> {
  const res = await apiClient.patch<RawProveedor>(`/proveedores/${id}`, data)
  return parseProveedor(res.data)
}

export async function deleteProveedor(id: string): Promise<ProveedorDeleteResponse> {
  const res = await apiClient.delete<ProveedorDeleteResponse>(`/proveedores/${id}`)
  return res.data
}

export async function buscarProveedores(nombre: string): Promise<ProveedorListItem[]> {
  const res = await apiClient.get<RawProveedorListItem[]>('/proveedores/buscar', {
    params: { nombre },
  })
  return res.data.map(parseProveedorListItem)
}
