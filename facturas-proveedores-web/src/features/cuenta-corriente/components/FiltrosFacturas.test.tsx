/**
 * Tests for FiltrosFacturas (C-13, task 5).
 *
 * The component is a controlled set of three inputs (estado select,
 * fecha_desde, fecha_hasta) plus a "Limpiar filtros" CTA. It receives
 * the current filter state and an `onChange` callback; the parent
 * (CuentaCorrientePage) owns the state and applies the filter to the
 * response payload.
 *
 * INVARIANTS (D3 / D8):
 *   - Filters are applied CLIENT-SIDE on the response payload. The hook
 *     has no query params; the C-12 endpoint has no query parameters.
 *     The "Todos" option sends `onChange({})`, NOT `onChange({ estado:
 *     undefined })` — the parent uses the absence of a key to mean
 *     "no filter".
 *
 * TDD: Task 5.1 (RED) → 5.2 (GREEN) → 5.3 (TRIANGULATE).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { FiltrosFacturas } from './FiltrosFacturas'
import type { FiltrosFacturas as FiltrosFacturasType } from '@shared/api/api'

function noop() {}

describe('FiltrosFacturas', () => {
  it('renders three controls: estado select, fecha_desde, fecha_hasta', () => {
    render(<FiltrosFacturas filters={{}} onChange={noop} />)
    expect(screen.getByLabelText(/estado/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fecha desde/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/fecha hasta/i)).toBeInTheDocument()
  })

  it('renders the estado options Todos / PENDIENTE / PARCIAL / PAGADA', () => {
    render(<FiltrosFacturas filters={{}} onChange={noop} />)
    const select = screen.getByLabelText(/estado/i) as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value)
    expect(values).toEqual(['', 'PENDIENTE', 'PARCIAL', 'PAGADA'])
    // Sanity: the empty-string option is the "Todos" sentinel
    expect(select.options[0]?.textContent?.toLowerCase()).toContain('todos')
  })

  it('selecting estado = PENDIENTE calls onChange with { estado: "PENDIENTE" }', () => {
    const onChange = vi.fn()
    render(<FiltrosFacturas filters={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(/estado/i), {
      target: { value: 'PENDIENTE' },
    })
    expect(onChange).toHaveBeenCalledWith({ estado: 'PENDIENTE' })
  })

  it('selecting fecha_desde calls onChange with the date', () => {
    const onChange = vi.fn()
    render(<FiltrosFacturas filters={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(/fecha desde/i), {
      target: { value: '2026-06-01' },
    })
    expect(onChange).toHaveBeenCalledWith({ fecha_desde: '2026-06-01' })
  })

  it('selecting fecha_hasta calls onChange with the date', () => {
    const onChange = vi.fn()
    render(<FiltrosFacturas filters={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(/fecha hasta/i), {
      target: { value: '2026-06-30' },
    })
    expect(onChange).toHaveBeenCalledWith({ fecha_hasta: '2026-06-30' })
  })

  it('selecting both estado and a date calls onChange with both fields', () => {
    const onChange = vi.fn()
    const initial: FiltrosFacturasType = { estado: 'PARCIAL' }
    render(<FiltrosFacturas filters={initial} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText(/fecha desde/i), {
      target: { value: '2026-06-01' },
    })
    expect(onChange).toHaveBeenCalledWith({
      estado: 'PARCIAL',
      fecha_desde: '2026-06-01',
    })
  })

  it('does NOT show "Limpiar filtros" when filters is empty', () => {
    render(<FiltrosFacturas filters={{}} onChange={noop} />)
    expect(screen.queryByRole('button', { name: /limpiar/i })).not.toBeInTheDocument()
  })

  it('shows "Limpiar filtros" when at least one filter is set; clicking it calls onChange({})', () => {
    const onChange = vi.fn()
    render(
      <FiltrosFacturas
        filters={{ estado: 'PENDIENTE' }}
        onChange={onChange}
      />,
    )
    const clear = screen.getByRole('button', { name: /limpiar/i })
    expect(clear).toBeInTheDocument()
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('selecting "Todos" (empty value) calls onChange with {} — NOT with undefined fields', () => {
    // Triangulation: the absence of a key on the parent state means "no
    // filter". Sending `{ estado: undefined }` would be a different shape
    // and would break the parent's "Object.keys(filters).length === 0"
    // detection for the empty state.
    const onChange = vi.fn()
    render(
      <FiltrosFacturas filters={{ estado: 'PARCIAL' }} onChange={onChange} />,
    )
    fireEvent.change(screen.getByLabelText(/estado/i), {
      target: { value: '' },
    })
    expect(onChange).toHaveBeenCalledWith({})
  })
})
