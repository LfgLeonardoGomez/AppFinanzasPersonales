/**
 * Tests for the relative-time helper used by `ActividadReciente` (C-44,
 * task 4.2 — migrated from the old `HomePage.tsx` local helper, now a
 * standalone module with its own tests).
 */
import { describe, it, expect } from 'vitest'
import { relativeTime } from './relativeTime'

const NOW = new Date('2026-06-15T12:00:00Z').getTime()

describe('relativeTime', () => {
  it('returns "recién" for a timestamp less than a minute ago', () => {
    const iso = new Date(NOW - 30_000).toISOString()
    expect(relativeTime(iso, NOW)).toBe('recién')
  })

  it('returns minutes for a timestamp under an hour ago', () => {
    const iso = new Date(NOW - 5 * 60_000).toISOString()
    expect(relativeTime(iso, NOW)).toBe('hace 5 min')
  })

  it('returns hours for a timestamp under a day ago', () => {
    const iso = new Date(NOW - 3 * 60 * 60_000).toISOString()
    expect(relativeTime(iso, NOW)).toBe('hace 3 h')
  })

  it('returns days for a timestamp under a month ago', () => {
    const iso = new Date(NOW - 5 * 24 * 60 * 60_000).toISOString()
    expect(relativeTime(iso, NOW)).toBe('hace 5 d')
  })

  it('returns singular "mes" for exactly one month ago', () => {
    const iso = new Date(NOW - 30 * 24 * 60 * 60_000).toISOString()
    expect(relativeTime(iso, NOW)).toBe('hace 1 mes')
  })

  it('returns plural "meses" for more than one month ago', () => {
    const iso = new Date(NOW - 90 * 24 * 60 * 60_000).toISOString()
    expect(relativeTime(iso, NOW)).toBe('hace 3 meses')
  })

  it('returns an empty string for an unparseable date', () => {
    expect(relativeTime('not-a-date', NOW)).toBe('')
  })
})
