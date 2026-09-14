/**
 * Raw Axios calls for the actividad-reciente (recent-activity) feed.
 *
 * Relocated from `features/home/api/homeApi.ts` (C-44, D2): the endpoint
 * mixes facturas and pagos, and its only consumer today is the
 * `/proveedores` screen, so it lives here rather than under `shared/`.
 *
 * The old `homeApi.ts` cast the raw response straight to a type declaring
 * `monto: string` without converting anything — a lie the render layer
 * papered over with a local `Number(...)`. This client fixes that at the
 * boundary (C-44, D3): `Raw*` mirrors the wire exactly and stays internal to
 * this module, mirroring `proveedoresApi.ts` (C-41, D3, D9).
 *
 * A malformed Decimal throws rather than degrading to `0` (D-88, D-94): in
 * a list of movements, a fabricated zero is indistinguishable from a real
 * movement of zero amount.
 */
import { apiClient } from '@shared/api/client'
import type { ActividadRecienteItem } from '@shared/api/api'

// ── Wire (raw) shape — strings for decimals, proveedor_nombre optional ────────

interface RawActividadRecienteItem {
  tipo: 'factura' | 'pago'
  id: string
  proveedor_id: string
  proveedor_nombre?: string | null
  monto: string
  fecha: string
  created_at: string
}

// ── Wire → public boundary ────────────────────────────────────────────────────

export function parseActividadRecienteItem(
  raw: RawActividadRecienteItem,
): ActividadRecienteItem {
  return {
    tipo: raw.tipo,
    id: raw.id,
    proveedor_id: raw.proveedor_id,
    proveedor_nombre: raw.proveedor_nombre ?? null,
    monto: toFiniteNumber(raw.monto, 'monto', 'getActividadReciente'),
    fecha: raw.fecha,
    created_at: raw.created_at,
  }
}

function toFiniteNumber(value: string, field: string, fn: string): number {
  // `Number('')` is 0, not NaN — an empty string would sail through a plain
  // `Number.isNaN` check and land on the screen as a real amount.
  if (value.trim() === '') {
    throw new Error(`${fn}: malformed Decimal at field "${field}" — got an empty string`)
  }

  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(`${fn}: malformed Decimal at field "${field}" — got ${JSON.stringify(value)}`)
  }
  return n
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getActividadReciente(limit = 8): Promise<ActividadRecienteItem[]> {
  const res = await apiClient.get<RawActividadRecienteItem[]>('/actividad-reciente', {
    params: { limit },
  })
  return res.data.map(parseActividadRecienteItem)
}
