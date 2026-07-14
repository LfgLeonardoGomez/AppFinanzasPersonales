/**
 * Type-level tests for `src/shared/api/api.d.ts`.
 *
 * Goal: enforce at compile time the project-wide invariants the runtime tests
 * cannot reach. Specifically: a `factura_id` key MUST NOT exist on any Pago
 * request payload (RN-PAG-01). If a future contributor adds it, this file
 * fails to type-check.
 *
 * TDD: Task 1.1 (RED) → 1.2 (GREEN) → 1.3 (TRIANGULATE).
 *
 * Note: this is a `.test-d.ts` file. It is NOT executed at runtime — Vitest
 * does not pick it up (it lives outside any `*.test.ts` glob). The assertion
 * is purely compile-time, fired by `tsc --noEmit` in CI. We keep the
 * `.test-d.ts` suffix and colocate it with `api.d.ts` so it is discoverable
 * by future maintainers. The presence of this file in source IS the test.
 */
import type { PagoCreate, PagoUpdate } from './api'

// ── Task 1.1 — PagoCreate MUST NOT have a `factura_id` key (RN-PAG-01) ─────────

// Static assertion via a `keyof` check. If `factura_id` ever appears on
// PagoCreate, this line becomes a type error.
type _AssertNoFacturaIdInPagoCreate = 'factura_id' extends keyof PagoCreate
  ? never
  : true

// Force the assertion to be referenced at module scope so TypeScript checks it.
const _assertNoFacturaIdInPagoCreate: _AssertNoFacturaIdInPagoCreate = true
void _assertNoFacturaIdInPagoCreate

// ── Task 1.3 (TRIANGULATE) — PagoUpdate MUST NOT have `proveedor_id` either ────

type _AssertNoProveedorIdInPagoUpdate = 'proveedor_id' extends keyof PagoUpdate
  ? never
  : true

const _assertNoProveedorIdInPagoUpdate: _AssertNoProveedorIdInPagoUpdate = true
void _assertNoProveedorIdInPagoUpdate

// ── Task 1.3 (TRIANGULATE) — PagoUpdate MUST NOT have `factura_id` either ──────

type _AssertNoFacturaIdInPagoUpdate = 'factura_id' extends keyof PagoUpdate
  ? never
  : true

const _assertNoFacturaIdInPagoUpdate: _AssertNoFacturaIdInPagoUpdate = true
void _assertNoFacturaIdInPagoUpdate

export {}
