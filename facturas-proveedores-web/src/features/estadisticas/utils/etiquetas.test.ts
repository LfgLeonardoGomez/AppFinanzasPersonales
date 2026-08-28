/**
 * Tests for period labels (C-38).
 *
 * The labels are built from the `YYYY-MM-DD` string in UTC. Formatting a
 * date-only value through the host's local timezone is how "2026-01-01"
 * becomes "31 dic" for anyone west of Greenwich — a period silently
 * mislabelled by one day, on every row, and only for some users.
 */
import { describe, it, expect } from 'vitest'
import { etiquetaPeriodo } from './etiquetas'

describe('etiquetaPeriodo', () => {
  it('labels a month bucket with month and year', () => {
    expect(etiquetaPeriodo('2026-01-01', 'mes')).toBe('ene 2026')
  })

  it('labels a day bucket with day and month', () => {
    expect(etiquetaPeriodo('2026-08-26', 'dia')).toBe('26 ago')
  })

  it('labels a week bucket with the week start', () => {
    expect(etiquetaPeriodo('2026-08-24', 'semana')).toBe('sem. 24 ago')
  })

  it('does NOT shift the date across a month boundary', () => {
    // The classic failure: `new Date('2026-01-01')` is UTC midnight, and
    // rendering it with a local formatter in UTC-3 yields 31 December.
    expect(etiquetaPeriodo('2026-01-01', 'dia')).toBe('1 ene')
  })

  it('does NOT shift a month label across a year boundary', () => {
    expect(etiquetaPeriodo('2026-01-01', 'mes')).toBe('ene 2026')
  })
})
