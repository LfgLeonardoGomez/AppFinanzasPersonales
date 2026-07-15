/**
 * LoadingState tests (C-20, frontend-ui-polish).
 *
 * Locks the contract: the LoadingState renders a shimmer skeleton
 * (no spinner SVG, no visible "Cargando…" text), exposes aria-busy
 * and aria-label for assistive tech, and accepts a custom label
 * prop that flows to the aria-label.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { LoadingState } from './LoadingState'

describe('LoadingState (C-20, frontend-ui-polish)', () => {
  it('renders a region with role=status, aria-busy=true, and a default aria-label', () => {
    render(<LoadingState />)
    const region = screen.getByRole('status')
    expect(region).toHaveAttribute('aria-busy', 'true')
    expect(region).toHaveAttribute('aria-label', 'Cargando…')
  })

  it('uses the label prop as the aria-label', () => {
    render(<LoadingState label="Cargando factura…" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Cargando factura…')
  })

  it('renders at least one placeholder block with the animate-shimmer class', () => {
    const { container } = render(<LoadingState />)
    const shimmers = container.querySelectorAll('.animate-shimmer')
    expect(shimmers.length).toBeGreaterThanOrEqual(1)
  })

  it('does not render any spinner SVG', () => {
    const { container } = render(<LoadingState />)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('does not render a visible "Cargando…" text node for sighted users', () => {
    render(<LoadingState />)
    expect(screen.queryByText('Cargando…')).not.toBeInTheDocument()
  })
})
