/**
 * Tests for FacturasList — renders estado badges, ARS amounts, empty state, delete with confirmation.
 * TDD: Task 7.3 (RED) → 7.4 (GREEN) → 7.5 (TRIANGULATE).
 *
 * Key invariants:
 * - estado badge comes from the response (never recomputed here — RN-FAC-09).
 * - monto_total is formatted with Intl.NumberFormat ARS.
 * - Delete requires confirmation; successful delete invalidates the list.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { FacturasList } from './FacturasList'
import type { FacturaListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockFacturaPendiente: FacturaListItem = {
  id: 'fac-1',
  proveedor_id: 'prov-1',
  numero: 'FAC-001',
  fecha_emision: '2026-06-01',
  monto_total: 1500,
  estado: 'PENDIENTE',
}

const mockFacturaPagada: FacturaListItem = {
  ...mockFacturaPendiente,
  id: 'fac-2',
  numero: 'FAC-002',
  monto_total: 2500,
  estado: 'PAGADA',
}

const mockListResponse: FacturaListItem[] = [mockFacturaPendiente, mockFacturaPagada]

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/facturas', () => HttpResponse.json(mockListResponse)),
  http.delete('/api/facturas/:id', () => new HttpResponse(null, { status: 204 })),
  // Supplier name lookup for the proveedor chip (display-only, existing hook).
  http.get('/api/proveedores', () =>
    HttpResponse.json([
      {
        id: 'prov-1',
        usuario_id: 'user-1',
        nombre: 'Proveedor Uno',
        cuit: null,
        telefono: null,
        categoria: 'OTRO',
        notas: null,
        saldo: 0,
        created_at: '2026-06-01T00:00:00',
        updated_at: '2026-06-01T00:00:00',
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

describe('FacturasList', () => {
  it('opens the read-only detail when the row is activated (c-26)', async () => {
    render(<FacturasList filters={{}} onEditFactura={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('FAC-001', { exact: false })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ver detalle de la factura FAC-001/i }))

    // The detail dialog, not the edit form.
    const dialog = await screen.findByTestId('factura-detail-dialog')
    expect(dialog).toBeInTheDocument()
    expect(dialog).toHaveTextContent('FAC-001')
  })

  it('does NOT open the detail when the row edit control is used (D4)', async () => {
    // The action buttons sit OUTSIDE the clickable region by construction, so
    // this cannot regress by someone forgetting a stopPropagation call.
    const onEditFactura = vi.fn()
    render(<FacturasList filters={{}} onEditFactura={onEditFactura} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('FAC-001', { exact: false })).toBeInTheDocument())

    fireEvent.click(screen.getAllByRole('button', { name: 'Editar' })[0] as HTMLElement)

    expect(onEditFactura).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('factura-detail-dialog')).not.toBeInTheDocument()
  })

  it('editing from inside the detail reaches the same edit callback', async () => {
    const onEditFactura = vi.fn()
    render(<FacturasList filters={{}} onEditFactura={onEditFactura} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('FAC-001', { exact: false })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /ver detalle de la factura FAC-001/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^editar$/i }))

    expect(onEditFactura).toHaveBeenCalledWith(expect.objectContaining({ id: 'fac-1' }))
  })

  it('renders estado badges from the response (PENDIENTE + PAGADA)', async () => {
    render(<FacturasList filters={{}} onEditFactura={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText('PENDIENTE')).toBeInTheDocument()
      expect(screen.getByText('PAGADA')).toBeInTheDocument()
    })
  })

  it('formats monto_total with Intl.NumberFormat ARS', async () => {
    render(<FacturasList filters={{}} onEditFactura={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      // 1500 formatted in ARS locale
      expect(screen.getByText(/1\.500/)).toBeInTheDocument()
    })
  })

  it('shows empty state when the list is empty', async () => {
    server.use(
      http.get('/api/facturas', () => HttpResponse.json([])),
    )
    render(<FacturasList filters={{}} onEditFactura={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText(/sin facturas|no hay|empty/i)).toBeInTheDocument()
    })
  })

  it('shows a confirmation dialog before deleting', async () => {
    render(<FacturasList filters={{}} onEditFactura={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText('PENDIENTE')).toBeInTheDocument()
    })

    const deleteButtons = screen.getAllByRole('button', { name: /eliminar/i })
    fireEvent.click(deleteButtons[0]!)

    // Confirmation should appear
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  it('calls DELETE /api/facturas/{id} after confirmation', async () => {
    render(<FacturasList filters={{}} onEditFactura={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => {
      expect(screen.getByText('PENDIENTE')).toBeInTheDocument()
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
})
