/**
 * Tests for EstadoBadge — renders estado label + correct color from API response.
 * TDD: Task 3.1 (RED) → 3.2 (GREEN) → 3.3 (TRIANGULATE).
 *
 * Key invariant: EstadoBadge NEVER computes estado — it only displays the value
 * passed from the response (RN-FAC-09).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EstadoBadge } from './EstadoBadge'

describe('EstadoBadge', () => {
  it('renders PENDIENTE with orange color class', () => {
    const { container } = render(<EstadoBadge estado="PENDIENTE" />)
    expect(screen.getByText('PENDIENTE')).toBeInTheDocument()
    // Should have an orange color indicator
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/orange/)
  })

  it('renders PARCIAL with yellow color class', () => {
    const { container } = render(<EstadoBadge estado="PARCIAL" />)
    expect(screen.getByText('PARCIAL')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/yellow/)
  })

  it('renders PAGADA with green color class', () => {
    const { container } = render(<EstadoBadge estado="PAGADA" />)
    expect(screen.getByText('PAGADA')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/green/)
  })

  it('renders a defensive default for unknown estado values', () => {
    // TypeScript will protect against this at compile-time, but the runtime
    // fallback should not crash.
    const { container } = render(
      <EstadoBadge estado={'UNKNOWN' as 'PENDIENTE'} />,
    )
    expect(container.firstChild).toBeInTheDocument()
  })
})
