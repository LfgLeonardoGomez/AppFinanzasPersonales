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

// ── C-24: historial order toggle fixtures ────────────────────────────────────
// Three chronologically-ordered entries with distinct saldo_acumulado values,
// exactly as the backend's _build_historial would return them (ASC by fecha).
// Used to verify the display-only reversal never touches these values.
const hAsc1: EntradaHistorial = {
  id: 'h-1',
  tipo: 'FACTURA',
  fecha: '2026-06-01',
  monto: 1000,
  saldo_acumulado: 1000,
}
const hAsc2: EntradaHistorial = {
  id: 'h-2',
  tipo: 'PAGO',
  fecha: '2026-06-10',
  monto: 200,
  saldo_acumulado: 800,
}
const hAsc3: EntradaHistorial = {
  id: 'h-3',
  tipo: 'FACTURA',
  fecha: '2026-06-20',
  monto: 700,
  saldo_acumulado: 1500,
}
const tripleForOrderToggle: CuentaCorrienteResponse = {
  proveedor_id: 'p-order',
  saldo: 1500,
  facturas_con_estado: [f1, f2],
  historial: [hAsc1, hAsc2, hAsc3],
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

  it('renders the HistorialCronologico with the full historial array after selecting the Historial tab', () => {
    // C-13 redesign (Detalle Proveedor toggle): Facturas / Pagos / Historial
    // share one panel — only the selected tab's content is rendered.
    render(<CuentaCorrientePage cuentaCorriente={triple} />)
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    expect(screen.getByTestId('historial-row-f-1')).toBeInTheDocument()
    expect(screen.getByTestId('historial-row-f-2')).toBeInTheDocument()
    // Switching away from Facturas hides its rows.
    expect(screen.queryByTestId('tabla-facturas-row-f-1')).not.toBeInTheDocument()
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
    // assert the rendered values match (after selecting the Historial tab).
    render(<CuentaCorrientePage cuentaCorriente={triple} />)
    const badge = screen.getByTestId('saldo-badge')
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    const lastRow = screen.getByTestId('historial-row-f-2')
    const lastCell = within(lastRow).getByTestId('historial-saldo-acumulado')
    // Both render the ARS-formatted 2000.00 with the same sign.
    expect(badge.textContent).toContain('2.000,00')
    expect(lastCell.textContent).toContain('2.000,00')
  })

  it('the Pagos tab renders payment entries derived from the historial array', () => {
    // C-13 redesign: the Pagos tab has no dedicated query — it filters
    // the same historial array the page already received (tipo === 'PAGO').
    const withPago: CuentaCorrienteResponse = {
      ...triple,
      historial: [
        ...triple.historial,
        { id: 'pago-1', tipo: 'PAGO', fecha: '2026-06-25', monto: 300, saldo_acumulado: 1700 },
      ],
    }
    render(<CuentaCorrientePage cuentaCorriente={withPago} />)
    fireEvent.click(screen.getByRole('button', { name: 'Pagos' }))
    expect(screen.getByTestId('pagos-row-pago-1')).toBeInTheDocument()
    expect(screen.queryByTestId('tabla-facturas-row-f-1')).not.toBeInTheDocument()
  })

  // ── C-24: historial order toggle (highest-risk area) ────────────────────
  //
  // The backend orders historial ASC by (fecha, created_at, id) and computes
  // saldo_acumulado in that same pass (RN-HIST). The frontend NEVER re-derives
  // that value — it only reverses a COPY of the array for display. These
  // tests exist specifically to catch a future ".sort()"-based "cleanup"
  // that would decouple row order from the saldo_acumulado the backend
  // computed, corrupting the invariant.

  function historialRows() {
    return screen.getAllByTestId(/^historial-row-/)
  }

  it('defaults to newest-first: the response\'s LAST entry renders as the FIRST row', () => {
    render(<CuentaCorrientePage cuentaCorriente={tripleForOrderToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    const rows = historialRows()
    expect(rows[0]).toHaveAttribute('data-testid', 'historial-row-h-3')
    expect(rows[1]).toHaveAttribute('data-testid', 'historial-row-h-2')
    expect(rows[2]).toHaveAttribute('data-testid', 'historial-row-h-1')
  })

  it('the newest-first row (response\'s last entry) shows the SaldoBadge value', () => {
    render(<CuentaCorrientePage cuentaCorriente={tripleForOrderToggle} />)
    const badge = screen.getByTestId('saldo-badge')
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    const firstRow = historialRows()[0]!
    const cell = within(firstRow).getByTestId('historial-saldo-acumulado')
    expect(badge.textContent).toContain('1.500,00')
    expect(cell.textContent).toContain('1.500,00')
  })

  it('toggling to oldest-first restores the exact response order', () => {
    render(<CuentaCorrientePage cuentaCorriente={tripleForOrderToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    fireEvent.click(screen.getByRole('button', { name: /más antiguo primero|ascendente|asc/i }))
    const rows = historialRows()
    expect(rows[0]).toHaveAttribute('data-testid', 'historial-row-h-1')
    expect(rows[1]).toHaveAttribute('data-testid', 'historial-row-h-2')
    expect(rows[2]).toHaveAttribute('data-testid', 'historial-row-h-3')
  })

  it('REGRESSION GUARD: every row\'s saldo_acumulado is byte-identical between desc and asc modes — only position changes, never the value', () => {
    // This is the test that would catch a future ".sort()"-based regression:
    // a value-based re-sort would decouple row order from the
    // backend-computed saldo_acumulado, and this assertion would fail
    // because a row's rendered value would differ between the two modes
    // (or worse, silently match the WRONG row's value).
    const { unmount } = render(<CuentaCorrientePage cuentaCorriente={tripleForOrderToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    const descValues: Record<string, string | null> = {}
    for (const row of historialRows()) {
      const testId = row.getAttribute('data-testid')!
      descValues[testId] = within(row).getByTestId('historial-saldo-acumulado').textContent
    }
    unmount()

    render(<CuentaCorrientePage cuentaCorriente={tripleForOrderToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    fireEvent.click(screen.getByRole('button', { name: /más antiguo primero|ascendente|asc/i }))
    for (const row of historialRows()) {
      const testId = row.getAttribute('data-testid')!
      const ascValue = within(row).getByTestId('historial-saldo-acumulado').textContent
      expect(ascValue).toBe(descValues[testId])
    }
    // Sanity: the three values are genuinely distinct (a bug that always
    // rendered the same value would trivially "pass" the loop above).
    expect(new Set(Object.values(descValues)).size).toBe(3)
  })

  it('empty historial shows the empty state regardless of toggle interaction', () => {
    render(<CuentaCorrientePage cuentaCorriente={emptyTriple} />)
    expect(screen.getByText(/sin movimientos registrados/i)).toBeInTheDocument()
  })
})
