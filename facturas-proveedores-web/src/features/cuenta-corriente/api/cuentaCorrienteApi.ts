/**
 * Raw Axios call for the cuenta-corriente endpoint (C-12, C-13).
 *
 * The endpoint is `GET /api/proveedores/{id}/cuenta-corriente`. No request
 * body, no query parameters. The response is the on-demand triple
 * `{ saldo, facturas_con_estado, historial }` computed by the C-12 service
 * layer (RN-SALDO, RN-FIFO, RN-HIST).
 *
 * INVARIANT (D13): Pydantic v2 serializes `Decimal` as a JSON string at the
 * wire. The public `CuentaCorrienteResponse` type uses `number`. The
 * `parseCuentaCorriente` boundary converts each Decimal string to a `number`
 * via `Number()` so the rest of the app never sees a string-encoded decimal.
 * A `NaN` outcome (e.g. malformed wire) throws a typed `Error` so the hook
 * surfaces `isError` instead of corrupting the saldo with `0`.
 *
 * The `Raw*` interfaces mirror the wire exactly and are internal to this
 * module.
 */
import { apiClient } from '@shared/api/client'
import type {
  CuentaCorrienteResponse,
  FacturaConEstado,
  EntradaHistorial,
  EstadoFactura,
  OrigenDocumento,
  EntradaHistorialTipo,
} from '@shared/api/api'

// ── Wire (raw) shape — strings for decimals ───────────────────────────────────

interface RawFacturaConEstado {
  id: string
  usuario_id: string
  proveedor_id: string
  numero: string | null
  fecha_emision: string
  fecha_vencimiento: string | null
  monto_total: string
  archivo_url: string | null
  origen: OrigenDocumento
  estado: EstadoFactura
  created_at: string
  updated_at: string
}

interface RawEntradaHistorial {
  id: string
  tipo: EntradaHistorialTipo
  fecha: string
  monto: string
  saldo_acumulado: string
  /** Optional: rows created before the field existed omit it entirely. */
  archivo_url?: string | null
}

interface RawCuentaCorrienteResponse {
  proveedor_id: string
  saldo: string
  facturas_con_estado: RawFacturaConEstado[]
  historial: RawEntradaHistorial[]
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getCuentaCorriente(
  proveedorId: string,
): Promise<CuentaCorrienteResponse> {
  const res = await apiClient.get<RawCuentaCorrienteResponse>(
    `/proveedores/${proveedorId}/cuenta-corriente`,
  )
  return parseCuentaCorriente(res.data)
}

// ── Wire → public boundary ────────────────────────────────────────────────────

/**
 * Parse the wire shape into the public `CuentaCorrienteResponse` (all
 * decimals as `number`). Throws a typed `Error` on any malformed Decimal
 * so the hook surfaces `isError` instead of silently coercing to `NaN`.
 */
export function parseCuentaCorriente(
  raw: RawCuentaCorrienteResponse,
): CuentaCorrienteResponse {
  return {
    proveedor_id: raw.proveedor_id,
    saldo: toFiniteNumber(raw.saldo, 'saldo'),
    facturas_con_estado: raw.facturas_con_estado.map((f) =>
      parseFacturaConEstado(f),
    ),
    historial: raw.historial.map((h) => parseEntradaHistorial(h)),
  }
}

function parseFacturaConEstado(raw: RawFacturaConEstado): FacturaConEstado {
  return {
    id: raw.id,
    usuario_id: raw.usuario_id,
    proveedor_id: raw.proveedor_id,
    numero: raw.numero,
    fecha_emision: raw.fecha_emision,
    fecha_vencimiento: raw.fecha_vencimiento,
    monto_total: toFiniteNumber(raw.monto_total, 'monto_total'),
    archivo_url: raw.archivo_url,
    origen: raw.origen,
    estado: raw.estado,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
  }
}

/**
 * NOTE — this rebuilds the row field by field, so it is an explicit
 * WHITELIST: any field the backend adds and this function does not copy is
 * dropped silently, with no type error and no failing test elsewhere. That
 * is precisely how `archivo_url` went missing in C-24 — the API returned it
 * and the table read it, but this boundary threw it away, so the
 * "Ver archivo" button never rendered for pagos. When you add a field to
 * `EntradaHistorial`, add it here too.
 */
function parseEntradaHistorial(raw: RawEntradaHistorial): EntradaHistorial {
  return {
    id: raw.id,
    tipo: raw.tipo,
    fecha: raw.fecha,
    monto: toFiniteNumber(raw.monto, 'monto'),
    saldo_acumulado: toFiniteNumber(raw.saldo_acumulado, 'saldo_acumulado'),
    // `?? null` so a row predating the field is `null`, not `undefined` —
    // the UI checks truthiness, but the two differ when serialized.
    archivo_url: raw.archivo_url ?? null,
  }
}

function toFiniteNumber(value: string, field: string): number {
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(`parseCuentaCorriente: malformed Decimal at field "${field}" — got ${JSON.stringify(value)}`)
  }
  return n
}
