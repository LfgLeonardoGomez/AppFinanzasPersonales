/**
 * Button tests — design-system foundation primitive.
 *
 * Locks the contract: variant classes map to the new violet/magenta
 * tokens, size changes padding/text scale, `loading` disables the button
 * and exposes aria-busy while keeping the label readable, `disabled`
 * blocks the click handler, and the default renders as a primary pill.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button (design-system foundation)', () => {
  it('renders children as an accessible button with the primary variant by default', () => {
    render(<Button>Guardar</Button>)
    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass('bg-violet-500')
  })

  it('applies the secondary variant classes', () => {
    render(<Button variant="secondary">Cancelar</Button>)
    const button = screen.getByRole('button', { name: 'Cancelar' })
    expect(button).toHaveClass('bg-surface')
    expect(button).not.toHaveClass('bg-violet-500')
  })

  it('applies the ghost variant classes', () => {
    render(<Button variant="ghost">Cargar manual</Button>)
    const button = screen.getByRole('button', { name: 'Cargar manual' })
    expect(button).toHaveClass('bg-transparent')
    expect(button).not.toHaveClass('bg-violet-500')
  })

  it('renders the pill radius and Inter font on every variant', () => {
    render(<Button>Guardar</Button>)
    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toHaveClass('rounded-pill')
    expect(button).toHaveClass('font-inter')
  })

  it('changes size classes between sm, md (default) and lg', () => {
    const { rerender } = render(<Button size="sm">Sm</Button>)
    expect(screen.getByRole('button', { name: 'Sm' })).toHaveClass('text-xs')

    rerender(<Button size="lg">Lg</Button>)
    expect(screen.getByRole('button', { name: 'Lg' })).toHaveClass('text-base')
  })

  it('fires onClick when enabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Confirmar</Button>)
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disables the button and blocks onClick when disabled', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button disabled onClick={onClick}>
        Confirmar
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Confirmar' })
    expect(button).toBeDisabled()
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows a loading state that disables the button, sets aria-busy, and keeps the label readable', async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Guardando
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Guardando' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders a visible focus-visible ring class using the new violet token', () => {
    render(<Button>Guardar</Button>)
    const button = screen.getByRole('button', { name: 'Guardar' })
    expect(button).toHaveClass('focus-visible:ring-violet-500')
  })
})
