/**
 * Tests for PagoCard — presentational card for a single payment.
 *
 * TDD: Task 4.1 (RED) → 4.2 (GREEN) → 4.3 (TRIANGULATE).
 *
 * INVARIANTS:
 *   - `PagoCard` is pure presentational (no data fetching, no hooks).
 *   - It shows: monto (Intl ARS), fecha, MetodoBadge, comprobante link,
 *     edit/delete actions, and a "Pago al proveedor" reinforcement label
 *     (RN-PAG-01).
 *   - When `comprobante_url` is absent, no link is rendered.
 *   - Click on edit/delete invokes the corresponding prop callback.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PagoCard } from './PagoCard'
import type { PagoListItem } from '@shared/api/api'

const basePago: PagoListItem = {
  id: 'pago-uuid-1',
  proveedor_id: 'proveedor-uuid-1',
  monto: 2500,
  fecha: '2026-06-15',
  metodo: 'TRANSFERENCIA',
  origen: 'MANUAL',
  created_at: '2026-06-15T10:00:00',
}

describe('PagoCard', () => {
  it('renders monto formatted as ARS, fecha, and the MetodoBadge', () => {
    render(
      <PagoCard pago={basePago} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.getByText(/2\.500/)).toBeInTheDocument()
    expect(screen.getByText('2026-06-15')).toBeInTheDocument()
    expect(screen.getByText('TRANSFERENCIA')).toBeInTheDocument()
  })

  it('shows the "Pago al proveedor" reinforcement label (RN-PAG-01)', () => {
    render(
      <PagoCard pago={basePago} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.getByText(/pago al proveedor/i)).toBeInTheDocument()
  })

  it('renders a comprobante link when comprobante_url is provided', () => {
    const pagoConComprobante = {
      ...basePago,
      comprobante_url: 'https://res.cloudinary.com/test/image/upload/comprobante.pdf',
    }
    render(
      <PagoCard
        pago={pagoConComprobante}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    const link = screen.getByRole('link', { name: /comprobante|ver adjunto|adjunto/i })
    expect(link).toHaveAttribute('href', pagoConComprobante.comprobante_url)
  })

  it('does NOT render a comprobante link when comprobante_url is missing', () => {
    render(
      <PagoCard pago={basePago} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )
    // The card may have other links; we just check there's no comprobante
    // link with the comprobante URL.
    const links = screen.queryAllByRole('link', { name: /comprobante|adjunto/i })
    expect(links).toHaveLength(0)
  })

  it('invokes onEdit when the edit button is clicked', () => {
    const onEdit = vi.fn()
    render(
      <PagoCard pago={basePago} onEdit={onEdit} onDelete={vi.fn()} />,
    )
    const editBtn = screen.getByRole('button', { name: /editar/i })
    fireEvent.click(editBtn)
    expect(onEdit).toHaveBeenCalledWith(basePago)
  })

  it('invokes onDelete when the delete button is clicked', () => {
    const onDelete = vi.fn()
    render(
      <PagoCard pago={basePago} onEdit={vi.fn()} onDelete={onDelete} />,
    )
    const deleteBtn = screen.getByRole('button', { name: /eliminar/i })
    fireEvent.click(deleteBtn)
    expect(onDelete).toHaveBeenCalledWith(basePago)
  })
})
