/**
 * Tests for TablaFacturasConEstado (C-13, task 6 / D3).
 *
 * The component is presentational. It receives the full
 * `facturas_con_estado` array (already small for MVP) and the filter
 * state, and applies the filter on the response payload — the
 * component does NOT call any hook. Filters are client-side; the C-12
 * endpoint has no query parameters (hard rule #3).
 *
 * INVARIANTS:
 *   - One `<tr>` per `facturas[i]` (or the empty-state copy).
 *   - Each row's `estado` is rendered via the existing `EstadoBadge`
 *     from C-09 (reused, not duplicated).
 *   - `monto_total` is formatted via the shared `formatMonto` helper
 *     (C-13 currency refactor).
 *   - `archivo_url` is rendered as an external link when present.
 *   - When the filter result is empty, the "No hay facturas con esos
 *     filtros" copy + "Limpiar filtros" CTA is shown.
 *
 * TDD: Task 6.1 (RED) → 6.2 (GREEN) → 6.3 (TRIANGULATE).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TablaFacturasConEstado } from './TablaFacturasConEstado'
import type { FacturaConEstado, FiltrosFacturas } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseFactura = (
  id: string,
  estado: FacturaConEstado['estado'],
  fechaEmision: string,
  montoTotal = 1500,
  numero: string | null = `FAC-${id}`,
  archivoUrl: string | null = null,
): FacturaConEstado => ({
  id,
  usuario_id: 'user-1',
  proveedor_id: 'proveedor-uuid-1',
  numero,
  fecha_emision: fechaEmision,
  fecha_vencimiento: null,
  monto_total: montoTotal,
  archivo_url: archivoUrl,
  origen: 'MANUAL',
  estado,
  created_at: '2026-06-01T10:00:00',
  updated_at: '2026-06-01T10:00:00',
})

const f1: FacturaConEstado = baseFactura('f-1', 'PENDIENTE', '2026-06-01', 1500)
const f2: FacturaConEstado = baseFactura('f-2', 'PARCIAL', '2026-06-15', 2500, 'FAC-002', 'https://example.com/f2.pdf')
const f3: FacturaConEstado = baseFactura('f-3', 'PAGADA', '2026-06-30', 3000)

const allFacturas: FacturaConEstado[] = [f1, f2, f3]

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TablaFacturasConEstado', () => {
  it('renders one row per factura when filters are empty', () => {
    render(
      <TablaFacturasConEstado
        facturas={allFacturas}
        filters={{}}
        onChangeFilters={vi.fn()}
      />,
    )
    // The body has 3 rows (the header has its own tr; this assertion uses
    // a stable semantic — the data-row test ids).
    expect(screen.getByTestId('tabla-facturas-row-f-1')).toBeInTheDocument()
    expect(screen.getByTestId('tabla-facturas-row-f-2')).toBeInTheDocument()
    expect(screen.getByTestId('tabla-facturas-row-f-3')).toBeInTheDocument()
  })

  it('each row carries the EstadoBadge matching the row.estado (C-09 reuse)', () => {
    render(
      <TablaFacturasConEstado
        facturas={allFacturas}
        filters={{}}
        onChangeFilters={vi.fn()}
      />,
    )
    const row1 = screen.getByTestId('tabla-facturas-row-f-1')
    const row2 = screen.getByTestId('tabla-facturas-row-f-2')
    const row3 = screen.getByTestId('tabla-facturas-row-f-3')
    // EstadoBadge shows the literal estado value as text (per the C-09 impl)
    expect(within(row1).getByText('PENDIENTE')).toBeInTheDocument()
    expect(within(row2).getByText('PARCIAL')).toBeInTheDocument()
    expect(within(row3).getByText('PAGADA')).toBeInTheDocument()
  })

  it('renders a "Ver archivo" button (not a link) when archivo_url is present (C-24: in-app preview)', () => {
    render(
      <TablaFacturasConEstado
        facturas={allFacturas}
        filters={{}}
        onChangeFilters={vi.fn()}
      />,
    )
    // C-24: the file opens in an in-app dialog, not a new browser tab —
    // the affordance is a button, not an <a target="_blank">.
    const button = screen.getByRole('button', { name: /ver archivo/i })
    expect(button).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /ver archivo/i })).not.toBeInTheDocument()
  })

  it('does NOT render a "Ver archivo" control when archivo_url is null', () => {
    render(
      <TablaFacturasConEstado
        facturas={[f1, f3]}
        filters={{}}
        onChangeFilters={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /ver archivo/i })).not.toBeInTheDocument()
  })

  it('clicking "Ver archivo" opens the ArchivoPreviewDialog with that row\'s archivo_url', async () => {
    const user = userEvent.setup()
    render(
      <TablaFacturasConEstado
        facturas={allFacturas}
        filters={{}}
        onChangeFilters={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: /ver archivo/i }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByRole('link', { name: /abrir en pestaña nueva/i })).toHaveAttribute(
      'href',
      'https://example.com/f2.pdf',
    )
  })

  it('formats monto_total via the shared formatMonto (ARS currency)', () => {
    render(
      <TablaFacturasConEstado
        facturas={[f2]}
        filters={{}}
        onChangeFilters={vi.fn()}
      />,
    )
    // 2500 → $ 2.500,00 (es-AR). The formatMonto helper uses a NARROW
    // NO-BREAK SPACE (U+202F) between $ and the digits; we assert on
    // the digit+separator part only.
    const row = screen.getByTestId('tabla-facturas-row-f-2')
    expect(row.textContent).toContain('2.500,00')
  })

  it('estado filter narrows the rendered rows to the matching estado only', () => {
    const filters: FiltrosFacturas = { estado: 'PENDIENTE' }
    render(
      <TablaFacturasConEstado
        facturas={allFacturas}
        filters={filters}
        onChangeFilters={vi.fn()}
      />,
    )
    expect(screen.getByTestId('tabla-facturas-row-f-1')).toBeInTheDocument()
    expect(screen.queryByTestId('tabla-facturas-row-f-2')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tabla-facturas-row-f-3')).not.toBeInTheDocument()
  })

  it('fecha_desde filter includes only rows with fecha_emision >= the bound', () => {
    const filters: FiltrosFacturas = { fecha_desde: '2026-06-15' }
    render(
      <TablaFacturasConEstado
        facturas={allFacturas}
        filters={filters}
        onChangeFilters={vi.fn()}
      />,
    )
    // f-1 (2026-06-01) is excluded, f-2 (2026-06-15) included (boundary),
    // f-3 (2026-06-30) included.
    expect(screen.queryByTestId('tabla-facturas-row-f-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('tabla-facturas-row-f-2')).toBeInTheDocument()
    expect(screen.getByTestId('tabla-facturas-row-f-3')).toBeInTheDocument()
  })

  it('fecha range filter (desde AND hasta) composes', () => {
    const filters: FiltrosFacturas = {
      fecha_desde: '2026-06-10',
      fecha_hasta: '2026-06-20',
    }
    render(
      <TablaFacturasConEstado
        facturas={allFacturas}
        filters={filters}
        onChangeFilters={vi.fn()}
      />,
    )
    // Only f-2 (2026-06-15) is in range.
    expect(screen.queryByTestId('tabla-facturas-row-f-1')).not.toBeInTheDocument()
    expect(screen.getByTestId('tabla-facturas-row-f-2')).toBeInTheDocument()
    expect(screen.queryByTestId('tabla-facturas-row-f-3')).not.toBeInTheDocument()
  })

  it('combined filters (estado + fecha range) compose', () => {
    const filters: FiltrosFacturas = {
      estado: 'PARCIAL',
      fecha_desde: '2026-06-01',
      fecha_hasta: '2026-06-30',
    }
    render(
      <TablaFacturasConEstado
        facturas={allFacturas}
        filters={filters}
        onChangeFilters={vi.fn()}
      />,
    )
    // Only f-2 satisfies both.
    expect(screen.getByTestId('tabla-facturas-row-f-2')).toBeInTheDocument()
    expect(screen.queryByTestId('tabla-facturas-row-f-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tabla-facturas-row-f-3')).not.toBeInTheDocument()
  })

  it('empty filter result shows "No hay facturas con esos filtros" + a "Limpiar filtros" button', () => {
    const filters: FiltrosFacturas = { estado: 'PAGADA' }
    // No PAGADA in our mixed set
    const noPagada: FacturaConEstado[] = [f1, f2]
    const onChangeFilters = vi.fn()
    render(
      <TablaFacturasConEstado
        facturas={noPagada}
        filters={filters}
        onChangeFilters={onChangeFilters}
      />,
    )
    expect(screen.getByText(/no hay facturas con esos filtros/i)).toBeInTheDocument()
    // Two "Limpiar filtros" buttons are present in the empty state:
    // one inside the FiltrosFacturas control, one in the empty-state
    // CTA. Both call onChangeFilters({}) — we click the first.
    const clearButtons = screen.getAllByRole('button', { name: /limpiar filtros/i })
    expect(clearButtons.length).toBeGreaterThanOrEqual(1)
    fireEvent.click(clearButtons[0]!)
    expect(onChangeFilters).toHaveBeenCalledWith({})
  })

  it('switching rows swaps the previewed file (C-24 triangulate)', async () => {
    const f4 = baseFactura(
      'f-4',
      'PAGADA',
      '2026-07-01',
      1000,
      'FAC-004',
      'https://example.com/f4.png',
    )
    const user = userEvent.setup()
    render(
      <TablaFacturasConEstado
        facturas={[...allFacturas, f4]}
        filters={{}}
        onChangeFilters={vi.fn()}
      />,
    )
    const buttons = screen.getAllByRole('button', { name: /ver archivo/i })
    expect(buttons).toHaveLength(2)

    await user.click(buttons[0]!)
    expect(
      within(screen.getByRole('dialog')).getByRole('link', { name: /abrir en pestaña nueva/i }),
    ).toHaveAttribute('href', 'https://example.com/f2.pdf')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    const buttonsAfterClose = screen.getAllByRole('button', { name: /ver archivo/i })
    await user.click(buttonsAfterClose[1]!)
    expect(
      within(screen.getByRole('dialog')).getByRole('link', { name: /abrir en pestaña nueva/i }),
    ).toHaveAttribute('href', 'https://example.com/f4.png')
  })
})
