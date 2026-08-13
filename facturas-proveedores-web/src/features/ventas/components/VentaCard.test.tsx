/**
 * Tests for VentaCard — pure presentational row for a single sale (C-34,
 * tasks 7.1/7.4).
 *
 * Mirrors `PagoCard`: no data fetching — `clienteNombre` is resolved and
 * passed down by the parent (`VentasList`), since `VentaListItem` only
 * carries `cliente_id` (design.md D3).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VentaCard } from './VentaCard'
import type { VentaListItem } from '@shared/api/api'

function venta(overrides: Partial<VentaListItem>): VentaListItem {
  return {
    id: 'venta-1',
    negocio_id: 'negocio-1',
    cliente_id: null,
    fecha: '2026-08-13',
    monto: '1000.00',
    forma_pago: 'EFECTIVO',
    notas: null,
    created_at: '2026-08-13T10:00:00',
    updated_at: '2026-08-13T10:00:00',
    ...overrides,
  }
}

describe('VentaCard — payment-method badge per row (task 7.1)', () => {
  it('renders the forma_pago badge and the formatted amount', () => {
    render(
      <VentaCard venta={venta({ forma_pago: 'TARJETA', monto: '2500.00' })} onEdit={vi.fn()} onDelete={vi.fn()} />,
    )
    expect(screen.getByText('TARJETA')).toBeInTheDocument()
    expect(screen.getByText(/\$\s?2\.500,00/)).toBeInTheDocument()
  })
})

describe('VentaCard — customer names, not identifiers (task 7.4)', () => {
  it('shows the resolved customer name for a sale on account', () => {
    render(
      <VentaCard
        venta={venta({ forma_pago: 'CUENTA_CORRIENTE', cliente_id: 'cliente-1' })}
        clienteNombre="Juan Pérez"
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()
    expect(screen.queryByText('cliente-1')).not.toBeInTheDocument()
  })

  it('shows a neutral placeholder, never a UUID, when the customer cannot be resolved (triangulation)', () => {
    render(
      <VentaCard
        venta={venta({ forma_pago: 'CUENTA_CORRIENTE', cliente_id: 'cliente-unresolvable' })}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )
    expect(screen.queryByText('cliente-unresolvable')).not.toBeInTheDocument()
    expect(screen.getByText(/cliente/i)).toBeInTheDocument()
  })

  it('shows no customer name for a cash sale (triangulation)', () => {
    render(<VentaCard venta={venta({ forma_pago: 'EFECTIVO' })} onEdit={vi.fn()} onDelete={vi.fn()} />)
    expect(screen.queryByText(/juan pérez/i)).not.toBeInTheDocument()
  })
})

describe('VentaCard — edit and delete actions', () => {
  it('invokes onEdit and onDelete with the venta', () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    const v = venta({})
    render(<VentaCard venta={v} onEdit={onEdit} onDelete={onDelete} />)

    screen.getByRole('button', { name: /editar/i }).click()
    expect(onEdit).toHaveBeenCalledWith(v)

    screen.getByRole('button', { name: /eliminar/i }).click()
    expect(onDelete).toHaveBeenCalledWith(v)
  })
})
