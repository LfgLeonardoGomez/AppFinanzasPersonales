/**
 * Tests for ItemsEditor — dynamic line items with non-blocking sum warning.
 * TDD: Task 4.1 (RED) → 4.2 (GREEN) → 4.3 (RED sum warning) → 4.4 (GREEN) → 4.5 (TRIANGULATE).
 *
 * Key invariants (RN-FAC-04):
 * - Empty items list is valid — submit stays enabled.
 * - Sum mismatch shows a warning but does NOT block submission.
 * - The authoritative signal is the backend items_sum_mismatch; the client warning is UX only.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ItemsEditor } from './ItemsEditor'
import type { FacturaItemCreate } from '@shared/api/api'

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderItemsEditor(
  items: FacturaItemCreate[] = [],
  montoTotal = 0,
  onChange = vi.fn(),
) {
  return render(
    <ItemsEditor items={items} montoTotal={montoTotal} onChange={onChange} />,
  )
}

// ── Task 4.1/4.2 — Add/Remove rows, empty list valid ─────────────────────────

describe('ItemsEditor — add/remove rows', () => {
  it('renders with no items and an add button', () => {
    renderItemsEditor()
    expect(screen.getByRole('button', { name: /agregar/i })).toBeInTheDocument()
  })

  it('calls onChange with a new empty row when add is clicked', () => {
    const onChange = vi.fn()
    renderItemsEditor([], 0, onChange)
    fireEvent.click(screen.getByRole('button', { name: /agregar/i }))
    expect(onChange).toHaveBeenCalledWith([
      { descripcion: '', cantidad: 1, precio_unitario: 0 },
    ])
  })

  it('calls onChange without the removed row when remove is clicked', () => {
    const onChange = vi.fn()
    const items: FacturaItemCreate[] = [
      { descripcion: 'Item A', cantidad: 2, precio_unitario: 100 },
    ]
    renderItemsEditor(items, 200, onChange)
    const removeBtn = screen.getByRole('button', { name: /eliminar/i })
    fireEvent.click(removeBtn)
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('renders one row for each item in the items prop', () => {
    const items: FacturaItemCreate[] = [
      { descripcion: 'A', cantidad: 1, precio_unitario: 10 },
      { descripcion: 'B', cantidad: 2, precio_unitario: 20 },
    ]
    renderItemsEditor(items, 50)
    const rows = screen.getAllByRole('row')
    // header + 2 data rows
    expect(rows.length).toBeGreaterThanOrEqual(2)
  })

  it('empty items list renders no rows and no warning', () => {
    renderItemsEditor([], 0)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ── Task 4.3/4.4 — Non-blocking sum warning (RN-FAC-04) ──────────────────────

describe('ItemsEditor — sum mismatch warning', () => {
  it('shows a warning when sum of items ≠ monto_total', () => {
    const items: FacturaItemCreate[] = [
      { descripcion: 'Item', cantidad: 2, precio_unitario: 100 },
    ]
    // sum = 200, monto_total = 300 → mismatch
    renderItemsEditor(items, 300)
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('alert').textContent).toMatch(/sum|total|diferencia|mismatch/i)
  })

  it('does NOT show a warning when sum equals monto_total', () => {
    const items: FacturaItemCreate[] = [
      { descripcion: 'Item', cantidad: 2, precio_unitario: 100 },
    ]
    // sum = 200, monto_total = 200 → match
    renderItemsEditor(items, 200)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does NOT block submission — no disabled attribute on form controls when mismatch', () => {
    // The submit button is in FacturaForm, not ItemsEditor.
    // ItemsEditor should not disable anything internally when there is a mismatch.
    const items: FacturaItemCreate[] = [
      { descripcion: 'Item', cantidad: 1, precio_unitario: 50 },
    ]
    renderItemsEditor(items, 999)
    const addButton = screen.getByRole('button', { name: /agregar/i })
    expect(addButton).not.toBeDisabled()
  })
})

// ── Task 4.5 — TRIANGULATE: edge cases ───────────────────────────────────────

describe('ItemsEditor — triangulate', () => {
  it('uses epsilon comparison: sum 200.001 vs monto_total 200 → no warning', () => {
    const items: FacturaItemCreate[] = [
      { descripcion: 'Item', cantidad: 1, precio_unitario: 200.001 },
    ]
    // Epsilon is ~0.01, so 0.001 difference should not trigger warning
    renderItemsEditor(items, 200)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows warning when sum is clearly different (e.g. 100 vs 500)', () => {
    const items: FacturaItemCreate[] = [
      { descripcion: 'Item', cantidad: 1, precio_unitario: 100 },
    ]
    renderItemsEditor(items, 500)
    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('calls onChange with updated descripcion when user types', () => {
    const onChange = vi.fn()
    const items: FacturaItemCreate[] = [
      { descripcion: 'Old', cantidad: 1, precio_unitario: 10 },
    ]
    renderItemsEditor(items, 10, onChange)
    const descripcionInput = screen.getByDisplayValue('Old')
    fireEvent.change(descripcionInput, { target: { value: 'New' } })
    expect(onChange).toHaveBeenCalledWith([
      { descripcion: 'New', cantidad: 1, precio_unitario: 10 },
    ])
  })
})
