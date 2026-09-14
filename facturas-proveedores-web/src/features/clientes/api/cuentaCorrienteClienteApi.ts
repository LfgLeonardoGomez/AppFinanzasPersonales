/**
 * Raw Axios call for the customer cuenta-corriente endpoint (C-35, C-36,
 * design.md D1).
 *
 * The endpoint is `GET /api/clientes/{id}/cuenta-corriente`. No request
 * body, no query parameters. The response is the on-demand triple
 * `{ saldo, ventas_con_estado, historial }` computed by the C-35 service
 * layer (RN-SALDO, RN-FIFO, RN-HIST) — mirrors `cuentaCorrienteApi.ts`'s
 * shape exactly, one level down (customer instead of supplier).
 *
 * INVARIANT: Pydantic v2 serializes `Decimal` as a JSON string at the wire.
 * The public `CuentaCorrienteClienteResponse` type uses `number`. The
 * `parseCuentaCorrienteCliente` boundary converts each Decimal string to a
 * `number` via `Number()` so the rest of the app never sees a
 * string-encoded decimal. A non-finite outcome throws a typed `Error` so
 * the hook surfaces `isError` instead of corrupting the saldo with `0` — a
 * malformed wire value must never render as "al día".
 *
 * The `Raw*` interfaces mirror the wire exactly and are internal to this
 * module.
 */
import { apiClient } from '@shared/api/client'
import { toFiniteNumber } from '@shared/utils/decimal'
import type {
  CuentaCorrienteClienteResponse,
  VentaConEstado,
  EntradaHistorialCliente,
  FormaPago,
  EstadoVentaFiada,
  EntradaHistorialClienteTipo,
} from '@shared/api/api'

// ── Wire (raw) shape — strings for decimals ───────────────────────────────────

interface RawVentaConEstado {
  id: string
  negocio_id: string
  cliente_id: string
  fecha: string
  monto: string
  forma_pago: FormaPago
  notas?: string | null
  estado: EstadoVentaFiada
  created_at: string
  updated_at: string
}

interface RawEntradaHistorialCliente {
  id: string
  tipo: EntradaHistorialClienteTipo
  fecha: string
  monto: string
  saldo_acumulado: string
  archivo_url?: string | null
}

interface RawCuentaCorrienteClienteResponse {
  cliente_id: string
  saldo: string
  ventas_con_estado: RawVentaConEstado[]
  historial: RawEntradaHistorialCliente[]
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function getCuentaCorrienteCliente(
  clienteId: string,
): Promise<CuentaCorrienteClienteResponse> {
  const res = await apiClient.get<RawCuentaCorrienteClienteResponse>(
    `/clientes/${clienteId}/cuenta-corriente`,
  )
  return parseCuentaCorrienteCliente(res.data)
}

// ── Wire → public boundary ────────────────────────────────────────────────────

/**
 * Parse the wire shape into the public `CuentaCorrienteClienteResponse` (all
 * decimals as `number`). Throws a typed `Error` on any malformed Decimal so
 * the hook surfaces `isError` instead of silently coercing to `NaN`.
 */
export function parseCuentaCorrienteCliente(
  raw: RawCuentaCorrienteClienteResponse,
): CuentaCorrienteClienteResponse {
  return {
    cliente_id: raw.cliente_id,
    saldo: toFiniteNumber(raw.saldo, 'saldo', 'parseCuentaCorrienteCliente'),
    ventas_con_estado: raw.ventas_con_estado.map((v) => parseVentaConEstado(v)),
    historial: raw.historial.map((h) => parseEntradaHistorialCliente(h)),
  }
}

function parseVentaConEstado(raw: RawVentaConEstado): VentaConEstado {
  return {
    id: raw.id,
    negocio_id: raw.negocio_id,
    cliente_id: raw.cliente_id,
    fecha: raw.fecha,
    monto: toFiniteNumber(raw.monto, 'monto', 'parseCuentaCorrienteCliente'),
    forma_pago: raw.forma_pago,
    notas: raw.notas ?? null,
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
 * and a table read it, but this boundary threw it away. When you add a
 * field to `EntradaHistorialCliente`, add it here too.
 */
function parseEntradaHistorialCliente(
  raw: RawEntradaHistorialCliente,
): EntradaHistorialCliente {
  return {
    id: raw.id,
    tipo: raw.tipo,
    fecha: raw.fecha,
    monto: toFiniteNumber(raw.monto, 'monto', 'parseCuentaCorrienteCliente'),
    saldo_acumulado: toFiniteNumber(raw.saldo_acumulado, 'saldo_acumulado', 'parseCuentaCorrienteCliente'),
    // `?? null` so a row without the field is `null`, not `undefined` — the
    // UI checks truthiness, but the two differ when serialized.
    archivo_url: raw.archivo_url ?? null,
  }
}
