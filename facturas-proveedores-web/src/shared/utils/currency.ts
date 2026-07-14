/**
 * Currency formatting helper (C-13, D13).
 *
 * Single source of truth for ARS monetary formatting across the app.
 * The existing call sites in `PagoCard`, `PagoList` (via `PagoCard`),
 * `FacturasList`, and `ItemsEditor` (C-09 / C-11) are migrated to this
 * helper so the formatting logic lives in ONE place — no duplication.
 *
 * INVARIANTS:
 *   - The helper does NOT recompute or transform the value — it formats
 *     the number it is given. The Pydantic-v2 Decimal-string → `number`
 *     parsing for the cuenta-corriente surface happens at the API
 *     boundary (`getCuentaCorriente` / `parseCuentaCorriente`), not here.
 *   - String input is accepted defensively: at the Pydantic-decimal-string
 *     boundary a contributor might forget to parse, so the helper does
 *     a safe `Number()` coercion and falls back to `0` for `NaN`.
 *
 * Locale: `es-AR` (Argentine Spanish). Output example: `$ 1.500,50`.
 */
const ARS_FORMAT = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
})

/**
 * Format a monetary value as ARS currency.
 *
 * @param value - The amount to format. Accepts `number` (preferred) or
 *   `string` (a Pydantic-v2 Decimal-string, e.g. `"1234.56"`). Strings
 *   that don't parse to a finite number fall back to `0` defensively.
 * @returns The formatted ARS string (e.g. `"$ 1.500,50"`).
 */
export function formatMonto(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return ARS_FORMAT.format(0)
  return ARS_FORMAT.format(n)
}

/**
 * Format a supplier balance (saldo) for display.
 *
 * The backend returns saldo as a POSITIVE number when we owe money
 * to the supplier (deuda). For display, we INVERT the sign so:
 *   - Debt (saldo > 0) → negative  (e.g. "-$ 95.390,00")
 *   - Credit (saldo < 0) → positive (e.g. "$ 10.000,00")
 *
 * This matches the user's mental model: negative = money I still owe.
 */
export function formatSaldo(value: number | string): string {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return ARS_FORMAT.format(0)
  return ARS_FORMAT.format(-n)
}
