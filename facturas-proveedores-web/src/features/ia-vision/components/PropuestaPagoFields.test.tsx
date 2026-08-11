/**
 * Tests for the PropuestaPagoFields component (C-15, section 5;
 * EXTENDED in C-21 task 5.1 to cover the new supplier control — the
 * pago path had NO supplier control at all before C-21).
 *
 * TDD: Task 5.1 (RED) → 5.2 (GREEN) → 5.3 (TRIANGULATE).
 *
 * Presentational field group for the C-14 `PropuestaPago` proposal.
 * The `metodo` is displayed as a `MetodoBadge` chip (visual hint) PLUS
 * an editable `<select>` (the user can override the IA's pick, per
 * OQ-6 in the design: a null metodo leaves the select empty; a
 * non-null metodo pre-selects the option but the user can change it).
 * The supplier control mirrors `PropuestaFacturaFields` exactly (D4):
 * a unique normalized-exact match auto-selects (changeable); no match
 * shows an inline "Crear «X»" action.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import type { PropuestaPago, ProveedorListItem } from '@shared/api/api'
import { PropuestaPagoFields } from './PropuestaPagoFields'

function proveedor(overrides: Partial<ProveedorListItem>): ProveedorListItem {
  return {
    id: 'prov-1',
    nombre: 'Acme SA',
    cuit: null,
    telefono: null,
    categoria: 'OTRO',
    notas: null,
    saldo: 0,
    created_at: '2026-06-01T00:00:00',
    updated_at: '2026-06-01T00:00:00',
    ...overrides,
  }
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

const fullPropuesta: PropuestaPago = {
  proveedor_nombre: 'Acme SA',
  monto: 5000,
  fecha: '2026-06-20',
  metodo: 'TRANSFERENCIA',
  error: false,
  error_message: null,
}

const emptyPropuesta: PropuestaPago = {
  proveedor_nombre: null,
  monto: null,
  fecha: null,
  metodo: null,
  error: false,
  error_message: null,
}

describe('PropuestaPagoFields — Task 5.1', () => {
  it('renders inputs for monto, fecha, and metodo (with the badge)', () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    render(
      <PropuestaPagoFields propuesta={fullPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByLabelText(/Monto/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Fecha/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/Método/i)).toBeInTheDocument()
    // The MetodoBadge renders the metodo as text
    expect(screen.getByText('TRANSFERENCIA')).toBeInTheDocument()
  })

  it('fires onChange with the updated PropuestaPago when the monto input is edited', () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    const onChange = vi.fn()
    render(
      <PropuestaPagoFields propuesta={fullPropuesta} onChange={onChange} />,
      { wrapper: makeWrapper() },
    )
    const input = screen.getByLabelText(/Monto/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '1234.56' } })
    expect(onChange).toHaveBeenCalled()
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0] as PropuestaPago
    expect(lastCall.monto).toBe(1234.56)
  })

  it('a null monto renders an empty input', () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    render(
      <PropuestaPagoFields propuesta={emptyPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    const input = screen.getByLabelText(/Monto/i) as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('a null metodo renders no badge and an empty select', () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    render(
      <PropuestaPagoFields propuesta={emptyPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    // The badge should NOT render when metodo is null (the visual chip
    // is a confirmation of the IA's read; when the IA couldn't read
    // it, there is nothing to confirm).
    expect(screen.queryByText('TRANSFERENCIA')).not.toBeInTheDocument()
    expect(screen.queryByText('EFECTIVO')).not.toBeInTheDocument()
    const select = screen.getByLabelText(/Método/i) as HTMLSelectElement
    expect(select.value).toBe('')
  })
})

describe('PropuestaPagoFields — Task 5.1, supplier control (D4 — mirrors factura)', () => {
  it('renders the SupplierSearch (the pago path had NO supplier control before C-21)', () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    render(
      <PropuestaPagoFields propuesta={fullPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByPlaceholderText(/Buscar proveedor/i)).toBeInTheDocument()
  })

  it('pre-selects the supplier on a normalized-exact unique match', async () => {
    server.use(
      http.get('/api/proveedores/buscar', () => HttpResponse.json([proveedor({ nombre: 'Acme SA' })])),
    )
    const onProveedorChange = vi.fn()
    render(
      <PropuestaPagoFields
        propuesta={fullPropuesta}
        onChange={vi.fn()}
        selectedProveedor={null}
        onProveedorChange={onProveedorChange}
      />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => {
      expect(onProveedorChange).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Acme SA' }))
    })
  })

  it('shows an inline "Crear «X»" action with the detected name editable when there is no match', async () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    render(
      <PropuestaPagoFields
        propuesta={fullPropuesta}
        onChange={vi.fn()}
        selectedProveedor={null}
        onProveedorChange={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Crear «Acme SA»/ })).toBeInTheDocument()
    })
  })

  it('the user can override the auto-match with a different selectedProveedor', () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    const overridden = proveedor({ id: 'prov-other', nombre: 'Otro Proveedor SRL' })
    render(
      <PropuestaPagoFields
        propuesta={fullPropuesta}
        onChange={vi.fn()}
        selectedProveedor={overridden}
        onProveedorChange={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Otro Proveedor SRL')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Crear «Acme SA»/ })).not.toBeInTheDocument()
  })
})

describe('PropuestaPagoFields — Task 5.3, TRIANGULATE', () => {
  it('a complete propuesta populates all inputs (monto, fecha, metodo select)', () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    render(
      <PropuestaPagoFields propuesta={fullPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    expect((screen.getByLabelText(/Monto/i) as HTMLInputElement).value).toBe('5000')
    expect((screen.getByLabelText(/Fecha/i) as HTMLInputElement).value).toBe('2026-06-20')
    expect((screen.getByLabelText(/Método/i) as HTMLSelectElement).value).toBe('TRANSFERENCIA')
  })

  it('an empty propuesta (all fields null) leaves all inputs empty', () => {
    render(
      <PropuestaPagoFields propuesta={emptyPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    expect((screen.getByLabelText(/Monto/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Fecha/i) as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText(/Método/i) as HTMLSelectElement).value).toBe('')
  })
})
