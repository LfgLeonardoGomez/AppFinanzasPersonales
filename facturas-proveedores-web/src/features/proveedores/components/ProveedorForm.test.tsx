/**
 * Tests for ProveedorForm — create/edit supplier form.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import ProveedorForm from './ProveedorForm'
import type { Proveedor } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const existingProveedor: Proveedor = {
  id: 'uuid-1',
  nombre: 'Proveedor Existente',
  cuit: '20-12345678-9',
  telefono: '011-1234-5678',
  categoria: 'SERVICIO',
  notas: 'Notas de prueba',
  saldo: 500,
  created_at: '2026-06-01T00:00:00',
  updated_at: '2026-06-01T00:00:00',
}

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.post('/api/proveedores', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json(
      {
        ...existingProveedor,
        id: 'uuid-new',
        nombre: body.nombre,
        cuit: body.cuit ?? null,
      },
      { status: 201 },
    )
  }),

  http.patch('/api/proveedores/:id', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({ ...existingProveedor, ...body })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Wrapper ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProveedorForm — create mode', () => {
  it('shows validation error and does not call API when nombre is empty', async () => {
    const onSuccess = vi.fn()
    render(<ProveedorForm onSuccess={onSuccess} onCancel={() => {}} />, {
      wrapper: createWrapper(),
    })
    // Submit without filling nombre
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() =>
      expect(screen.getByText(/nombre es requerido/i)).toBeInTheDocument(),
    )
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('calls POST /api/proveedores with valid payload and calls onSuccess', async () => {
    const onSuccess = vi.fn()
    render(<ProveedorForm onSuccess={onSuccess} onCancel={() => {}} />, {
      wrapper: createWrapper(),
    })
    fireEvent.change(screen.getByLabelText(/nombre/i), {
      target: { value: 'Nuevo Proveedor SA' },
    })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  })

  it('renders categoria select with all enum options', async () => {
    render(<ProveedorForm onSuccess={() => {}} onCancel={() => {}} />, {
      wrapper: createWrapper(),
    })
    const select = screen.getByLabelText(/categor/i)
    expect(select).toBeInTheDocument()
    const options = Array.from((select as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toContain('SERVICIO')
    expect(options).toContain('OTRO')
  })

  it('shows CUIT format hint when cuit field has wrong format (client hint only)', async () => {
    render(<ProveedorForm onSuccess={() => {}} onCancel={() => {}} />, {
      wrapper: createWrapper(),
    })
    const cuitInput = screen.getByLabelText(/cuit/i)
    fireEvent.change(cuitInput, { target: { value: '12345' } })
    fireEvent.blur(cuitInput)
    await waitFor(() =>
      expect(screen.getByText(/XX-XXXXXXXX-X/i)).toBeInTheDocument(),
    )
  })

  it('renders backend 422 error in the form', async () => {
    server.use(
      http.post('/api/proveedores', () =>
        HttpResponse.json(
          { detail: [{ loc: ['body', 'nombre'], msg: 'field required', type: 'missing' }] },
          { status: 422 },
        ),
      ),
    )
    const onSuccess = vi.fn()
    render(<ProveedorForm onSuccess={onSuccess} onCancel={() => {}} />, {
      wrapper: createWrapper(),
    })
    fireEvent.change(screen.getByLabelText(/nombre/i), {
      target: { value: 'Algo' },
    })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() =>
      expect(screen.getByText(/error/i)).toBeInTheDocument(),
    )
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

describe('ProveedorForm — edit mode', () => {
  it('pre-fills existing values', async () => {
    render(
      <ProveedorForm
        proveedor={existingProveedor}
        onSuccess={() => {}}
        onCancel={() => {}}
      />,
      { wrapper: createWrapper() },
    )
    expect((screen.getByLabelText(/nombre/i) as HTMLInputElement).value).toBe(
      'Proveedor Existente',
    )
    expect((screen.getByLabelText(/cuit/i) as HTMLInputElement).value).toBe('20-12345678-9')
  })

  it('calls PATCH /api/proveedores/{id} with updated payload', async () => {
    const onSuccess = vi.fn()
    render(
      <ProveedorForm
        proveedor={existingProveedor}
        onSuccess={onSuccess}
        onCancel={() => {}}
      />,
      { wrapper: createWrapper() },
    )
    const nombreInput = screen.getByLabelText(/nombre/i) as HTMLInputElement
    fireEvent.change(nombreInput, { target: { value: 'Nombre Modificado' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  })
})
