/**
 * Tests for MetodoBadge — renders the response metodo with a distinct color
 * per enum value; never computes anything.
 *
 * TDD: Task 3.1 (RED) → 3.2 (GREEN) → 3.3 (TRIANGULATE).
 *
 * INVARIANT: this component NEVER computes or transforms the metodo value —
 * it only displays the value passed in from the API response (mirrors
 * EstadoBadge's RN-FAC-09 contract for payments).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MetodoBadge } from './MetodoBadge'

describe('MetodoBadge', () => {
  it('renders EFECTIVO with emerald color class', () => {
    const { container } = render(<MetodoBadge metodo="EFECTIVO" />)
    expect(screen.getByText('EFECTIVO')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/emerald/)
  })

  it('renders TRANSFERENCIA with blue color class', () => {
    const { container } = render(<MetodoBadge metodo="TRANSFERENCIA" />)
    expect(screen.getByText('TRANSFERENCIA')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/blue/)
  })

  it('renders TARJETA with violet color class', () => {
    const { container } = render(<MetodoBadge metodo="TARJETA" />)
    expect(screen.getByText('TARJETA')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/violet/)
  })

  it('renders MERCADOPAGO with sky color class', () => {
    const { container } = render(<MetodoBadge metodo="MERCADOPAGO" />)
    expect(screen.getByText('MERCADOPAGO')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/sky/)
  })

  it('renders OTRO with gray color class', () => {
    const { container } = render(<MetodoBadge metodo="OTRO" />)
    expect(screen.getByText('OTRO')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/gray/)
  })

  it('renders a defensive default for unknown metodo values', () => {
    // TypeScript will protect against this at compile-time, but the runtime
    // fallback should not crash.
    const { container } = render(
      <MetodoBadge metodo={'UNKNOWN' as 'EFECTIVO'} />,
    )
    expect(container.firstChild).toBeInTheDocument()
  })
})
