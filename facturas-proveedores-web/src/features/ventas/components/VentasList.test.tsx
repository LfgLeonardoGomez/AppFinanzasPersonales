/**
 * Tests for VentasList — the sales list with totals, edit and delete
 * (C-34, tasks 7.1, 7.4, 7.5, 8.1, 8.3, 8.5).
 *
 * Strategy: MSW intercepts all API calls (mirrors `PagosList`/`FacturasList`
 * MSW-less unit style is not applicable here since the list fetches — mirrors
 * `ventasHooks.test.tsx`'s MSW server setup instead).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { VentasList } from './VentasList'
import type { VentaListItem, ClienteListItem } from '@shared/api/api'

const ventaEfectivo: VentaListItem = {
  id: 'venta-1',
  negocio_id: 'negocio-1',
  cliente_id: null,
  fecha: '2026-08-10',
  monto: '1000.00',
  forma_pago: 'EFECTIVO',
  notas: null,
  created_at: '2026-08-10T10:00:00',
  updated_at: '2026-08-10T10:00:00',
}

const ventaFiada: VentaListItem = {
  id: 'venta-2',
  negocio_id: 'negocio-1',
  cliente_id: 'cliente-1',
  fecha: '2026-08-12',
  monto: '4500.00',
  forma_pago: 'CUENTA_CORRIENTE',
  notas: null,
  created_at: '2026-08-12T10:00:00',
  updated_at: '2026-08-12T10:00:00',
}

const mockCliente: ClienteListItem = {
  id: 'cliente-1',
  negocio_id: 'negocio-1',
  nombre: 'Juan Pérez',
  nombre_normalizado: 'JUAN PEREZ',
  telefono: null,
  notas: null,
  created_at: '2026-08-01T10:00:00',
  updated_at: '2026-08-01T10:00:00',
  saldo: null,
}

let deleteCallCount = 0

const server = setupServer(
  http.get('/api/ventas', () => HttpResponse.json([ventaEfectivo, ventaFiada])),
  http.get('/api/clientes', () => HttpResponse.json([mockCliente])),
  http.delete('/api/ventas/:id', () => {
    deleteCallCount += 1
    return new HttpResponse(null, { status: 204 })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  deleteCallCount = 0
})
afterEach(() => server.resetHandlers())

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('VentasList — newest first, badge per row, customer names (tasks 7.1/7.4)', () => {
  it('renders sales newest first with a payment-method badge and the resolved customer name', async () => {
    render(<VentasList filters={{}} onEditVenta={vi.fn()} />, { wrapper: createWrapper() })

    await waitFor(() => expect(screen.getByText('CUENTA_CORRIENTE')).toBeInTheDocument())
    expect(screen.getByText('EFECTIVO')).toBeInTheDocument()
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()

    // Newest first: 2026-08-12 (fiada) before 2026-08-10 (efectivo).
    const cards = screen.getAllByTestId(/^venta-card-/)
    expect(cards[0]).toHaveAttribute('data-testid', 'venta-card-venta-2')
    expect(cards[1]).toHaveAttribute('data-testid', 'venta-card-venta-1')
  })
})

describe('VentasList — editing the RIGHT row in a multi-row list (review finding H)', () => {
  it('clicking Editar on one specific row calls onEditVenta with that row\'s venta, not another', async () => {
    const onEditVenta = vi.fn()
    render(<VentasList filters={{}} onEditVenta={onEditVenta} />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())

    // Two rows: venta-1 (EFECTIVO) and venta-2 (CUENTA_CORRIENTE) — the
    // "Editar" affordance used to share one identical aria-label across
    // every row (unlike "Eliminar venta {id}"), so this could not be
    // targeted per-row at all before the fix.
    fireEvent.click(screen.getByRole('button', { name: /editar venta venta-2/i }))
    expect(onEditVenta).toHaveBeenCalledTimes(1)
    expect(onEditVenta).toHaveBeenCalledWith(expect.objectContaining({ id: 'venta-2' }))

    fireEvent.click(screen.getByRole('button', { name: /editar venta venta-1/i }))
    expect(onEditVenta).toHaveBeenCalledTimes(2)
    expect(onEditVenta).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'venta-1' }))
  })
})

describe('VentasList — empty vs loading (task 7.5)', () => {
  it('shows a loading state while fetching, then an empty state distinguishable from it', async () => {
    server.use(http.get('/api/ventas', () => HttpResponse.json([])))
    render(<VentasList filters={{}} onEditVenta={vi.fn()} />, { wrapper: createWrapper() })

    expect(screen.getByRole('status')).toBeInTheDocument()

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    expect(screen.getAllByText(/no hay ventas|listado vacío/i).length).toBeGreaterThan(0)
  })
})

describe('VentasList — deleting a fiado opens the debt warning (task 8.1)', () => {
  it('names the customer and amount, and sends no DELETE until confirmed', async () => {
    render(<VentasList filters={{}} onEditVenta={vi.fn()} />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /eliminar venta venta-2/i }))

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    const dialogText = screen.getByRole('alertdialog').textContent ?? ''
    expect(dialogText).toMatch(/juan pérez/i)
    expect(dialogText).toMatch(/\$\s?4\.500,00/)
    expect(deleteCallCount).toBe(0)
  })

  it('sends the DELETE once the warning is confirmed (triangulation)', async () => {
    render(<VentasList filters={{}} onEditVenta={vi.fn()} />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /eliminar venta venta-2/i }))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('deuda-dialog-confirm'))

    await waitFor(() => expect(deleteCallCount).toBe(1))
  })
})

describe('VentasList — cancelling the debt warning sends no request (task 8.3)', () => {
  it('closes the dialog and leaves the sale unchanged', async () => {
    render(<VentasList filters={{}} onEditVenta={vi.fn()} />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /eliminar venta venta-2/i }))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('deuda-dialog-cancel'))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(deleteCallCount).toBe(0)
  })
})

describe('VentasList — a failed delete is surfaced, not silent (review finding B)', () => {
  it('shows an error and keeps the alertdialog open when deleting a fiado fails', async () => {
    server.use(
      http.delete('/api/ventas/:id', () => HttpResponse.json({ detail: 'Error interno.' }, { status: 500 })),
    )
    render(<VentasList filters={{}} onEditVenta={vi.fn()} />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /eliminar venta venta-2/i }))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    fireEvent.click(screen.getByTestId('deuda-dialog-confirm'))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('shows an error and keeps the plain confirm dialog open when deleting a cash sale fails (triangulation)', async () => {
    server.use(
      http.delete('/api/ventas/:id', () => HttpResponse.json({ detail: 'Error interno.' }, { status: 500 })),
    )
    render(<VentasList filters={{}} onEditVenta={vi.fn()} />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /eliminar venta venta-1/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('VentasList — deleting a cash sale confirms without the debt warning (task 8.5)', () => {
  it('opens a plain confirmation with no mention of debt, customer, or an amount ceasing to be owed', async () => {
    render(<VentasList filters={{}} onEditVenta={vi.fn()} />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /eliminar venta venta-1/i }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    const dialogText = screen.getByRole('dialog').textContent ?? ''
    expect(dialogText).not.toMatch(/deuda/i)
    expect(dialogText).not.toMatch(/cliente/i)
    expect(deleteCallCount).toBe(0)
  })

  it('sends the DELETE once confirmed, without ever opening the alertdialog (triangulation)', async () => {
    render(<VentasList filters={{}} onEditVenta={vi.fn()} />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /eliminar venta venta-1/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /^eliminar$/i }))

    await waitFor(() => expect(deleteCallCount).toBe(1))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })
})
