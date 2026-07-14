/**
 * Compile-time type guards for the cuenta-corriente types in `api.d.ts` (C-13).
 *
 * Mirrors the C-11 `api.types.test-d.ts` pattern: a `.test-d.ts` file that is
 * NOT executed at runtime — Vitest does not pick it up (lives outside any
 * `*.test.ts` glob). The assertions are purely compile-time, fired by
 * `tsc --noEmit` in CI. The presence of this file in source IS the test.
 *
 * TDD: Task 1.1 (RED) → 1.2 (GREEN) → 1.3 (TRIANGULATE).
 *
 * Locked invariants (RN-PAG-01 / RN-SALDO / D9):
 *   - `CuentaCorrienteResponse` has the four required fields.
 *   - `FacturaConEstado.estado` is assignable to `EstadoFactura` (closed).
 *   - `EntradaHistorial.tipo` is the literal `'FACTURA' | 'PAGO'` (closed).
 *   - None of `CuentaCorrienteResponse`, `FacturaConEstado`, `EntradaHistorial`
 *     has a `factura_id` key (defense in depth for RN-PAG-01 on the
 *     cuenta-corriente surface).
 *   - `FacturaDeleteInput` and `PagoDeleteInput` have no `factura_id` key.
 */
import type {
  CuentaCorrienteResponse,
  FacturaConEstado,
  EntradaHistorial,
  FacturaDeleteInput,
  PagoDeleteInput,
} from './api'

// ── 1.1.a — CuentaCorrienteResponse has the four required fields ─────────────

type CcrFields = keyof CuentaCorrienteResponse
type _AssertCcrHasProveedorId = 'proveedor_id' extends CcrFields ? true : never
type _AssertCcrHasSaldo = 'saldo' extends CcrFields ? true : never
type _AssertCcrHasFacturas = 'facturas_con_estado' extends CcrFields ? true : never
type _AssertCcrHasHistorial = 'historial' extends CcrFields ? true : never

const _assertCcr: [
  _AssertCcrHasProveedorId,
  _AssertCcrHasSaldo,
  _AssertCcrHasFacturas,
  _AssertCcrHasHistorial,
] = [true, true, true, true]
void _assertCcr

// ── 1.1.b — FacturaConEstado.estado is assignable to EstadoFactura ───────────

import type { EstadoFactura } from './api'

type _AssertEstadoClosed = FacturaConEstado['estado'] extends EstadoFactura ? true : never
const _assertEstado: _AssertEstadoClosed = true
void _assertEstado

// ── 1.1.c — EntradaHistorial.tipo is the literal 'FACTURA' | 'PAGO' ─────────

type _AssertTipoClosed = EntradaHistorial['tipo'] extends 'FACTURA' | 'PAGO' ? true : never
const _assertTipo: _AssertTipoClosed = true
void _assertTipo

// ── 1.1.d — NO `factura_id` on the cuenta-corriente surface (RN-PAG-01) ─────

type _AssertNoFacturaIdCcr = 'factura_id' extends keyof CuentaCorrienteResponse ? never : true
type _AssertNoFacturaIdFactura = 'factura_id' extends keyof FacturaConEstado ? never : true
type _AssertNoFacturaIdHist = 'factura_id' extends keyof EntradaHistorial ? never : true
type _AssertNoFacturaIdFacturaDel = 'factura_id' extends keyof FacturaDeleteInput ? never : true
type _AssertNoFacturaIdPagoDel = 'factura_id' extends keyof PagoDeleteInput ? never : true

const _assertNoFacturaId: [
  _AssertNoFacturaIdCcr,
  _AssertNoFacturaIdFactura,
  _AssertNoFacturaIdHist,
  _AssertNoFacturaIdFacturaDel,
  _AssertNoFacturaIdPagoDel,
] = [true, true, true, true, true]
void _assertNoFacturaId

export {}
