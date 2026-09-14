/**
 * Tests for PagosList — renders PagoCard per row, empty state, delete with confirmation.
 *
 * TDD: Task 7.3 (RED) → 7.4 (GREEN) → 7.5 (TRIANGULATE).
 *
 * Mirrors C-09 `FacturasList` rhythm:
 *   - monto formatted with Intl.NumberFormat ARS
 *   - delete requires confirmation dialog (RN-PAG-05 — soft delete, presented as normal)
 *   - on successful delete the list is invalidated
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PagosList } from './PagosList'

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// Wire shape (C-41, D9): `monto` is a Pydantic-v2 Decimal STRING on the
// wire. `parsePagoListItem` (pagosApi.ts) converts it to the `number` the
// public `PagoListItem` type promises.

const mockPagoEfectivo = {
  id: 'pago-1',
  proveedor_id: 'prov-1',
  monto: '1500',
  fecha: '2026-06-15',
  metodo: 'EFECTIVO',
  origen: 'MANUAL',
  created_at: '2026-06-15T10:00:00',
}

const mockPagoTransferencia = {
  ...mockPagoEfectivo,
  id: 'pago-2',
  monto: '2500',
  metodo: 'TRANSFERENCIA',
}

const mockPagoListResponse = {
  items: [mockPagoEfectivo, mockPagoTransferencia],
  total: 2,
  page: 1,
  page_size: 50,
}

// ── MSW Server ────────────────────────────────────────────────────────────────

// Full record for GET /api/pagos/{id} — the detail dialog fetches this for
// `comprobante_url`, which `PagoListItem` omits on purpose (api.generated.d.ts).
function fullPago(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pago-1',
    negocio_id: 'negocio-1',
    proveedor_id: 'prov-1',
    monto: '1500',
    fecha: '2026-06-15',
    metodo: 'EFECTIVO',
    comprobante_url: null,
    origen: 'MANUAL',
    created_at: '2026-06-15T10:00:00',
    updated_at: '2026-06-15T10:00:00',
    proveedor_nombre: 'Proveedor Uno',
    ...overrides,
  }
}

const server = setupServer(
  http.get('/api/pagos', () => HttpResponse.json(mockPagoListResponse)),
  http.get('/api/pagos/:id', () => HttpResponse.json(fullPago())),
  http.delete('/api/pagos/:id', () => new HttpResponse(null, { status: 204 })),
  // Supplier name lookup for the proveedor chip (display-only, existing
  // hook). Wire shape (C-41, D9): the lean list row, saldo as a string.
  http.get('/api/proveedores', () =>
    HttpResponse.json([
      {
        id: 'prov-1',
        nombre: 'Proveedor Uno',
        cuit: null,
        categoria: 'OTRO',
        saldo: '0',
        ultima_factura_fecha: null,
      },
    ]),
  ),
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PagosList — read-only detail dialog', () => {
  it('opens the read-only detail when the row is activated', async () => {
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ver detalle del pago pago-1/i }))

    // The detail dialog, not the edit form.
    const dialog = await screen.findByTestId('pago-detail-dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent('2026-06-15')
    expect(dialog).toHaveTextContent('EFECTIVO')
  })

  it('shows a pago without comprobante or observaciones with no comprobante action', async () => {
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ver detalle del pago pago-1/i }))
    await screen.findByTestId('pago-detail-dialog')

    // The comprobante fetch has settled (fullPago() has comprobante_url: null).
    await waitFor(() => expect(screen.getByText('MANUAL')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /ver comprobante/i })).not.toBeInTheDocument()
  })

  it('offers the comprobante action once the full pago lands with one', async () => {
    server.use(
      http.get('/api/pagos/:id', () =>
        HttpResponse.json(
          fullPago({ comprobante_url: 'https://res.cloudinary.com/demo/comprobantes/a.jpg' }),
        ),
      ),
    )
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ver detalle del pago pago-1/i }))

    expect(
      await screen.findByRole('button', { name: /ver comprobante/i }),
    ).toBeInTheDocument()
  })

  it('does NOT open the detail when the row edit control is used', async () => {
    // The action buttons sit OUTSIDE the clickable region by construction, so
    // this cannot regress by someone forgetting a stopPropagation call.
    const onEditPago = vi.fn()
    render(<PagosList filters={{}} onEditPago={onEditPago} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0] as HTMLElement)

    expect(onEditPago).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('pago-detail-dialog')).not.toBeInTheDocument()
  })

  it('does NOT open the detail when the row delete control is used', async () => {
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: /eliminar/i })[0] as HTMLElement)

    expect(screen.queryByTestId('pago-detail-dialog')).not.toBeInTheDocument()
  })

  it('closes the detail dialog', async () => {
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ver detalle del pago pago-1/i }))
    await screen.findByTestId('pago-detail-dialog')

    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

    await waitFor(() => {
      expect(screen.queryByTestId('pago-detail-dialog')).not.toBeInTheDocument()
    })
  })

  it('editing from inside the detail reaches the same edit callback', async () => {
    const onEditPago = vi.fn()
    render(<PagosList filters={{}} onEditPago={onEditPago} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ver detalle del pago pago-1/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^editar$/i }))

    expect(onEditPago).toHaveBeenCalledWith(expect.objectContaining({ id: 'pago-1' }))
  })
})

describe('PagosList', () => {
  it('renders MetodoBadge for each pago (EFECTIVO + TRANSFERENCIA)', async () => {
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText('EFECTIVO')).toBeInTheDocument()
      expect(screen.getByText('TRANSFERENCIA')).toBeInTheDocument()
    })
  })

  it('formats monto with Intl.NumberFormat ARS', async () => {
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText(/1\.500/)).toBeInTheDocument()
      expect(screen.getByText(/2\.500/)).toBeInTheDocument()
    })
  })

  it('shows empty state when the list is empty', async () => {
    server.use(
      http.get('/api/pagos', () =>
        HttpResponse.json({ ...mockPagoListResponse, items: [], total: 0 }),
      ),
    )
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText(/sin pagos|no hay|empty/i)).toBeInTheDocument()
    })
  })

  it('shows a confirmation dialog before deleting', async () => {
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText('EFECTIVO')).toBeInTheDocument()
    })
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar/i })
    fireEvent.click(deleteButtons[0]!)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('calls DELETE /api/pagos/{id} after confirmation', async () => {
    render(<PagosList filters={{}} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText('EFECTIVO')).toBeInTheDocument()
    })
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar/i })
    fireEvent.click(deleteButtons[0]!)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
    const confirmBtn = screen.getByRole('button', { name: /confirmar|sí|yes/i })
    fireEvent.click(confirmBtn)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('narrows the list when a proveedor_id filter is applied', async () => {
    let lastQuery: URL | null = null
    server.use(
      http.get('/api/pagos', ({ request }) => {
        lastQuery = new URL(request.url)
        return HttpResponse.json(mockPagoListResponse)
      }),
    )
    render(<PagosList filters={{ proveedor_id: 'prov-1' }} onEditPago={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText('EFECTIVO')).toBeInTheDocument()
    })
    expect(lastQuery).not.toBeNull()
    expect(lastQuery!.searchParams.get('proveedor_id')).toBe('prov-1')
  })
})
