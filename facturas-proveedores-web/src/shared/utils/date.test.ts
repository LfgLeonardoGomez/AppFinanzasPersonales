/**
 * Tests for `getTodayInArgentina` (C-34, task 6.7).
 *
 * design.md D10: `venta_service._validar_fecha` compares against
 * `datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date()`. A
 * browser in another timezone — or a machine with a wrong clock — must
 * still compute the SAME calendar date the backend will validate against.
 * The helper pins `timeZone: 'America/Argentina/Buenos_Aires'` explicitly
 * via `Intl.DateTimeFormat`, so it is independent of the host's local
 * timezone (`process.env.TZ` in Node, the OS clock in a browser).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { getTodayInArgentina } from './date'

describe('getTodayInArgentina', () => {
  const originalTZ = process.env.TZ

  afterEach(() => {
    process.env.TZ = originalTZ
  })

  it('returns the Buenos Aires calendar date at a UTC instant just after midnight there', () => {
    // 2026-08-14T02:00:00Z is 2026-08-13T23:00:00-03:00 in Buenos Aires —
    // still the 13th there, already the 14th in UTC.
    const RealDate = Date
    class FixedDate extends RealDate {
      constructor() {
        super('2026-08-14T02:00:00.000Z')
      }
      static now() {
        return new RealDate('2026-08-14T02:00:00.000Z').getTime()
      }
    }
    // @ts-expect-error — test-only Date stub
    globalThis.Date = FixedDate
    process.env.TZ = 'UTC'
    try {
      expect(getTodayInArgentina()).toBe('2026-08-13')
    } finally {
      globalThis.Date = RealDate
    }
  })

  it('is unaffected by a browser clock set to a very different timezone (triangulation)', () => {
    // Same UTC instant as above, but the host machine's own local timezone
    // is Pacific/Kiritimati (UTC+14) — its own local calendar date would
    // already be the 14th, one day ahead of Buenos Aires. The helper must
    // still report the Buenos Aires date because it pins `timeZone`
    // explicitly rather than relying on the host's local zone.
    const RealDate = Date
    class FixedDate extends RealDate {
      constructor() {
        super('2026-08-14T02:00:00.000Z')
      }
      static now() {
        return new RealDate('2026-08-14T02:00:00.000Z').getTime()
      }
    }
    // @ts-expect-error — test-only Date stub
    globalThis.Date = FixedDate
    process.env.TZ = 'Pacific/Kiritimati'
    try {
      expect(getTodayInArgentina()).toBe('2026-08-13')
    } finally {
      globalThis.Date = RealDate
    }
  })

  it('returns a plain YYYY-MM-DD string usable as a date input value/max', () => {
    expect(getTodayInArgentina()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
