/**
 * Tests for the PropuestaFacturaFields component (C-15, section 4).
 *
 * TDD: Task 4.1 (RED) → 4.2 (GREEN) → 4.3 (TRIANGULATE).
 *
 * The component is a presentational field group that displays the
 * C-14 `PropuestaFactura` proposal inside the modal's `proposal` state.
 * Editing any input fires `onChange` with the updated proposal. The
 * `SupplierSearch` receives the detected `proveedor_nombre` as the
 * initial query BUT its `value` is `null` until the user explicitly
 * picks a supplier (RN-IA-06 — the IA never pre-selects).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { PropuestaFactura } from '@shared/api/api'
import { PropuestaFacturaFields } from './PropuestaFacturaFields'

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const fullPropuesta: PropuestaFactura = {
  proveedor_nombre: 'Acme SA',
  numero: '0001-00012345',
  fecha_emision: '2026-06-15',
  monto_total: 12345.67,
  error: false,
  error_message: null,
}

const partialPropuesta: PropuestaFactura = {
  proveedor_nombre: 'Acme SA',
  numero: null,
  fecha_emision: '2026-06-15',
  monto_total: null,
  error: false,
  error_message: null,
}

describe('PropuestaFacturaFields — Task 4.1', () => {
  it('renders inputs for numero, fecha_emision, monto_total, and the SupplierSearch', () => {
    render(
      <PropuestaFacturaFields propuesta={fullPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByLabelText(/Número/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Fecha de emisión/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Monto total/i)).toBeInTheDocument()
    // The SupplierSearch has a "Buscar proveedor" placeholder
    expect(screen.getByPlaceholderText(/Buscar proveedor/i)).toBeInTheDocument()
  })

  it('fires onChange with the updated PropuestaFactura when the monto_total input is edited', () => {
    const onChange = vi.fn()
    render(
      <PropuestaFacturaFields propuesta={fullPropuesta} onChange={onChange} />,
      { wrapper: makeWrapper() },
    )
    const input = screen.getByLabelText(/Monto total/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '999.99' } })
    expect(onChange).toHaveBeenCalled()
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as PropuestaFactura
    expect(lastCall.monto_total).toBe(999.99)
  })

  it('a null monto_total renders an empty input (RN-IA-03)', () => {
    render(
      <PropuestaFacturaFields propuesta={partialPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    const input = screen.getByLabelText(/Monto total/i) as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('a null fecha_emision renders an empty date input', () => {
    const empty: PropuestaFactura = {
      ...partialPropuesta,
      fecha_emision: null,
    }
    render(
      <PropuestaFacturaFields propuesta={empty} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    const input = screen.getByLabelText(/Fecha de emisión/i) as HTMLInputElement
    expect(input.value).toBe('')
  })
})

describe('PropuestaFacturaFields — Task 4.3, TRIANGULATE (RN-IA-06)', () => {
  it('the SupplierSearch value is null even when propuesta.proveedor_nombre is non-null (no pre-select)', () => {
    render(
      <PropuestaFacturaFields propuesta={fullPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    // The SupplierSearch has no chip / no selected supplier — only the
    // empty query input is rendered. The structural absence is the
    // RN-IA-06 contract: the IA never pre-selects. The detected name
    // is surfaced as a "Detected by IA" hint below the input (see
    // PropuestaFacturaFields.tsx), so the user knows what the IA
    // found without an automatic onChange firing.
    const input = screen.getByPlaceholderText(/Buscar proveedor/i) as HTMLInputElement
    expect(input.value).toBe('')
    // The "Detected by IA" hint is shown (the IA read the name; the
    // user is the one who picks).
    expect(screen.getByText(/Detectado por IA:/)).toBeInTheDocument()
    expect(screen.getByText('Acme SA')).toBeInTheDocument()
    // No close / clear-selection button (which the C-07 SupplierSearch
    // renders when value !== null).
    expect(screen.queryByRole('button', { name: /Quitar/i })).not.toBeInTheDocument()
  })
})
