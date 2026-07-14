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
 * Return today's date in UTC-3 as a `YYYY-MM-DD` string.
 *
 * The function subtracts 3 hours from the current UTC time and slices the
 * resulting ISO string. This is a pragmatic approximation of the
 * America/Argentina/Buenos_Aires wall clock — good enough for the
 * "not future" check on the client. The backend re-validates with the
 * authoritative timezone-aware computation (Pydantic + ZoneInfo).
 */
export function getTodayUTC3(): string {
  const now = new Date()
  const utc3 = new Date(now.getTime() - 3 * 60 * 60 * 1000)
  return utc3.toISOString().slice(0, 10)
}
