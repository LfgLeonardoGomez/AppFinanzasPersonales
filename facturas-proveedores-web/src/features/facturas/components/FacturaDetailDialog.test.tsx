/**
 * Tests for FacturaDetailDialog (c-26, factura-detail-view capability).
 *
 * A read-only view of one invoice, opened from the list. Reading an invoice
 * is the common case and must not drop the user inside an editable form —
 * editing is a further, explicit action taken from here.
 *
 * WHY IT FETCHES: the list endpoint returns a LEAN row (id, proveedor_id,
 * numero, fecha_emision, monto_total, estado). The backend omits
 * `archivo_url`, `origen`, `fecha_vencimiento` and items on purpose. The
 * frontend type used to claim otherwise, which is how the first version of
 * this dialog ended up unable to ever show "Ver archivo". The header comes
 * from the lean row so it paints immediately; everything else comes from
 * `GET /api/facturas/{id}`.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { FacturaListItem } from '@shared/api/api'
import { FacturaDetailDialog } from './FacturaDetailDialog'

const FACTURA: FacturaListItem = {
  id: 'fac-1',
  proveedor_id: 'prov-1',
  numero: '0001-00012345',
  fecha_emision: '2026-07-17',
  monto_total: 150000,
  estado: 'PARCIAL',
}

/** What GET /api/facturas/{id} returns — the fields the list does NOT carry. */
function fullFactura(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fac-1',
    usuario_id: 'user-1',
    proveedor_id: 'prov-1',
    numero: '0001-00012345',
    fecha_emision: '2026-07-17',
    fecha_vencimiento: null,
    monto_total: 150000,
    archivo_url: null,
    origen: 'MANUAL',
    estado: 'PARCIAL',
    items: [],
    items_sum_mismatch: false,
    created_at: '2026-07-17T10:00:00',
    updated_at: '2026-07-17T10:00:00',
    ...overrides,
  }
}

const server = setupServer(
  http.get('/api/facturas/:id', () => HttpResponse.json(fullFactura())),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function renderDialog(overrides: Partial<Parameters<typeof FacturaDetailDialog>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
  return render(
    <FacturaDetailDialog
      factura={FACTURA}
      proveedorNombre="pencamar"
      open
      onOpenChange={vi.fn()}
      onEdit={vi.fn()}
      {...overrides}
    />,
    { wrapper: Wrapper },
  )
}

describe('FacturaDetailDialog — core fields', () => {
  it('shows number, supplier, issue date, status and total from the lean row', () => {
    renderDialog()

    expect(screen.getByText(/0001-00012345/)).toBeInTheDocument()
    expect(screen.getByText('pencamar')).toBeInTheDocument()
    expect(screen.getByText('2026-07-17')).toBeInTheDocument()
    expect(screen.getByText('PARCIAL')).toBeInTheDocument()
    expect(screen.getByText(/150\.000/)).toBeInTheDocument()
  })

  it('fills in origen once the full invoice lands', async () => {
    // origen is NOT in the list payload — this is the field that exposed the
    // lying type in the first place.
    renderDialog()

    expect(await screen.findByText('MANUAL')).toBeInTheDocument()
  })

  it('renders nothing when there is no invoice', () => {
    const { container } = renderDialog({ factura: null })

    expect(container).toBeEmptyDOMElement()
  })

  it('never shows the supplier id as the supplier label', () => {
    renderDialog({ proveedorNombre: undefined })

    expect(screen.queryByText(FACTURA.proveedor_id)).not.toBeInTheDocument()
  })
})

describe('FacturaDetailDialog — line items', () => {
  it('lists the items from the fetched invoice', async () => {
    server.use(
      http.get('/api/facturas/:id', () =>
        HttpResponse.json(
          fullFactura({
            items: [
              { id: 'i-1', factura_id: 'fac-1', descripcion: 'Cemento', cantidad: 10, precio_unitario: 5000 },
              { id: 'i-2', factura_id: 'fac-1', descripcion: 'Arena', cantidad: 2, precio_unitario: 50000 },
            ],
          }),
        ),
      ),
    )
    renderDialog()

    expect(await screen.findByText('Cemento')).toBeInTheDocument()
    expect(screen.getByText('Arena')).toBeInTheDocument()
  })

  it('states explicitly when there are no items instead of rendering an empty region', async () => {
    renderDialog()

    expect(await screen.findByText(/sin ítems/i)).toBeInTheDocument()
  })
})

describe('FacturaDetailDialog — attachment', () => {
  it('opens the in-app viewer for an invoice that has a file', async () => {
    const url = 'https://res.cloudinary.com/demo/facturas/a.jpg'
    server.use(
      http.get('/api/facturas/:id', () => HttpResponse.json(fullFactura({ archivo_url: url }))),
    )
    renderDialog()

    fireEvent.click(await screen.findByRole('button', { name: /ver archivo/i }))

    expect(screen.getByRole('img')).toHaveAttribute('src', url)
  })

  it('offers no view-file action when the invoice has no attachment', async () => {
    renderDialog()

    // Wait for the fetch to settle so this is not a false pass on timing.
    await screen.findByText('MANUAL')
    expect(screen.queryByRole('button', { name: /ver archivo/i })).not.toBeInTheDocument()
  })
})

describe('FacturaDetailDialog — actions and fit', () => {
  it('exposes a visible close control that dismisses the view', () => {
    const onOpenChange = vi.fn()
    renderDialog({ onOpenChange })

    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('editing is an explicit further step, not the default', () => {
    const onEdit = vi.fn()
    renderDialog({ onEdit })

    fireEvent.click(screen.getByRole('button', { name: /editar/i }))

    expect(onEdit).toHaveBeenCalledWith(FACTURA)
  })

  it('does not fetch while closed', async () => {
    let calls = 0
    server.use(
      http.get('/api/facturas/:id', () => {
        calls++
        return HttpResponse.json(fullFactura())
      }),
    )
    renderDialog({ open: false })

    await waitFor(() => expect(calls).toBe(0))
  })

  it('caps its height with a dvh value and scrolls internally', () => {
    renderDialog()

    const dialog = screen.getByTestId('factura-detail-dialog')
    const nodes = [dialog, ...Array.from(dialog.querySelectorAll('*'))] as HTMLElement[]
    const capped = nodes.filter((el) => /max-h-\[\d+dvh\]/.test(el.className ?? ''))

    expect(capped.length).toBeGreaterThan(0)
    expect(
      capped.some((el) => /overflow-(y-)?auto|overflow-(y-)?scroll/.test(el.className)),
    ).toBe(true)
  })
})
