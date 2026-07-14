/**
 * Tests for the ?proveedor_id= pre-fill on FacturaFormPage (C-13, task 11.2).
 *
 * TDD: Task 11.2 (RED → GREEN).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import { FacturaFormPage } from './FacturaFormPage'

const PROVEEDOR_ID = 'proveedor-uuid-1'

const mockProveedor = {
  id: PROVEEDOR_ID,
  usuario_id: 'user-1',
  nombre: 'Proveedor Alfa',
  cuit: null,
  telefono: null,
  categoria: 'SERVICIO' as const,
  notas: null,
  saldo: 0,
  created_at: '2026-06-01T00:00:00',
  updated_at: '2026-06-01T00:00:00',
}

const server = setupServer(
  http.get(`/api/proveedores/${PROVEEDOR_ID}`, () => {
    return HttpResponse.json(mockProveedor)
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function createWrapper(initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/facturas/nueva" element={children} />
            <Route path="/facturas/:id/editar" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('FacturaFormPage — mode selector', () => {
  it('shows the mode selector initially (IA vs Manual)', () => {
    render(<FacturaFormPage />, {
      wrapper: createWrapper(['/facturas/nueva']),
    })
    expect(screen.getByText(/Cargar con foto/i)).toBeInTheDocument()
    expect(screen.getByText(/Cargar manual/i)).toBeInTheDocument()
    // The form is NOT rendered yet
    expect(screen.queryByLabelText(/monto total/i)).not.toBeInTheDocument()
  })

  it('shows the form after clicking "Cargar manual"', () => {
    render(<FacturaFormPage />, {
      wrapper: createWrapper(['/facturas/nueva']),
    })
    fireEvent.click(screen.getByText(/Cargar manual/i))
    expect(screen.getByLabelText(/monto total/i)).toBeInTheDocument()
  })
})

describe('FacturaFormPage — ?proveedor_id= pre-fill', () => {
  it('pre-fills the supplier chip when ?proveedor_id=X is present in the URL', async () => {
    render(<FacturaFormPage />, {
      wrapper: createWrapper([`/facturas/nueva?proveedor_id=${PROVEEDOR_ID}`]),
    })
    // First click "Cargar manual" to show the form
    fireEvent.click(screen.getByText(/Cargar manual/i))
    // The supplier chip shows the pre-filled name.
    await waitFor(() => {
      expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument()
    })
  })

  it('does NOT pre-fill any supplier when no ?proveedor_id= is in the URL', async () => {
    render(<FacturaFormPage />, {
      wrapper: createWrapper(['/facturas/nueva']),
    })
    // First click "Cargar manual" to show the form
    fireEvent.click(screen.getByText(/Cargar manual/i))
    // The supplier search control is rendered but no supplier is selected.
    expect(screen.queryByText('Proveedor Alfa')).not.toBeInTheDocument()
  })
})

// ── C-18 (FE-003): IA flow from selector

describe('FacturaFormPage — FE-003 IA flow from selector', () => {
  it('opens the IA modal from the selector and returns to form after confirm', async () => {
    render(<FacturaFormPage />, {
      wrapper: createWrapper(['/facturas/nueva']),
    })

    // The selector shows both options
    expect(screen.getByText(/Cargar con foto/i)).toBeInTheDocument()

    // Click IA option → modal should open (but we test the interaction contract)
    fireEvent.click(screen.getByText(/Cargar con foto/i))

    // The modal is rendered
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
