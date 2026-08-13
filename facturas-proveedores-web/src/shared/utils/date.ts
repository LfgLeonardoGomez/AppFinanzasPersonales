/**
 * Date helpers for client-side validations and the "not future" rule
 * (RN-PAG-03, RN-FAC-02, hard rule #3).
 *
 * All comparators run in **America/Argentina/Buenos_Aires (UTC-3)** —
 * a payment or invoice date must be compared to the wall-clock date in
 * the user's local timezone, not to the server's UTC date. This is the
 * same wall-clock used by the backend service layer (Pydantic + Python
 * `datetime.now(ZoneInfo("America/Argentina/Buenos_Aires"))`).
 */

/**
 * Return today's date in `America/Argentina/Buenos_Aires` as a `YYYY-MM-DD`
 * string, computed via `Intl.DateTimeFormat` with an explicit `timeZone`
 * (design.md D10, C-34).
 *
 * This pins the IANA zone name — so it stays correct even if Argentina's
 * offset ever changes — and, more importantly for this helper's purpose, it
 * is completely independent of the host's own local timezone: a browser (or
 * a test's `process.env.TZ`) set to any other zone still yields the Buenos
 * Aires calendar date, which is what the backend's `datetime.now(ZoneInfo(
 * "America/Argentina/Buenos_Aires"))` validates against (`venta_service.
 * _validar_fecha`, and the equivalent checks in `pago_service`/
 * `factura_service`). Feeds the sales form's default date and `max` on its
 * date input, and the "not future" client validation shared by
 * `PagoForm`/`FacturaForm`/`VentaForm` — the app's single source of "today"
 * on the client (review fix, finding D: this used to coexist with a second,
 * fixed-offset `getTodayUTC3`, since removed).
 */
export function getTodayInArgentina(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return formatter.format(new Date())
}
