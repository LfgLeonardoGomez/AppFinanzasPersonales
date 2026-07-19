/**
 * Tests for PagosRegistrados — "Pagos" tab of the cuenta-corriente toggle.
 *
 * The component is presentational: it receives the `historial` entries
 * already filtered to `tipo === 'PAGO'` by the parent (CuentaCorrientePage)
 * and renders one row per entry (fecha, monto with a "-" prefix).
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PagosRegistrados } from './PagosRegistrados'
import type { EntradaHistorial } from '@shared/api/api'

const pago1: EntradaHistorial = {
  id: 'pago-1',
  tipo: 'PAGO',
  fecha: '2026-07-05',
  monto: 64200,
  saldo_acumulado: 1000,
}

const pago2: EntradaHistorial = {
  id: 'pago-2',
  tipo: 'PAGO',
  fecha: '2026-06-20',
  monto: 41000,
  saldo_acumulado: 41000,
}

describe('PagosRegistrados', () => {
  it('renders "No hay pagos registrados." when the list is empty', () => {
    render(<PagosRegistrados pagos={[]} />)
    expect(screen.getByText(/no hay pagos registrados/i)).toBeInTheDocument()
  })

  it('renders one row per pago with fecha and a "-" prefixed monto', () => {
    render(<PagosRegistrados pagos={[pago1, pago2]} />)
    expect(screen.getByTestId('pagos-row-pago-1')).toBeInTheDocument()
    expect(screen.getByTestId('pagos-row-pago-2')).toBeInTheDocument()
    expect(screen.getByText('2026-07-05')).toBeInTheDocument()
    expect(screen.getByText(/-\$?\s*64\.200,00/)).toBeInTheDocument()
  })

  it('renders rows in the order received (no client-side re-sorting)', () => {
    render(<PagosRegistrados pagos={[pago2, pago1]} />)
    const rows = screen.getAllByRole('row').slice(1) // drop header row
    expect(rows[0]).toHaveAttribute('data-testid', 'pagos-row-pago-2')
    expect(rows[1]).toHaveAttribute('data-testid', 'pagos-row-pago-1')
  })
})
