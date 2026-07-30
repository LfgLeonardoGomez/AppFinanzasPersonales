/**
 * Tests for PagosRegistrados — "Pagos" tab of the cuenta-corriente toggle.
 *
 * The component is presentational: it receives the `historial` entries
 * already filtered to `tipo === 'PAGO'` by the parent (CuentaCorrientePage)
 * and renders one row per entry (fecha, monto with a "-" prefix).
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PagosRegistrados } from './PagosRegistrados'
import type { EntradaHistorial } from '@shared/api/api'

const pago1: EntradaHistorial = {
  id: 'pago-1',
  tipo: 'PAGO',
  fecha: '2026-07-05',
  monto: 64200,
  saldo_acumulado: 1000,
  archivo_url: 'https://res.cloudinary.com/demo/comprobantes/pago-1.jpg',
}

const pago2: EntradaHistorial = {
  id: 'pago-2',
  tipo: 'PAGO',
  fecha: '2026-06-20',
  monto: 41000,
  saldo_acumulado: 41000,
  archivo_url: null,
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

  it('a pago with a comprobante shows a "Ver archivo" button that opens the preview dialog (C-24)', async () => {
    const user = userEvent.setup()
    render(<PagosRegistrados pagos={[pago1]} />)
    const row = screen.getByTestId('pagos-row-pago-1')
    const button = within(row).getByRole('button', { name: /ver archivo/i })
    await user.click(button)
    const dialog = screen.getByRole('dialog')
    expect(
      within(dialog).getByRole('link', { name: /abrir en pestaña nueva/i }),
    ).toHaveAttribute('href', 'https://res.cloudinary.com/demo/comprobantes/pago-1.jpg')
  })

  it('a pago without a comprobante shows the "—" placeholder and no button (C-24)', () => {
    render(<PagosRegistrados pagos={[pago2]} />)
    const row = screen.getByTestId('pagos-row-pago-2')
    expect(within(row).queryByRole('button', { name: /ver archivo/i })).not.toBeInTheDocument()
    expect(within(row).getByText('—')).toBeInTheDocument()
  })
})
