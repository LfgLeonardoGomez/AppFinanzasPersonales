/**
 * Compile-time type guards for the IA vision proposal types in `api.d.ts` (C-15).
 *
 * Mirrors the C-11 / C-13 `.test-d.ts` pattern: a `.test-d.ts` file that is
 * NOT executed at runtime — Vitest does not pick it up (lives outside any
 * `*.test.ts` glob). The assertions are purely compile-time, fired by
 * `tsc --noEmit` in CI. The presence of this file in source IS the test.
 *
 * Locked invariants (mirrors `ia-vision-backend` spec + RN-IA-03/06):
 *   - `PropuestaFactura` has exactly the 6 fields the C-14 Pydantic schema
 *     declares: `proveedor_nombre`, `numero`, `fecha_emision`, `monto_total`,
 *     `error`, `error_message`. No `id`, `usuario_id`, `proveedor_id`,
 *     `origen`, `created_at`, `updated_at`, no `factura_id` (defense in
 *     depth for RN-IA-06 / RN-PAG-01).
 *   - `PropuestaPago` has exactly the 6 fields: `proveedor_nombre`, `monto`,
 *     `fecha`, `metodo` (typed `MetodoPago | null`), `error`, `error_message`.
 *     No `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`,
 *     `updated_at`, no `factura_id` (RN-PAG-01 surface defense).
 *
 * TDD: Task 1.1 (RED) → 1.2 (GREEN) → 1.3 (TRIANGULATE).
 */
import type { PropuestaFactura, PropuestaPago, MetodoPago } from './api'

// ── 1.1.a — PropuestaFactura has the six required fields ─────────────────────

type PfFields = keyof PropuestaFactura
type _AssertPfHasProveedorNombre = 'proveedor_nombre' extends PfFields ? true : never
type _AssertPfHasNumero = 'numero' extends PfFields ? true : never
type _AssertPfHasFechaEmision = 'fecha_emision' extends PfFields ? true : never
type _AssertPfHasMontoTotal = 'monto_total' extends PfFields ? true : never
type _AssertPfHasError = 'error' extends PfFields ? true : never
type _AssertPfHasErrorMessage = 'error_message' extends PfFields ? true : never

const _assertPfFields: [
  _AssertPfHasProveedorNombre,
  _AssertPfHasNumero,
  _AssertPfHasFechaEmision,
  _AssertPfHasMontoTotal,
  _AssertPfHasError,
  _AssertPfHasErrorMessage,
] = [true, true, true, true, true, true]
void _assertPfFields

// ── 1.1.b — PropuestaPago has the six required fields ────────────────────────

type PpFields = keyof PropuestaPago
type _AssertPpHasProveedorNombre = 'proveedor_nombre' extends PpFields ? true : never
type _AssertPpHasMonto = 'monto' extends PpFields ? true : never
type _AssertPpHasFecha = 'fecha' extends PpFields ? true : never
type _AssertPpHasMetodo = 'metodo' extends PpFields ? true : never
type _AssertPpHasError = 'error' extends PpFields ? true : never
type _AssertPpHasErrorMessage = 'error_message' extends PpFields ? true : never

const _assertPpFields: [
  _AssertPpHasProveedorNombre,
  _AssertPpHasMonto,
  _AssertPpHasFecha,
  _AssertPpHasMetodo,
  _AssertPpHasError,
  _AssertPpHasErrorMessage,
] = [true, true, true, true, true, true]
void _assertPpFields

// ── 1.1.c — PropuestaPago.metodo is assignable to MetodoPago | null ──────────

type _AssertPpMetodoClosed = PropuestaPago['metodo'] extends MetodoPago | null ? true : never
const _assertPpMetodo: _AssertPpMetodoClosed = true
void _assertPpMetodo

// ── 1.1.d — NO forbidden keys on PropuestaFactura (RN-IA-06 / C-14 contract) ─

type _AssertPfNoId = 'id' extends keyof PropuestaFactura ? never : true
type _AssertPfNoUsuarioId = 'usuario_id' extends keyof PropuestaFactura ? never : true
type _AssertPfNoProveedorId = 'proveedor_id' extends keyof PropuestaFactura ? never : true
type _AssertPfNoOrigen = 'origen' extends keyof PropuestaFactura ? never : true
type _AssertPfNoCreatedAt = 'created_at' extends keyof PropuestaFactura ? never : true
type _AssertPfNoUpdatedAt = 'updated_at' extends keyof PropuestaFactura ? never : true
type _AssertPfNoFacturaId = 'factura_id' extends keyof PropuestaFactura ? never : true

const _assertPfNoForbidden: [
  _AssertPfNoId,
  _AssertPfNoUsuarioId,
  _AssertPfNoProveedorId,
  _AssertPfNoOrigen,
  _AssertPfNoCreatedAt,
  _AssertPfNoUpdatedAt,
  _AssertPfNoFacturaId,
] = [true, true, true, true, true, true, true]
void _assertPfNoForbidden

// ── 1.1.e — NO forbidden keys on PropuestaPago (RN-PAG-01 surface defense) ──

type _AssertPpNoId = 'id' extends keyof PropuestaPago ? never : true
type _AssertPpNoUsuarioId = 'usuario_id' extends keyof PropuestaPago ? never : true
type _AssertPpNoProveedorId = 'proveedor_id' extends keyof PropuestaPago ? never : true
type _AssertPpNoOrigen = 'origen' extends keyof PropuestaPago ? never : true
type _AssertPpNoCreatedAt = 'created_at' extends keyof PropuestaPago ? never : true
type _AssertPpNoUpdatedAt = 'updated_at' extends keyof PropuestaPago ? never : true
type _AssertPpNoFacturaId = 'factura_id' extends keyof PropuestaPago ? never : true

const _assertPpNoForbidden: [
  _AssertPpNoId,
  _AssertPpNoUsuarioId,
  _AssertPpNoProveedorId,
  _AssertPpNoOrigen,
  _AssertPpNoCreatedAt,
  _AssertPpNoUpdatedAt,
  _AssertPpNoFacturaId,
] = [true, true, true, true, true, true, true]
void _assertPpNoForbidden

export {}
