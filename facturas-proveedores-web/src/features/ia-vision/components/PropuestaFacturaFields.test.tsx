/**
 * Tests for the PropuestaFacturaFields component (C-15, section 4;
 * REWRITTEN in C-21 tasks 4.1-4.3 to cover auto-match + inline create).
 *
 * TDD: Task 4.1 (RED) → 4.2 (GREEN) → 4.3 (TRIANGULATE across
 * match/no-match/override).
 *
 * C-21 (D4) SUPERSEDES the C-15 decision that "the SupplierSearch value
 * is null even on an exact match" (old RN-IA-06 wording). The detected
 * `proveedor_nombre` is now auto-matched (via `SupplierMatchControl` →
 * `useAutoMatchProveedor`) against the user's own suppliers: a unique
 * normalized-exact hit pre-selects the supplier (changeable); anything
 * less than that (no hit, a partial hit, multiple hits) surfaces an
 * inline "Crear «X»" action instead of guessing (RN-IA-06 still intact:
 * the human always confirms/overrides).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import type { PropuestaFactura, ProveedorListItem } from '@shared/api/api'
import { PropuestaFacturaFields } from './PropuestaFacturaFields'

function proveedor(overrides: Partial<ProveedorListItem>): ProveedorListItem {
  return {
    id: 'prov-1',
    usuario_id: 'user-1',
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
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
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
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
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
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    render(
      <PropuestaFacturaFields propuesta={partialPropuesta} onChange={vi.fn()} />,
      { wrapper: makeWrapper() },
    )
    const input = screen.getByLabelText(/Monto total/i) as HTMLInputElement
    expect(input.value).toBe('')
  })

  it('a null fecha_emision renders an empty date input', () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
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

describe('PropuestaFacturaFields — Task 4.1/4.4, auto-match (D4)', () => {
  it('pre-selects the supplier on a normalized-exact unique match (Confirmar-enabling state)', async () => {
    server.use(
      http.get('/api/proveedores/buscar', () => HttpResponse.json([proveedor({ nombre: 'Acme SA' })])),
    )
    const onProveedorChange = vi.fn()
    render(
      <PropuestaFacturaFields
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

  it('shows the match as a changeable chip once selected (clear button present)', async () => {
    server.use(
      http.get('/api/proveedores/buscar', () => HttpResponse.json([proveedor({ nombre: 'Acme SA' })])),
    )
    const matched = proveedor({ nombre: 'Acme SA' })
    render(
      <PropuestaFacturaFields
        propuesta={fullPropuesta}
        onChange={vi.fn()}
        selectedProveedor={matched}
        onProveedorChange={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    // "Acme SA" appears twice: once in the selected chip, once in the
    // "Detectado por IA" hint — assert the chip via the clear button
    // that only renders when SupplierSearch has a non-null value.
    expect(screen.getAllByText('Acme SA').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByRole('button', { name: /Limpiar selección/i })).toBeInTheDocument()
  })
})

describe('PropuestaFacturaFields — Task 4.2, inline create on no-match (D5)', () => {
  it('shows a "Crear «X»" inline action with the detected name editable when there is no match', async () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    render(
      <PropuestaFacturaFields
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
    const nameInput = screen.getByLabelText(/Nombre del proveedor a crear/i) as HTMLInputElement
    expect(nameInput.value).toBe('Acme SA')
  })

  it('confirming the inline create calls useCreateProveedor with { nombre, categoria: OTRO } and selects the created supplier', async () => {
    server.use(
      http.get('/api/proveedores/buscar', () => HttpResponse.json([])),
      http.post('/api/proveedores', async ({ request }) => {
        const body = (await request.json()) as { nombre: string; categoria?: string }
        expect(body).toEqual({ nombre: 'Acme SA', categoria: 'OTRO' })
        return HttpResponse.json(proveedor({ id: 'prov-created-1', nombre: body.nombre }), { status: 201 })
      }),
    )
    const onProveedorChange = vi.fn()
    render(
      <PropuestaFacturaFields
        propuesta={fullPropuesta}
        onChange={vi.fn()}
        selectedProveedor={null}
        onProveedorChange={onProveedorChange}
      />,
      { wrapper: makeWrapper() },
    )
    const crearBtn = await waitFor(() => screen.getByRole('button', { name: /Crear «Acme SA»/ }))
    fireEvent.click(crearBtn)
    await waitFor(() => {
      expect(onProveedorChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'prov-created-1', nombre: 'Acme SA' }))
    })
  })
})

describe('PropuestaFacturaFields — Task 4.3, TRIANGULATE: override + null nombre', () => {
  it('the user can override the auto-match (a different selectedProveedor is shown as the current chip)', () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    const overridden = proveedor({ id: 'prov-other', nombre: 'Otro Proveedor SRL' })
    render(
      <PropuestaFacturaFields
        propuesta={fullPropuesta}
        onChange={vi.fn()}
        selectedProveedor={overridden}
        onProveedorChange={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    expect(screen.getByText('Otro Proveedor SRL')).toBeInTheDocument()
    // "Acme SA" (the IA's detection) still shows in the "Detectado por
    // IA" hint, but NOT as the selected chip — the clear button next to
    // the chip belongs to "Otro Proveedor SRL", proving the override
    // took effect and the IA's own suggestion was not re-applied.
    expect(screen.getAllByText('Acme SA')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Crear «Acme SA»/ })).not.toBeInTheDocument()
  })

  it('a null proveedor_nombre leaves selection empty and shows no inline-create action', () => {
    const noNombre: PropuestaFactura = { ...fullPropuesta, proveedor_nombre: null }
    render(
      <PropuestaFacturaFields
        propuesta={noNombre}
        onChange={vi.fn()}
        selectedProveedor={null}
        onProveedorChange={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    expect(screen.queryByText(/Detectado por IA:/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Crear «/ })).not.toBeInTheDocument()
    const input = screen.getByPlaceholderText(/Buscar proveedor/i) as HTMLInputElement
    expect(input.value).toBe('')
  })
})
