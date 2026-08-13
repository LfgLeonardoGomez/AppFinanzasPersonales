/**
 * Tests for FormaPagoBadge — sale payment-method badge (C-34, task 7.1).
 *
 * Mirrors `MetodoBadge.test.tsx` (C-13): renders the raw `forma_pago` value
 * with a distinct color per enum value, never computes or transforms it.
 * FormaPago is a DIFFERENT type from MetodoPago (design.md D4) — this badge
 * exists because MetodoBadge does not (and should not) know about
 * `CUENTA_CORRIENTE`.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FormaPagoBadge } from './FormaPagoBadge'

describe('FormaPagoBadge', () => {
  it('renders EFECTIVO with emerald color class', () => {
    const { container } = render(<FormaPagoBadge formaPago="EFECTIVO" />)
    expect(screen.getByText('EFECTIVO')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/emerald/)
  })

  it('renders CUENTA_CORRIENTE with a distinct color class (triangulation — the value MetodoBadge has no equivalent of)', () => {
    const { container } = render(<FormaPagoBadge formaPago="CUENTA_CORRIENTE" />)
    expect(screen.getByText('CUENTA_CORRIENTE')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/amber|magenta/)
  })

  it('renders TARJETA with violet color class', () => {
    const { container } = render(<FormaPagoBadge formaPago="TARJETA" />)
    expect(screen.getByText('TARJETA')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/violet/)
  })

  it('renders a defensive default for unknown forma_pago values', () => {
    const { container } = render(<FormaPagoBadge formaPago={'UNKNOWN' as 'EFECTIVO'} />)
    expect(container.firstChild).toBeInTheDocument()
  })
})
