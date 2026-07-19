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
  it('renders PENDIENTE with the pendiente badge token', () => {
    const { container } = render(<EstadoBadge estado="PENDIENTE" />)
    expect(screen.getByText('PENDIENTE')).toBeInTheDocument()
    // Should use the new design-system badge tokens (src/app/index.css)
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/badge-pendiente/)
  })

  it('renders PARCIAL with the parcial badge token', () => {
    const { container } = render(<EstadoBadge estado="PARCIAL" />)
    expect(screen.getByText('PARCIAL')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/badge-parcial/)
  })

  it('renders PAGADA with the pagada badge token', () => {
    const { container } = render(<EstadoBadge estado="PAGADA" />)
    expect(screen.getByText('PAGADA')).toBeInTheDocument()
    const badge = container.firstChild as HTMLElement
    expect(badge.className).toMatch(/badge-pagada/)
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
