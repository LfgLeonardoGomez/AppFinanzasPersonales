/**
 * Tests for PagoFormPage.
 *
 * TDD: covers C-13 (D8 / Q-CC-FE-02) pre-fill.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PagoFormPage } from './PagoFormPage'

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
  http.get('/api/proveedores/buscar', () => HttpResponse.json([mockProveedor])),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
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
            <Route path="/pagos/nuevo" element={children} />
            <Route path="/pagos/:id/editar" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('PagoFormPage — mode selector', () => {
  it('shows the mode selector initially (IA vs Manual)', () => {
    render(<PagoFormPage />, {
      wrapper: createWrapper(['/pagos/nuevo']),
    })
    expect(screen.getByText(/Cargar con foto/i)).toBeInTheDocument()
    expect(screen.getByText(/Cargar manual/i)).toBeInTheDocument()
    // The form is NOT rendered yet
    expect(screen.queryByLabelText(/^monto$/i)).not.toBeInTheDocument()
  })

  it('shows the form after clicking "Cargar manual"', () => {
    render(<PagoFormPage />, {
      wrapper: createWrapper(['/pagos/nuevo']),
    })
    fireEvent.click(screen.getByText(/Cargar manual/i))
    expect(screen.getByLabelText(/^monto$/i)).toBeInTheDocument()
  })
})

describe('PagoFormPage — ?proveedor_id= pre-fill', () => {
  it('pre-fills the supplier chip when ?proveedor_id=X is present in the URL', async () => {
    render(<PagoFormPage />, {
      wrapper: createWrapper([`/pagos/nuevo?proveedor_id=${PROVEEDOR_ID}`]),
    })
    // First click "Cargar manual" to show the form
    fireEvent.click(screen.getByText(/Cargar manual/i))
    // Wait for the supplier to be loaded into the form
    await waitFor(() =>
      expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument(),
    )
  })
})
