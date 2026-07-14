/**
 * Tests for CuentaCorrientePage (C-13, task 8 / D7).
 *
 * The component is purely presentational. It receives the full
 * `CuentaCorrienteResponse` triple and composes the three blocks:
 *   - SaldoBadge (sign-dispatched)
 *   - TablaFacturasConEstado (filterable)
 *   - HistorialCronologico (chronological)
 *
 * INVARIANTS:
 *   - The filter state is owned by the page (`useState`) and propagated
 *     to the table.
 *   - The empty triple (saldo=0, empty arrays) shows the "Sin
 *     movimientos registrados" empty state (D12). The page does NOT
 *     issue any HTTP request — it is presentational.
 *   - Cross-block invariant (C-12 D10): the last row of
 *     `HistorialCronologico.saldo_acumulado` equals the page's
 *     `SaldoBadge.saldo`. The test asserts this by composing the
 *     blocks and comparing the rendered values.
 *
 * TDD: Task 8.1 (RED) → 8.2 (GREEN) → 8.3 (TRIANGULATE).
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { CuentaCorrientePage } from './CuentaCorrientePage'
import type { CuentaCorrienteResponse, FacturaConEstado, EntradaHistorial } from '@shared/api/api'

const f1: FacturaConEstado = {
  id: 'f-1',
  usuario_id: 'user-1',
  proveedor_id: 'p-1',
  numero: 'FAC-001',
  fecha_emision: '2026-06-01',
  fecha_vencimiento: null,
  monto_total: 1500,
  archivo_url: null,
  origen: 'MANUAL',
  estado: 'PENDIENTE',
  created_at: '2026-06-01T10:00:00',
  updated_at: '2026-06-01T10:00:00',
}
const f2: FacturaConEstado = {
  ...f1,
  id: 'f-2',
  numero: 'FAC-002',
  fecha_emision: '2026-06-20',
  monto_total: 500,
  estado: 'PAGADA',
}

const h1: EntradaHistorial = {
  id: 'f-1',
  tipo: 'FACTURA',
  fecha: '2026-06-01',
  monto: 1500,
  saldo_acumulado: 1500,
}
const h2: EntradaHistorial = {
  id: 'f-2',
  tipo: 'FACTURA',
  fecha: '2026-06-20',
  monto: 500,
  saldo_acumulado: 2000,
}

const triple: CuentaCorrienteResponse = {
  proveedor_id: 'p-1',
  saldo: 2000,
  facturas_con_estado: [f1, f2],
  historial: [h1, h2],
}

const emptyTriple: CuentaCorrienteResponse = {
  proveedor_id: 'p-empty',
  saldo: 0,
  facturas_con_estado: [],
  historial: [],
}

describe('CuentaCorrientePage', () => {
  it('renders the SaldoBadge with the response saldo', () => {
    render(<CuentaCorrientePage cuentaCorriente={triple} />)
    const badge = screen.getByTestId('saldo-badge')
    expect(badge).toBeInTheDocument()
    // 2000 > 0 → deuda variant
    expect(badge.dataset.variant).toBe('deuda')
    expect(badge.textContent).toContain('2.000,00')
  })

  it('renders the TablaFacturasConEstado with the full facturas_con_estado array (no filter)', () => {
    render(<CuentaCorrientePage cuentaCorriente={triple} />)
    expect(screen.getByTestId('tabla-facturas-row-f-1')).toBeInTheDocument()
    expect(screen.getByTestId('tabla-facturas-row-f-2')).toBeInTheDocument()
  })

  it('renders the HistorialCronologico with the full historial array', () => {
    render(<CuentaCorrientePage cuentaCorriente={triple} />)
    expect(screen.getByTestId('historial-row-f-1')).toBeInTheDocument()
    expect(screen.getByTestId('historial-row-f-2')).toBeInTheDocument()
  })

  it('the empty triple (saldo=0, empty arrays) shows the empty state', () => {
    render(<CuentaCorrientePage cuentaCorriente={emptyTriple} />)
    expect(screen.getByText(/sin movimientos registrados/i)).toBeInTheDocument()
    // The SaldoBadge is still rendered (al-dia variant for 0)
    const badge = screen.getByTestId('saldo-badge')
    expect(badge.dataset.variant).toBe('al-dia')
    // No table rows from either table
    expect(screen.queryByTestId(/^tabla-facturas-row-/)).not.toBeInTheDocument()
    expect(screen.queryByTestId(/^historial-row-/)).not.toBeInTheDocument()
  })

  it('changing the filter in FiltrosFacturas propagates to the table', () => {
    render(<CuentaCorrientePage cuentaCorriente={triple} />)
    // Initially both rows are visible
    expect(screen.getByTestId('tabla-facturas-row-f-1')).toBeInTheDocument()
    expect(screen.getByTestId('tabla-facturas-row-f-2')).toBeInTheDocument()
    // Apply estado=PAGADA filter
    // Use a precise selector (the section also has "estado" in its aria-label)
    fireEvent.change(screen.getByLabelText('Estado'), {
      target: { value: 'PAGADA' },
    })
    // Only f-2 is PAGADA
    expect(screen.queryByTestId('tabla-facturas-row-f-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('tabla-facturas-row-f-2')).toBeInTheDocument()
  })

  it('cross-block invariant: the last historial row saldo_acumulado equals the SaldoBadge.saldo', () => {
    // C-12 D10 invariant: the last historial row's saldo_acumulado
    // equals the response's saldo. The page composes both blocks; we
    // assert the rendered values match.
    render(<CuentaCorrientePage cuentaCorriente={triple} />)
    const badge = screen.getByTestId('saldo-badge')
    const lastRow = screen.getByTestId('historial-row-f-2')
    const lastCell = within(lastRow).getByTestId('historial-saldo-acumulado')
    // Both render the ARS-formatted 2000.00 with the same sign.
    expect(badge.textContent).toContain('2.000,00')
    expect(lastCell.textContent).toContain('2.000,00')
  })
})
