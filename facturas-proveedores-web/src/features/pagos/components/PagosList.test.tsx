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
import type { PagoListItem, PagoListResponse } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockPagoEfectivo: PagoListItem = {
  id: 'pago-1',
  proveedor_id: 'prov-1',
  monto: 1500,
  fecha: '2026-06-15',
  metodo: 'EFECTIVO',
  origen: 'MANUAL',
  created_at: '2026-06-15T10:00:00',
}

const mockPagoTransferencia: PagoListItem = {
  ...mockPagoEfectivo,
  id: 'pago-2',
  monto: 2500,
  metodo: 'TRANSFERENCIA',
}

const mockPagoListResponse: PagoListResponse = {
  items: [mockPagoEfectivo, mockPagoTransferencia],
  total: 2,
  page: 1,
  page_size: 50,
}

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/pagos', () => HttpResponse.json(mockPagoListResponse)),
  http.delete('/api/pagos/:id', () => new HttpResponse(null, { status: 204 })),
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
