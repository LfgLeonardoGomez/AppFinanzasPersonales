/**
 * Compile-time type guards for the estadísticas types in `api.d.ts` (C-38,
 * consuming C-37).
 *
 * Mirrors the `api.cuentaCorriente.test-d.ts` pattern: a `.test-d.ts` file
 * that is NOT executed at runtime — Vitest does not pick it up (it lives
 * outside any `*.test.ts` glob). The assertions are purely compile-time,
 * fired by `tsc --noEmit`. The presence of this file in source IS the test.
 *
 * These types are hand-written because C-41 (types generated from OpenAPI)
 * is still pending, and this file is what will flag the drift when C-41
 * finally generates them.
 *
 * Locked invariants:
 *   - `Granularidad` is closed to the three backend values.
 *   - `desglose` covers EVERY `FormaPago` — a series ready to plot without
 *     the client filling in what did not arrive (C-37 D2).
 *   - Public decimals are `number`, not the wire's Decimal-string: the
 *     boundary parse is not optional, and typing them `string` here would
 *     let a component silently concatenate instead of add.
 *   - `ResumenResponse` exposes `diferencia` and NOTHING named after a
 *     margin (C-37 D6): the system does not know what the goods it sold
 *     cost.
 */
import type {
  Granularidad,
  PeriodoTotal,
  ComprasResponse,
  VentaPeriodo,
  VentasResponse,
  ResumenResponse,
  TopeExcedidoDetail,
  FormaPago,
} from './api'

// ── a — Granularidad is closed to the three backend values ───────────────────

type _AssertGranularidadClosed = Granularidad extends 'dia' | 'semana' | 'mes' ? true : never
type _AssertGranularidadComplete = 'dia' | 'semana' | 'mes' extends Granularidad ? true : never

const _assertGranularidad: [_AssertGranularidadClosed, _AssertGranularidadComplete] = [true, true]
void _assertGranularidad

// ── b — The compras series carries its bucket bounds and a numeric total ────

type PeriodoFields = keyof PeriodoTotal
type _AssertPeriodoHasPeriodo = 'periodo' extends PeriodoFields ? true : never
type _AssertPeriodoHasDesde = 'desde' extends PeriodoFields ? true : never
type _AssertPeriodoHasHasta = 'hasta' extends PeriodoFields ? true : never
type _AssertPeriodoTotalIsNumber = PeriodoTotal['total'] extends number ? true : never

const _assertPeriodo: [
  _AssertPeriodoHasPeriodo,
  _AssertPeriodoHasDesde,
  _AssertPeriodoHasHasta,
  _AssertPeriodoTotalIsNumber,
] = [true, true, true, true]
void _assertPeriodo

// ── c — `desglose` covers EVERY FormaPago, with numeric amounts ──────────────
//
// `Record<FormaPago, number>` makes the exhaustiveness a compile error rather
// than a runtime surprise: adding a payment method on the backend without
// updating this type stops being something the UI discovers by rendering a
// blank cell.

type _AssertDesgloseCoversEveryFormaPago = FormaPago extends keyof VentaPeriodo['desglose']
  ? true
  : never
type _AssertDesgloseAmountsAreNumbers = VentaPeriodo['desglose'][FormaPago] extends number
  ? true
  : never
type _AssertVentaPeriodoTotalIsNumber = VentaPeriodo['total'] extends number ? true : never

const _assertDesglose: [
  _AssertDesgloseCoversEveryFormaPago,
  _AssertDesgloseAmountsAreNumbers,
  _AssertVentaPeriodoTotalIsNumber,
] = [true, true, true]
void _assertDesglose

// ── d — Both series responses echo the range and the granularity ─────────────

type _AssertComprasEchoesGranularidad = ComprasResponse['granularidad'] extends Granularidad
  ? true
  : never
type _AssertVentasEchoesGranularidad = VentasResponse['granularidad'] extends Granularidad
  ? true
  : never
type _AssertComprasPeriodos = ComprasResponse['periodos'] extends PeriodoTotal[] ? true : never
type _AssertVentasPeriodos = VentasResponse['periodos'] extends VentaPeriodo[] ? true : never

const _assertSeries: [
  _AssertComprasEchoesGranularidad,
  _AssertVentasEchoesGranularidad,
  _AssertComprasPeriodos,
  _AssertVentasPeriodos,
] = [true, true, true, true]
void _assertSeries

// ── e — `proveedor_id` is OPTIONAL on compras (the unscoped call omits it) ───

type _AssertProveedorIdOptional = undefined extends ComprasResponse['proveedor_id'] ? true : never
const _assertProveedorIdOptional: _AssertProveedorIdOptional = true
void _assertProveedorIdOptional

// ── f — `ResumenResponse` has no margin, by any of its names (C-37 D6) ───────

type ResumenFields = keyof ResumenResponse
type _AssertResumenHasDiferencia = 'diferencia' extends ResumenFields ? true : never
type _AssertResumenNoMargen = 'margen' extends ResumenFields ? never : true
type _AssertResumenNoRentabilidad = 'rentabilidad' extends ResumenFields ? never : true
type _AssertResumenNoGanancia = 'ganancia' extends ResumenFields ? never : true
type _AssertResumenDecimalsAreNumbers = ResumenResponse['compras'] extends number ? true : never

const _assertResumen: [
  _AssertResumenHasDiferencia,
  _AssertResumenNoMargen,
  _AssertResumenNoRentabilidad,
  _AssertResumenNoGanancia,
  _AssertResumenDecimalsAreNumbers,
] = [true, true, true, true, true]
void _assertResumen

// ── g — The tope-excedido 422 carries what the UI needs to be actionable ────
//
// Without `periodos_estimados` and `tope` the message degrades to "too big",
// which tells the user nothing about how much smaller to make it.

type TopeFields = keyof TopeExcedidoDetail
type _AssertTopeHasEstimados = 'periodos_estimados' extends TopeFields ? true : never
type _AssertTopeHasTope = 'tope' extends TopeFields ? true : never
type _AssertTopeHasSugerencia = 'sugerencia' extends TopeFields ? true : never
type _AssertTopeCountsAreNumbers = TopeExcedidoDetail['periodos_estimados'] extends number
  ? true
  : never

const _assertTope: [
  _AssertTopeHasEstimados,
  _AssertTopeHasTope,
  _AssertTopeHasSugerencia,
  _AssertTopeCountsAreNumbers,
] = [true, true, true, true]
void _assertTope

export {}
