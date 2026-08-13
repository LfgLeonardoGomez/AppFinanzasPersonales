/**
 * Tests for TotalesDelDia — the day's totals strip (C-34, tasks 7.6/7.7).
 *
 * Spec scenarios:
 *  - "the total is the sum of the day's sales"
 *  - "the breakdown separates the fiado from the money that came in"
 *  - "totals do not flash a false zero" — while `isLoading`, a loading
 *    affordance is shown and `$0` is NOT rendered.
 *  - "a day with no sales" — after loading, an empty day shows `$0` with an
 *    empty breakdown.
 *
 * Purely presentational: it receives the SAME `ventas` the list renders
 * (design.md D2 — never a second request) plus `isLoading`, and reduces them
 * via `calcularTotalesDelDia`.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TotalesDelDia } from './TotalesDelDia'
import type { VentaListItem } from '@shared/api/api'

function venta(overrides: Partial<VentaListItem>): VentaListItem {
  return {
    id: 'v-1',
    negocio_id: 'negocio-1',
    cliente_id: null,
    fecha: '2026-08-13',
    monto: '100.00',
    forma_pago: 'EFECTIVO',
    notas: null,
    created_at: '2026-08-13T10:00:00',
    updated_at: '2026-08-13T10:00:00',
    ...overrides,
  }
}

describe('TotalesDelDia — the total (task 7.6)', () => {
  it('shows $4.000 total for $1.000 EFECTIVO + $2.500 TARJETA + $500 CUENTA_CORRIENTE, broken down by method', () => {
    const ventas = [
      venta({ id: 'v-1', monto: '1000.00', forma_pago: 'EFECTIVO' }),
      venta({ id: 'v-2', monto: '2500.00', forma_pago: 'TARJETA' }),
      venta({ id: 'v-3', monto: '500.00', forma_pago: 'CUENTA_CORRIENTE' }),
    ]
    render(<TotalesDelDia ventas={ventas} isLoading={false} />)

    expect(screen.getByText(/\$\s?4\.000,00/)).toBeInTheDocument()
    expect(screen.getByText(/\$\s?1\.000,00/)).toBeInTheDocument()
    expect(screen.getByText(/\$\s?2\.500,00/)).toBeInTheDocument()
    expect(screen.getByText(/\$\s?500,00/)).toBeInTheDocument()
  })
})

describe('TotalesDelDia — loading affordance, no false zero (task 7.7)', () => {
  it('shows a loading affordance and does NOT render $0 while loading', () => {
    render(<TotalesDelDia ventas={undefined} isLoading={true} />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByText(/\$\s?0,00/)).not.toBeInTheDocument()
  })

  it('shows $0 and an empty breakdown once loading finishes on an empty day (triangulation)', () => {
    render(<TotalesDelDia ventas={[]} isLoading={false} />)

    expect(screen.getByText(/\$\s?0,00/)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
