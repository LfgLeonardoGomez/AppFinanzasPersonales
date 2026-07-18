/**
 * Tests for PagoForm — create/edit payment form.
 *
 * TDD: Task 5.1 (RED structural) → 5.2 (GREEN) →
 *      5.3 (RED payload) → 5.4 (GREEN wire) →
 *      5.5 (RED validation) → 5.6 (GREEN) →
 *      5.7 (RED 422 inline) → 5.8 (GREEN) →
 *      5.9 (TRIANGULATE edit mode + date format).
 *
 * INVARIANTS (RN-PAG-01, hard rule #1):
 *   - The form renders NO `factura` input/select. The DOM is searched for any
 *     form control whose `name` attribute contains "factura" — none should
 *     exist.
 *   - A persistent info note reads "El pago se asocia al proveedor, no a una
 *     factura específica" inside the form, near the supplier field.
 *   - On submit, the captured payload is a subset of
 *     `{proveedor_id, monto, fecha, metodo, comprobante_url}`.
 *
 * Validation strategy (D-C11-6, mirrors C-09 D-C09-10):
 *   - Client-side: supplier required, monto > 0, fecha not future (UTC-3),
 *     metodo required. UX only.
 *   - Backend (Pydantic) is the authority — 422 rendered inline without
 *     losing input.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PagoForm } from './PagoForm'
import type { PagoResponse, ProveedorListItem, PagoListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockProveedor: ProveedorListItem = {
  id: 'prov-uuid-1',
  usuario_id: 'user-1',
  nombre: 'Proveedor Test SA',
  cuit: '20-12345678-9',
  telefono: null,
  categoria: 'SERVICIO',
  notas: null,
  saldo: 0,
  created_at: '2026-06-01T00:00:00',
  updated_at: '2026-06-01T00:00:00',
}

const mockPagoResponse: PagoResponse = {
  id: 'pago-uuid-1',
  usuario_id: 'user-1',
  proveedor_id: 'prov-uuid-1',
  monto: 1500,
  fecha: '2026-06-15',
  metodo: 'TRANSFERENCIA',
  comprobante_url: null,
  origen: 'MANUAL',
  created_at: '2026-06-15T10:00:00',
  updated_at: '2026-06-15T10:00:00',
}

const mockPagoListItem: PagoListItem = {
  id: 'pago-uuid-1',
  proveedor_id: 'prov-uuid-1',
  monto: 1500,
  fecha: '2026-06-15',
  metodo: 'TRANSFERENCIA',
  origen: 'MANUAL',
  created_at: '2026-06-15T10:00:00',
}

// ── MSW Server ────────────────────────────────────────────────────────────────

let lastCreatedPayload: Record<string, unknown> | null = null
let lastPatchedPayload: Record<string, unknown> | null = null

const server = setupServer(
  http.post('/api/pagos', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    lastCreatedPayload = body
    if (Object.keys(body).some((k) => k.toLowerCase().includes('factura'))) {
      return HttpResponse.json(
        { detail: [{ loc: ['body'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' }] },
        { status: 422 },
      )
    }
    return HttpResponse.json({ ...mockPagoResponse, ...body }, { status: 201 })
  }),

  http.patch('/api/pagos/:id', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    lastPatchedPayload = body
    if (Object.keys(body).some((k) => k.toLowerCase().includes('factura'))) {
      return HttpResponse.json(
        { detail: [{ loc: ['body'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' }] },
        { status: 422 },
      )
    }
    return HttpResponse.json({ ...mockPagoResponse, ...body })
  }),

  http.get('/api/pagos/:id', ({ params }) => {
    if (params.id === 'pago-uuid-1') {
      return HttpResponse.json(mockPagoResponse)
    }
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),

  http.get('/api/cloudinary/preset-firmado', () => {
    return HttpResponse.json({
      cloud_name: 'test-cloud',
      signature: 'sig',
      api_key: 'key',
      timestamp: 1234567890,
      folder: 'comprobantes',
      allowed_formats: ['pdf', 'jpg', 'png'],
      max_file_size: 10485760,
    })
  }),

  // Cloudinary upload endpoint (mocked — never hit for real)
  http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () => {
    return HttpResponse.json({
      secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/comprobante.pdf',
    })
  }),

  // SupplierSearch calls buscar
  http.get('/api/proveedores/buscar', () => {
    return HttpResponse.json([mockProveedor])
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  lastCreatedPayload = null
  lastPatchedPayload = null
})

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

// ── Task 5.1 — RN-PAG-01 structural enforcement ─────────────────────────────

describe('PagoForm — RN-PAG-01 (no factura field)', () => {
  it('renders NO form control with "factura" in its name attribute', () => {
    render(<PagoForm onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    const facturaControls = document.querySelectorAll('[name*="factura" i]')
    expect(facturaControls.length).toBe(0)
  })

  it('displays the RN-PAG-01 reinforcement note in the rendered DOM', () => {
    render(<PagoForm onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    expect(
      screen.getByText(/el pago se asocia al proveedor, no a una factura específica/i),
    ).toBeInTheDocument()
  })
})

// ── Task 5.2 / 5.4 — Create mode + payload shape ────────────────────────────

describe('PagoForm — create mode (payload shape)', () => {
  it('POSTs a payload whose keys are a subset of {proveedor_id, monto, fecha, metodo, comprobante_url}', async () => {
    const onSuccess = vi.fn()
    render(
      <PagoForm
        onSuccess={onSuccess}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2026-05-01' } })

    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '1500' } })

    const metodoSelect = screen.getByLabelText(/método|metodo/i) as HTMLSelectElement
    fireEvent.change(metodoSelect, { target: { value: 'EFECTIVO' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    }, { timeout: 3000 })

    // The captured payload — if `useCreatePago` mutates, lastCreatedPayload
    // is set by the MSW handler.
    expect(lastCreatedPayload).not.toBeNull()
    const keys = Object.keys(lastCreatedPayload ?? {})
    const offending = keys.filter((k) => k.toLowerCase().includes('factura'))
    expect(offending).toEqual([])
    // All keys must be in the allowed set
    const allowed = new Set(['proveedor_id', 'monto', 'fecha', 'metodo', 'comprobante_url'])
    keys.forEach((k) => expect(allowed.has(k)).toBe(true))
  })
})

// ── Task 5.5 / 5.6 — Client validation ──────────────────────────────────────

describe('PagoForm — client validation', () => {
  it('blocks submission when metodo is missing', async () => {
    const onSuccess = vi.fn()
    render(
      <PagoForm
        onSuccess={onSuccess}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2026-05-01' } })

    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '1500' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    })
    const alertText = screen.getAllByRole('alert').map((a) => a.textContent ?? '').join(' ')
    expect(alertText).toMatch(/método|metodo/i)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('blocks submission when monto is zero', async () => {
    render(
      <PagoForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '0' } })

    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2026-05-01' } })

    const metodoSelect = screen.getByLabelText(/método|metodo/i) as HTMLSelectElement
    fireEvent.change(metodoSelect, { target: { value: 'EFECTIVO' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    })
  })

  it('blocks submission when fecha is in the future (UTC-3)', async () => {
    render(
      <PagoForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2099-12-31' } })

    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '1500' } })

    const metodoSelect = screen.getByLabelText(/método|metodo/i) as HTMLSelectElement
    fireEvent.change(metodoSelect, { target: { value: 'EFECTIVO' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    })
    const alertText = screen.getAllByRole('alert').map((a) => a.textContent ?? '').join(' ')
    expect(alertText).toMatch(/futura|future/i)
  })

  it('blocks submission when no supplier is selected', async () => {
    render(<PagoForm onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: createWrapper(),
    })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    })
    const alertText = screen.getAllByRole('alert').map((a) => a.textContent ?? '').join(' ')
    expect(alertText).toMatch(/proveedor/i)
  })
})

// ── Task 5.7 / 5.8 — Backend 422 rendered inline ────────────────────────────

describe('PagoForm — backend 422', () => {
  it('renders the backend error inline when POST returns 422', async () => {
    server.use(
      http.post('/api/pagos', () =>
        HttpResponse.json(
          { detail: [{ loc: ['body', 'monto'], msg: 'must be greater than 0', type: 'value_error' }] },
          { status: 422 },
        ),
      ),
    )

    render(
      <PagoForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2026-05-01' } })
    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '1500' } })
    const metodoSelect = screen.getByLabelText(/método|metodo/i) as HTMLSelectElement
    fireEvent.change(metodoSelect, { target: { value: 'EFECTIVO' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      // The form should show the error from the backend
      const alertText = screen.getAllByRole('alert').map((a) => a.textContent ?? '').join(' ')
      expect(alertText.length).toBeGreaterThan(0)
    })

    // The user input must still be present (form not lost)
    expect((montoInput as HTMLInputElement).value).toBe('1500')
  })
})

// ── Task 5.9 — Edit mode ─────────────────────────────────────────────────────

describe('PagoForm — edit mode', () => {
  it('pre-fills fields from the existing pago', () => {
    render(
      <PagoForm
        pago={mockPagoListItem}
        proveedor={mockProveedor}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    expect(montoInput.value).toBe('1500')
    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    expect(fechaInput.value).toBe('2026-06-15')
  })

  it('renders the supplier as read-only in edit mode', () => {
    render(
      <PagoForm
        pago={mockPagoListItem}
        proveedor={mockProveedor}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    const supplierDisplay = screen.getByTestId('proveedor-readonly')
    expect(supplierDisplay).toBeInTheDocument()
    expect(supplierDisplay.textContent).toContain('Proveedor Test SA')
  })

  it('PATCHes only changed fields on edit (no factura key)', async () => {
    const onSuccess = vi.fn()
    render(
      <PagoForm
        pago={mockPagoListItem}
        proveedor={mockProveedor}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )

    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '2500' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    }, { timeout: 3000 })

    expect(lastPatchedPayload).not.toBeNull()
    const keys = Object.keys(lastPatchedPayload ?? {})
    const offending = keys.filter((k) => k.toLowerCase().includes('factura'))
    expect(offending).toEqual([])
    // Only changed fields are sent — monto is changed, fecha/metodo are not
    expect(keys).toContain('monto')
    expect(keys).not.toContain('proveedor_id') // supplier immutable in edit
  })
})

// ── Task 6 — Comprobante upload (C-09 FileUploadField, reused) ──────────────

describe('PagoForm — comprobante upload (Task 6)', () => {
  function makeFile(name: string, type: string, sizeBytes: number): File {
    return new File([new Uint8Array(sizeBytes)], name, { type })
  }

  it('renders the FileUploadField with the comprobante input', () => {
    render(
      <PagoForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )
    expect(screen.getByLabelText(/archivo adjunto/i)).toBeInTheDocument()
  })

  it('rejects an invalid file type (.txt) with a validation error', () => {
    render(
      <PagoForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )
    const input = screen.getByLabelText(/archivo adjunto/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [makeFile('doc.txt', 'text/plain', 100)] } })
    expect(screen.getByRole('alert').textContent).toMatch(/tipo|pdf|jpg|png/i)
  })

  it('accepts a PDF and exposes the Subir button', () => {
    render(
      <PagoForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )
    const input = screen.getByLabelText(/archivo adjunto/i) as HTMLInputElement
    fireEvent.change(input, {
      target: { files: [makeFile('comprobante.pdf', 'application/pdf', 1000)] },
    })
    expect(screen.getByRole('button', { name: /subir archivo/i })).toBeInTheDocument()
  })

  it('rejects a file larger than 10 MB', () => {
    render(
      <PagoForm
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )
    const input = screen.getByLabelText(/archivo adjunto/i) as HTMLInputElement
    fireEvent.change(input, {
      target: {
        files: [makeFile('big.pdf', 'application/pdf', 11 * 1024 * 1024)],
      },
    })
    expect(screen.getByRole('alert').textContent).toMatch(/tamaño|10 MB|10MB/i)
  })

  it('can save the payment without attaching a comprobante', async () => {
    const onSuccess = vi.fn()
    render(
      <PagoForm
        onSuccess={onSuccess}
        onCancel={vi.fn()}
        initialSelectedProveedor={mockProveedor}
      />,
      { wrapper: createWrapper() },
    )

    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2026-05-01' } })
    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '1500' } })
    const metodoSelect = screen.getByLabelText(/método|metodo/i) as HTMLSelectElement
    fireEvent.change(metodoSelect, { target: { value: 'EFECTIVO' } })

    const submitBtn = screen.getByRole('button', { name: /guardar/i })
    fireEvent.click(submitBtn)

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled()
    }, { timeout: 3000 })
    // The payload may include comprobante_url: null (design decision — the
    // backend treats null and missing identically). The KEY must be in the
    // allowed set; the VALUE must be null because no file was uploaded.
    expect(lastCreatedPayload).not.toBeNull()
    if (lastCreatedPayload && 'comprobante_url' in lastCreatedPayload) {
      expect(lastCreatedPayload.comprobante_url).toBeNull()
    }
  })
})
