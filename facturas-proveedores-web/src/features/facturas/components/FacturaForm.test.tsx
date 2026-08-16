/**
 * Tests for FacturaForm — create/edit invoice form.
 *
 * TDD: Task 6.1 (RED create mode) → 6.2 (GREEN) →
 *      Task 6.3 (RED edit mode) → 6.4 (GREEN) → 6.5 (TRIANGULATE).
 *
 * Key invariants:
 * - Supplier required; selected via SupplierSearch prop interface.
 * - fecha_emision not future (UTC-3 wall-clock).
 * - monto_total > 0.
 * - Backend 422 rendered inline without losing input.
 * - items_sum_mismatch from response surfaced after save.
 * - In edit mode, proveedor is read-only (backend rejects proveedor_id changes).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { FacturaForm } from './FacturaForm'
import type { FacturaResponse, ProveedorListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockProveedor: ProveedorListItem = {
  id: 'prov-uuid-1',
  nombre: 'Proveedor Test SA',
  cuit: '20-12345678-9',
  telefono: null,
  categoria: 'SERVICIO',
  notas: null,
  saldo: 0,
  created_at: '2026-06-01T00:00:00',
  updated_at: '2026-06-01T00:00:00',
}

const mockCreatedFactura: FacturaResponse = {
  id: 'factura-uuid-1',
  negocio_id: 'user-1',
  proveedor_id: 'prov-uuid-1',
  numero: null,
  fecha_emision: '2026-06-01',
  fecha_vencimiento: null,
  monto_total: 1500,
  archivo_url: null,
  origen: 'MANUAL',
  estado: 'PENDIENTE',
  items: [],
  items_sum_mismatch: false,
  created_at: '2026-06-01T10:00:00',
  updated_at: '2026-06-01T10:00:00',
}

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.post('/api/facturas', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    if (!body.proveedor_id) {
      return HttpResponse.json(
        { detail: [{ loc: ['body', 'proveedor_id'], msg: 'Field required', type: 'missing' }] },
        { status: 422 },
      )
    }
    return HttpResponse.json(mockCreatedFactura, { status: 201 })
  }),

  http.get('/api/facturas/:id', ({ params }) => {
    if (params.id === 'factura-uuid-1') {
      return HttpResponse.json(mockCreatedFactura)
    }
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),

  http.patch('/api/facturas/:id', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({ ...mockCreatedFactura, ...body })
  }),

  http.get('/api/cloudinary/preset-firmado', () => {
    return HttpResponse.json({
      cloud_name: 'test-cloud',
      signature: 'sig',
      api_key: 'key',
      timestamp: 1234567890,
      folder: 'facturas',
      allowed_formats: ['pdf', 'jpg', 'png'],
      max_file_size: 10485760,
    })
  }),

  // SupplierSearch calls buscar
  http.get('/api/proveedores/buscar', () => {
    return HttpResponse.json([mockProveedor])
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Wrapper ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

// ── Task 6.1 / 6.2 — Create mode ─────────────────────────────────────────────

describe('FacturaForm — create mode', () => {
  it('renders required fields: supplier, fecha_emision, monto_total', () => {
    render(<FacturaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    // Proveedor label exists
    expect(screen.getByText(/^Proveedor$/i)).toBeInTheDocument()
    // Multiple fecha fields — check the emision one exists via id
    expect(document.getElementById('fecha_emision')).toBeInTheDocument()
    expect(screen.getByLabelText(/monto/i)).toBeInTheDocument()
  })

  it('shows error when submitting without a supplier', async () => {
    render(<FacturaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)
    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    })
    // Among the alerts, one should mention the supplier
    const alertText = screen.getAllByRole('alert').map((a) => a.textContent ?? '').join(' ')
    expect(alertText).toMatch(/proveedor/i)
  })

  it('shows error when monto_total is zero or negative', async () => {
    render(<FacturaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    const montoInput = screen.getByLabelText(/monto/i)
    fireEvent.change(montoInput, { target: { value: '0' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)
    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    })
  })

  it('calls POST /api/facturas on valid submit and invokes onSuccess', async () => {
    const onSuccess = vi.fn()
    render(
      <FacturaForm
        onSuccess={onSuccess}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    // Set fecha_emision (past date)
    const fechaInput = document.getElementById('fecha_emision') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2026-05-01' } })

    // Set monto_total
    const montoInput = screen.getByLabelText(/monto/i)
    fireEvent.change(montoInput, { target: { value: '1500' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    }, { timeout: 3000 })
  })
})

// ── Task 6.3 / 6.4 — Edit mode ───────────────────────────────────────────────

describe('FacturaForm — edit mode', () => {
  it('pre-fills fields from the existing factura', () => {
    render(
      <FacturaForm
        factura={mockCreatedFactura}
        proveedor={mockProveedor}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    expect(montoInput.value).toBe('1500')
  })

  it('renders the supplier as read-only in edit mode', () => {
    render(
      <FacturaForm
        factura={mockCreatedFactura}
        proveedor={mockProveedor}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    // The supplier display should be disabled/read-only
    const supplierDisplay = screen.getByTestId('proveedor-readonly')
    expect(supplierDisplay).toBeInTheDocument()
    expect(supplierDisplay.textContent).toContain('Proveedor Test SA')
  })

  it('never renders the supplier UUID; shows a neutral placeholder when no name is available (c-26 D1)', () => {
    render(
      <FacturaForm
        factura={mockCreatedFactura}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    const supplierDisplay = screen.getByTestId('proveedor-readonly')
    expect(supplierDisplay).not.toHaveTextContent(mockCreatedFactura.proveedor_id)
    expect(supplierDisplay.textContent).toMatch(/proveedor no disponible/i)
  })
})

// ── c-26 (D2) — top-right close control ──────────────────────────────────────

describe('FacturaForm — top-right close control', () => {
  it('exposes a close control that performs the same action as Cancelar', () => {
    const onCancel = vi.fn()
    render(
      <FacturaForm
        factura={mockCreatedFactura}
        proveedor={mockProveedor}
        onSuccess={vi.fn()}
        onCancel={onCancel}
      />,
      { wrapper: createWrapper() },
    )
    const closeBtn = screen.getByRole('button', { name: /cerrar formulario/i })
    fireEvent.click(closeBtn)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('keeps Cancelar in its original place at the bottom of the form (additive, D2)', () => {
    render(
      <FacturaForm
        factura={mockCreatedFactura}
        proveedor={mockProveedor}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    expect(screen.getByRole('button', { name: /^cancelar$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cerrar formulario/i })).toBeInTheDocument()
  })
})

// ── Task 6.5 — TRIANGULATE ────────────────────────────────────────────────────

describe('FacturaForm — triangulate', () => {
  it('blocks submission when fecha_emision is in the future', async () => {
    render(
      <FacturaForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    // Set a future date
    const fechaInput = document.getElementById('fecha_emision') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2099-12-31' } })

    const montoInput = screen.getByLabelText(/monto/i)
    fireEvent.change(montoInput, { target: { value: '1500' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    })
    // Check for future date error message
    const alerts = screen.getAllByRole('alert')
    const alertText = alerts.map((a) => a.textContent ?? '').join(' ')
    expect(alertText).toMatch(/futura|future|fecha/i)
  })

  it('shows items_sum_mismatch warning after save when response has mismatch=true', async () => {
    server.use(
      http.post('/api/facturas', async () => {
        return HttpResponse.json(
          { ...mockCreatedFactura, items_sum_mismatch: true },
          { status: 201 },
        )
      }),
    )

    const onSuccess = vi.fn()
    render(
      <FacturaForm
        onSuccess={onSuccess}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    const fechaInput2 = document.getElementById('fecha_emision') as HTMLInputElement
    fireEvent.change(fechaInput2, { target: { value: '2026-05-01' } })
    const montoInput = screen.getByLabelText(/monto/i)
    fireEvent.change(montoInput, { target: { value: '1500' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    }, { timeout: 3000 })
  })
})

// ── Review fix (finding 2, WARNING) — interim mitigation for an ambiguous
// outcome ─────────────────────────────────────────────────────────────────
//
// D-67 (knowledge-base/09_decisiones_y_supuestos.md): facturas/pagos/cobros
// have zero deduplication. C-42's 20s global Axios timeout makes an
// ambiguous outcome (timeout/network/5xx) MORE dangerous here than before
// — a client timeout invites retrying over an endpoint that cannot tell a
// retry from a duplicate. This was supposed to ship WITH C-42 and did not:
// every failure collapsed into the same generic backend error with the
// button just re-enabled. Fixed by classifying the outcome (reusing
// `submitOutcome.ts`, not duplicating the logic) and, for an ambiguous
// one, pointing the user at the list INSTEAD of a bare retry — this
// endpoint does not dedupe, so the copy must never say retrying is safe.

describe('FacturaForm — ambiguous outcome points at the list, not a bare retry (C-42 review fix, finding 2)', () => {
  it('on a network error (no response), tells the user to check the list before retrying — and does NOT claim it is safe to retry', async () => {
    server.use(http.post('/api/facturas', () => HttpResponse.error()))
    render(
      <FacturaForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    const fechaInput = document.getElementById('fecha_emision') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2026-05-01' } })
    const montoInput = screen.getByLabelText(/monto/i)
    fireEvent.change(montoInput, { target: { value: '1500' } })

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toBeInTheDocument()
    })
    const bannerText = screen.getByRole('status').textContent ?? ''
    expect(bannerText).toMatch(/no pudimos confirmar/i)
    expect(bannerText).not.toMatch(/es seguro|no se va a duplicar/i)

    // Points at the invoices list before retrying.
    expect(screen.getByRole('link', { name: /listado de facturas/i })).toBeInTheDocument()

    // The generic backend-rejection alert must NOT also be showing — the
    // two states are mutually exclusive.
    expect(screen.queryByText(/error al crear la factura/i)).not.toBeInTheDocument()
  })

  it('a real 422 rejection still shows the ordinary backend error, unchanged (triangulation)', async () => {
    server.use(
      http.post('/api/facturas', () =>
        HttpResponse.json(
          { detail: [{ loc: ['body', 'monto_total'], msg: 'must be greater than 0', type: 'value_error' }] },
          { status: 422 },
        ),
      ),
    )
    render(
      <FacturaForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    const fechaInput = document.getElementById('fecha_emision') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2026-05-01' } })
    const montoInput = screen.getByLabelText(/monto/i)
    fireEvent.change(montoInput, { target: { value: '1500' } })

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /listado de facturas/i })).not.toBeInTheDocument()
  })
})
