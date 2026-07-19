/**
 * Tests for FacturaFormPage's create route (C-13, task 11.2 pre-fill;
 * REWRITTEN for the carga-modal convergence — the create route now
 * opens the unified `CargaModal` directly instead of a mode-selector
 * screen).
 *
 * TDD: Task 11.2 (RED → GREEN), re-based onto `CargaModal`.
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
  http.get('/api/proveedores/buscar', () => HttpResponse.json([])),
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
            <Route path="/facturas" element={<div>Facturas list</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('FacturaFormPage — create route opens the unified carga modal', () => {
  it('renders CargaModal already open, on tipo factura, origen step — no mode-selector screen', () => {
    render(<FacturaFormPage />, {
      wrapper: createWrapper(['/facturas/nueva']),
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Cargar factura')).toBeInTheDocument()
    expect(screen.getByTestId('imagen-picker-dropzone')).toBeInTheDocument()
    // The review fields are NOT rendered yet — still on the origen step.
    expect(screen.queryByLabelText(/monto total/i)).not.toBeInTheDocument()
  })

  it('switching to Manual and clicking Continuar reaches the review step with the monto total input', () => {
    render(<FacturaFormPage />, {
      wrapper: createWrapper(['/facturas/nueva']),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.getByLabelText(/monto total/i)).toBeInTheDocument()
  })
})

describe('FacturaFormPage — ?proveedor_id= pre-fill', () => {
  it('pre-fills the supplier chip when ?proveedor_id=X is present in the URL', async () => {
    render(<FacturaFormPage />, {
      wrapper: createWrapper([`/facturas/nueva?proveedor_id=${PROVEEDOR_ID}`]),
    })
    // Manual → Continuar reaches the review step where the supplier
    // control lives.
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await waitFor(() => {
      expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument()
    })
  })

  it('does NOT pre-fill any supplier when no ?proveedor_id= is in the URL', async () => {
    render(<FacturaFormPage />, {
      wrapper: createWrapper(['/facturas/nueva']),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(screen.queryByText('Proveedor Alfa')).not.toBeInTheDocument()
  })
})
