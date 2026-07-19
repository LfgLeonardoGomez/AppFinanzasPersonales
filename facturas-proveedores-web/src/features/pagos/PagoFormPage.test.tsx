/**
 * Tests for PagoFormPage's create route (C-13 D8 / Q-CC-FE-02 pre-fill;
 * REWRITTEN for the carga-modal convergence — the create route now
 * opens the unified `CargaModal` directly instead of a mode-selector
 * screen).
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
  http.get('/api/proveedores/buscar', () => HttpResponse.json([])),
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
            <Route path="/pagos" element={<div>Pagos list</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('PagoFormPage — create route opens the unified carga modal', () => {
  it('renders CargaModal already open, on tipo pago, origen step — no mode-selector screen', () => {
    render(<PagoFormPage />, {
      wrapper: createWrapper(['/pagos/nuevo']),
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Registrar pago')).toBeInTheDocument()
    expect(screen.getByTestId('imagen-picker-dropzone')).toBeInTheDocument()
    expect(screen.queryByLabelText(/^monto$/i)).not.toBeInTheDocument()
  })

  it('switching to Manual and clicking Continuar reaches the review step with the monto input', () => {
    render(<PagoFormPage />, {
      wrapper: createWrapper(['/pagos/nuevo']),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByLabelText(/^monto$/i)).toBeInTheDocument()
  })
})

describe('PagoFormPage — ?proveedor_id= pre-fill', () => {
  it('pre-fills the supplier chip when ?proveedor_id=X is present in the URL', async () => {
    render(<PagoFormPage />, {
      wrapper: createWrapper([`/pagos/nuevo?proveedor_id=${PROVEEDOR_ID}`]),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())
  })
})
