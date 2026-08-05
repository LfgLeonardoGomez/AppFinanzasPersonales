/**
 * Tests for PagoCard — presentational card for a single payment.
 *
 * TDD: Task 4.1 (RED) → 4.2 (GREEN) → 4.3 (TRIANGULATE).
 *
 * INVARIANTS:
 *   - `PagoCard` does NO data fetching. Since c-26 it holds one piece of
 *     local UI state — whether the comprobante viewer is open — matching how
 *     `TablaFacturasConEstado` and `PagosRegistrados` own their own viewer
 *     (C-24). The invariant that matters is "no fetching", not "no state".
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

describe('PagoCard — viewing the comprobante (c-26)', () => {
  const URL_JPG = 'https://res.cloudinary.com/demo/comprobantes/x.jpg'
  const conComprobante = { ...basePago, comprobante_url: URL_JPG }

  it('opens the in-app viewer instead of navigating away', () => {
    // Same leftover as FileUploadField: C-24 moved the cuenta-corriente
    // tables to the in-app viewer but this list kept opening a new tab, so
    // one action had two behaviours depending on the screen.
    render(<PagoCard pago={conComprobante} onEdit={vi.fn()} onDelete={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: /ver comprobante/i }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', URL_JPG)
  })

  it('does not render a link that leaves the application', () => {
    render(<PagoCard pago={conComprobante} onEdit={vi.fn()} onDelete={vi.fn()} />)

    const escaping = screen
      .queryAllByRole('link')
      .filter((a) => a.getAttribute('target') === '_blank')

    expect(escaping).toHaveLength(0)
  })

  it('offers nothing when the payment has no comprobante', () => {
    render(<PagoCard pago={basePago} onEdit={vi.fn()} onDelete={vi.fn()} />)

    expect(screen.queryByRole('button', { name: /ver comprobante/i })).not.toBeInTheDocument()
  })
})

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

  it('renders a comprobante control when comprobante_url is provided', () => {
    // c-26 — BREAKING TEST CONTRACT, intentional: this used to assert an
    // anchor with an href, because the card navigated away. It is now a
    // button that opens the in-app viewer, so the role changed link→button.
    // The behaviour it guards (a control appears iff there is a comprobante)
    // is unchanged.
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
    expect(
      screen.getByRole('button', { name: /comprobante|ver adjunto|adjunto/i }),
    ).toBeInTheDocument()
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
