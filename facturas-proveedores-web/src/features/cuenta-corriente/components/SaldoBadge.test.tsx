/**
 * Tests for SaldoBadge (C-13, task 4).
 *
 * INVARIANT (RN-SALDO, hard rule #4): the badge receives the `saldo`
 * as a prop and color-dispatches on its sign. It does NOT recompute the
 * saldo. The semantic variant (`data-variant`) is the test hook for the
 * sign-dispatch; the visual color is wired to the variant via Tailwind
 * classes (not asserted here — class assertions are implementation
 * details, per strict-tdd.md).
 *
 * TDD: Task 4.1 (RED) → 4.2 (GREEN) → 4.3 (TRIANGULATE).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SaldoBadge } from './SaldoBadge'

describe('SaldoBadge', () => {
  it('renders the negative ARS value for a positive saldo (debt) with the "deuda" variant', () => {
    render(<SaldoBadge saldo={1500.5} />)
    const badge = screen.getByTestId('saldo-badge')
    expect(badge.dataset.variant).toBe('deuda')
    // Positive backend saldo = debt → displayed as negative
    expect(badge.textContent).toMatch(/[−-]\$?\s*1\.500,50/)
  })

  it('renders the zero saldo with the "al-dia" variant and NO "a favor" suffix', () => {
    render(<SaldoBadge saldo={0} />)
    const badge = screen.getByTestId('saldo-badge')
    expect(badge.dataset.variant).toBe('al-dia')
    expect(badge.textContent).toContain('0,00')
    // Defense in depth: the "a favor" suffix is reserved for the negative
    // case (Q-CC-FE-01 / design §A.Favor copy decision).
    expect(badge.textContent).not.toContain('a favor')
  })

  it('renders the positive ARS value for a negative saldo (credit) with the "a-favor" variant and suffix', () => {
    render(<SaldoBadge saldo={-500} />)
    const badge = screen.getByTestId('saldo-badge')
    expect(badge.dataset.variant).toBe('a-favor')
    // Negative backend saldo = credit → displayed as positive
    expect(badge.textContent).toContain('500,00')
    // The "a favor" suffix is explicit (design D2)
    expect(badge.textContent).toContain('a favor')
  })

  it('renders a non-empty element for a NaN saldo (defensive default) and does not throw', () => {
    // NaN is the defensive default for an uninitialized cache or a
    // mid-flight render. The badge must not crash.
    expect(() => render(<SaldoBadge saldo={NaN} />)).not.toThrow()
    const badge = screen.getByTestId('saldo-badge')
    expect(badge.textContent).not.toBe('')
    // The variant is the unknown fallback
    expect(badge.dataset.variant).toBe('unknown')
  })

  it('the sign-dispatch is consistent: positive → deuda, zero → al-dia, negative → a-favor', () => {
    // Triangulation: assert each branch with a different input. Each one
    // forces the implementation to actually evaluate the sign — a hardcoded
    // "deuda" would fail two of these.
    const { rerender } = render(<SaldoBadge saldo={1} />)
    expect(screen.getByTestId('saldo-badge').dataset.variant).toBe('deuda')
    rerender(<SaldoBadge saldo={0} />)
    expect(screen.getByTestId('saldo-badge').dataset.variant).toBe('al-dia')
    rerender(<SaldoBadge saldo={-0.01} />)
    expect(screen.getByTestId('saldo-badge').dataset.variant).toBe('a-favor')
  })
})
