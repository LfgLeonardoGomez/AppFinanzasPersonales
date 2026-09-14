/**
 * Tests for the estadísticas range helpers (C-38, task 6.x).
 *
 * These compute the DEFAULT range only — once the user picks a range it
 * lives in the URL. They operate on `YYYY-MM-DD` strings and do their
 * arithmetic in UTC on purpose: building a local `Date` from a date-only
 * string and subtracting from it re-introduces exactly the timezone shift
 * that C-37 avoided by keeping `fecha` a `date` column with no time and no
 * zone (D-78). A range boundary that silently slides a day would move
 * movements between periods.
 */
import { describe, it, expect } from 'vitest'
import { restarDias, restarMeses, rangoPorDefecto } from './rangos'

describe('restarDias', () => {
  it('subtracts days within a month', () => {
    expect(restarDias('2026-08-26', 10)).toBe('2026-08-16')
  })

  it('crosses a month boundary', () => {
    expect(restarDias('2026-03-05', 10)).toBe('2026-02-23')
  })

  it('crosses a year boundary', () => {
    expect(restarDias('2026-01-03', 5)).toBe('2025-12-29')
  })

  it('handles a leap day', () => {
    expect(restarDias('2028-03-01', 1)).toBe('2028-02-29')
  })
})

describe('restarMeses', () => {
  it('subtracts months keeping the day of month', () => {
    expect(restarMeses('2026-08-26', 12)).toBe('2025-08-26')
  })

  it('crosses a year boundary', () => {
    expect(restarMeses('2026-02-15', 3)).toBe('2025-11-15')
  })

  it('CLAMPS to the last day when the target month is shorter', () => {
    // Naive Date arithmetic rolls 2026-02-31 forward into March, which would
    // make "one month before March 31" land AFTER March 1 — a range whose
    // start is later than expected, silently dropping the first days.
    expect(restarMeses('2026-03-31', 1)).toBe('2026-02-28')
  })

  it('clamps onto a leap-year February', () => {
    expect(restarMeses('2028-03-31', 1)).toBe('2028-02-29')
  })

  it('clamps a 31-day month onto a 30-day one', () => {
    expect(restarMeses('2026-07-31', 1)).toBe('2026-06-30')
  })
})

describe('rangoPorDefecto', () => {
  // C-44: the compras branch retired alongside `PanelComprasProveedor` — its
  // only caller. `rangoPorDefecto` now takes a single `hoy` parameter and
  // always returns the ventas-shaped default.
  it('gives the last 30 days by day, counted INCLUSIVELY', () => {
    // Both bounds are inclusive on the backend, so 30 days means
    // `hasta - 29`, not `hasta - 30`: Jul 28→31 is 4 days plus Aug 1→26 is
    // 26, which is exactly 30.
    const rango = rangoPorDefecto('2026-08-26')

    expect(rango).toEqual({
      desde: '2026-07-28',
      hasta: '2026-08-26',
      granularidad: 'dia',
    })
  })

  it('spans exactly 30 inclusive days', () => {
    const rango = rangoPorDefecto('2026-08-26')
    const dias = (Date.parse(rango.hasta) - Date.parse(rango.desde)) / 86_400_000 + 1

    expect(dias).toBe(30)
  })

  it('stays well under the backend period cap of 400', () => {
    const rango = rangoPorDefecto('2026-08-26')
    const dias =
      (Date.parse(rango.hasta) - Date.parse(rango.desde)) / (1000 * 60 * 60 * 24) + 1

    expect(dias).toBeLessThan(400)
  })
})
