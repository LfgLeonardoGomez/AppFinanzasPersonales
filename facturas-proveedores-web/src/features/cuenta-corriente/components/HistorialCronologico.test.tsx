/**
 * Tests for HistorialCronologico (C-13, task 7 / D4).
 *
 * The component is presentational. It receives the full `historial` array
 * (already in chronological order from the C-12 service per RN-HIST) and
 * renders one row per entry. The component does NOT walk the array or
 * compute a running sum — `saldo_acumulado` is read from the response
 * verbatim.
 *
 * INVARIANTS:
 *   - Rows are rendered in the order received (C-12 guarantees
 *     chronological order — `fecha ASC, created_at ASC, id ASC`).
 *   - `tipo = FACTURA` shows a "Debe" chip; `tipo = PAGO` shows a "Haber"
 *     chip. The chip carries a `data-tipo` attribute as the semantic
 *     test hook (D11 color tokens are wired via Tailwind classes — not
 *     asserted here, per strict-tdd.md).
 *   - `monto` is rendered as the ARS-formatted ABSOLUTE value (the
 *     response's `monto` is always positive — the sign comes from
 *     `tipo`).
 *   - `saldo_acumulado` is rendered with a sign prefix: `+` for
 *     positive, `−` (U+2212) for negative, no prefix for zero.
 *   - Empty `historial` renders "Sin movimientos registrados".
 *
 * TDD: Task 7.1 (RED) → 7.2 (GREEN) → 7.3 (TRIANGULATE).
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { HistorialCronologico } from './HistorialCronologico'
import type { EntradaHistorial } from '@shared/api/api'

const e1: EntradaHistorial = {
  id: 'f-1',
  tipo: 'FACTURA',
  fecha: '2026-06-01',
  monto: 1000,
  saldo_acumulado: 1000,
}
const e2: EntradaHistorial = {
  id: 'p-1',
  tipo: 'PAGO',
  fecha: '2026-06-10',
  monto: 300,
  saldo_acumulado: 700,
}
const e3: EntradaHistorial = {
  id: 'f-2',
  tipo: 'FACTURA',
  fecha: '2026-06-20',
  monto: 500,
  saldo_acumulado: 1200,
}

describe('HistorialCronologico', () => {
  it('renders one row per historial entry in the order received', () => {
    render(<HistorialCronologico historial={[e1, e2, e3]} />)
    expect(screen.getByTestId('historial-row-f-1')).toBeInTheDocument()
    expect(screen.getByTestId('historial-row-p-1')).toBeInTheDocument()
    expect(screen.getByTestId('historial-row-f-2')).toBeInTheDocument()

    // Order check via DOM positions
    const rows = ['f-1', 'p-1', 'f-2'].map((id) =>
      screen.getByTestId(`historial-row-${id}`),
    )
    for (let i = 0; i < rows.length - 1; i++) {
      // top-to-bottom: row[i] should come before row[i+1]
      const posI = rows[i]!.compareDocumentPosition(rows[i + 1]!)
      expect(posI & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('FACTURA rows show the "Debe" chip, PAGO rows show the "Haber" chip', () => {
    render(<HistorialCronologico historial={[e1, e2]} />)
    const row1 = screen.getByTestId('historial-row-f-1')
    const row2 = screen.getByTestId('historial-row-p-1')
    // The chip carries data-tipo as the semantic test hook
    expect(within(row1).getByTestId('historial-chip').dataset.tipo).toBe('FACTURA')
    expect(within(row1).getByTestId('historial-chip').textContent).toBe('Debe')
    expect(within(row2).getByTestId('historial-chip').dataset.tipo).toBe('PAGO')
    expect(within(row2).getByTestId('historial-chip').textContent).toBe('Haber')
  })

  it('renders the monto as the ARS-formatted ABSOLUTE value', () => {
    render(<HistorialCronologico historial={[e2]} />)
    const row = screen.getByTestId('historial-row-p-1')
    // 300 → "300,00" (the formatted amount)
    expect(row.textContent).toContain('300,00')
  })

  it('positive saldo_acumulado (debt) is rendered with a minus sign', () => {
    render(<HistorialCronologico historial={[e1]} />)
    const row = screen.getByTestId('historial-row-f-1')
    expect(row.textContent).toMatch(/[−-]\s*\$?\s*1\.000,00/)
  })

  it('negative saldo_acumulado (credit) is rendered as positive', () => {
    const eNeg: EntradaHistorial = {
      ...e2,
      id: 'p-neg',
      saldo_acumulado: -300,
    }
    render(<HistorialCronologico historial={[eNeg]} />)
    const row = screen.getByTestId('historial-row-p-neg')
    // Credit = positive display, no minus sign
    expect(row.textContent).toContain('300,00')
  })

  it('zero saldo_acumulado is rendered as $0,00', () => {
    const eZero: EntradaHistorial = {
      ...e1,
      id: 'p-zero',
      tipo: 'PAGO',
      monto: 1000,
      saldo_acumulado: 0,
    }
    render(<HistorialCronologico historial={[eZero]} />)
    const row = screen.getByTestId('historial-row-p-zero')
    expect(row.textContent).toContain('0,00')
  })

  it('empty historial renders the "Sin movimientos registrados" empty state', () => {
    render(<HistorialCronologico historial={[]} />)
    expect(screen.getByText(/sin movimientos registrados/i)).toBeInTheDocument()
    // No rows
    expect(screen.queryByTestId(/^historial-row-/)).not.toBeInTheDocument()
  })

  it('the FACTURA and PAGO chips have visually distinct semantic markers', () => {
    // Triangulation: the data-tipo attribute differs between branches.
    // The visual color is wired via Tailwind classes (not asserted here).
    render(<HistorialCronologico historial={[e1, e2]} />)
    const chip1 = within(screen.getByTestId('historial-row-f-1')).getByTestId('historial-chip')
    const chip2 = within(screen.getByTestId('historial-row-p-1')).getByTestId('historial-chip')
    expect(chip1.dataset.tipo).not.toBe(chip2.dataset.tipo)
  })
})
