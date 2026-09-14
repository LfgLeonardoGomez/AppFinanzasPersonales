/**
 * Shared Decimal-string → number parser (C-45 housekeeping, 2026-09-14).
 *
 * Consolidates a helper that was duplicated across 8 API-client boundary
 * modules: ventasApi, facturasApi, pagosApi, proveedoresApi,
 * actividadRecienteApi, cuentaCorrienteApi, cuentaCorrienteClienteApi,
 * estadisticasParse. See `knowledge-base/10_preguntas_abiertas.md` for
 * the debt this closes.
 *
 * INVARIANT (D-88/D-94): a malformed Decimal-string from the backend
 * (Pydantic v2 serializes `Decimal` as a JSON string) must THROW, never
 * silently degrade to `0`. A fabricated zero is indistinguishable from a
 * real zero balance/amount on screen, so degrading would draw a
 * plausible lie. `Number('')` is `0`, not `NaN` — a bare
 * `Number.isFinite` check alone lets an empty string sail through as a
 * fabricated zero, so the empty-string case is rejected explicitly
 * before the numeric check.
 *
 * Parsing stays at each API client's boundary — this helper is NOT
 * wired into a shared axios interceptor: an interceptor that guessed
 * "this looks numeric" would just as happily mangle a CUIT or a numeric
 * id.
 *
 * `context` names the caller (a parse function or a fixed module
 * prefix) so the thrown message points at where the bad data was read,
 * matching the shape the 8 original copies already used.
 */
export function toFiniteNumber(value: string, field: string, context: string): number {
  // `Number('')` is 0, not NaN — an empty string would sail through a plain
  // `Number.isFinite` check and land on the screen as a fabricated value.
  if (value.trim() === '') {
    throw new Error(`${context}: malformed Decimal at field "${field}" — got an empty string`)
  }

  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(`${context}: malformed Decimal at field "${field}" — got ${JSON.stringify(value)}`)
  }
  return n
}
