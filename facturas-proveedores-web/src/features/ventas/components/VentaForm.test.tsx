/**
 * Tests for VentaForm — create/edit sales form (C-34, tasks 6.1-6.6).
 *
 * Mirrors PagoForm.test.tsx's MSW + QueryClientProvider + MemoryRouter setup.
 *
 * INVARIANT under test (design.md D1, spec "The customer field appears if
 * and only if the sale is on account"):
 *   - The customer field is rendered ONLY when forma_pago === 'CUENTA_CORRIENTE'.
 *   - It is REMOVED FROM THE DOM (not hidden) for every other payment method,
 *     and its value is discarded from form state on the same tick.
 *   - A cliente_id is submitted ONLY for a CUENTA_CORRIENTE sale.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { VentaForm } from './VentaForm'
import type { Venta, ClienteListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockVentaFiada: Venta = {
  id: 'venta-1',
  negocio_id: 'negocio-1',
  cliente_id: 'cliente-1',
  fecha: '2026-08-10',
  monto: '500.00',
  forma_pago: 'CUENTA_CORRIENTE',
  notas: null,
  created_at: '2026-08-10T10:00:00',
  updated_at: '2026-08-10T10:00:00',
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

// ── MSW Server ────────────────────────────────────────────────────────────────

let lastCreatedBody: Record<string, unknown> | null = null
let lastPatchBody: Record<string, unknown> | null = null

const server = setupServer(
  http.post('/api/ventas', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    lastCreatedBody = body
    return HttpResponse.json({ ...mockVentaFiada, ...body }, { status: 201 })
  }),

  http.patch('/api/ventas/:id', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    lastPatchBody = body
    return HttpResponse.json({ ...mockVentaFiada, ...body })
  }),

  // ClienteAutocomplete's underlying calls
  http.get('/api/clientes/buscar', ({ request }) => {
    const url = new URL(request.url)
    const nombre = url.searchParams.get('nombre') ?? ''
    if (!nombre || nombre.length < 2) return HttpResponse.json([])
    return HttpResponse.json([mockCliente])
  }),

  http.post('/api/clientes', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json(
      { ...mockCliente, id: 'cliente-new', nombre: body.nombre as string },
      { status: 201 },
    )
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  lastCreatedBody = null
  lastPatchBody = null
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

async function fillRequiredFields() {
  const fechaInput = document.getElementById('fecha') as HTMLInputElement
  fireEvent.change(fechaInput, { target: { value: '2026-08-10' } })
  const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
  fireEvent.change(montoInput, { target: { value: '1000' } })
}

function selectFormaPago(value: string) {
  const select = screen.getByLabelText(/forma de pago/i) as HTMLSelectElement
  fireEvent.change(select, { target: { value } })
}

// ── Task 6.1 — appears ───────────────────────────────────────────────────────

describe('VentaForm — the customer field appears for cuenta corriente (task 6.1)', () => {
  it('switching from EFECTIVO to CUENTA_CORRIENTE reveals the customer field, reachable by keyboard', () => {
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    expect(screen.queryByPlaceholderText(/buscar cliente/i)).not.toBeInTheDocument()

    selectFormaPago('CUENTA_CORRIENTE')

    const combobox = screen.getByPlaceholderText(/buscar cliente/i)
    expect(combobox).toBeInTheDocument()
    combobox.focus()
    expect(combobox).toHaveFocus()
  })

  it('switching from TARJETA to CUENTA_CORRIENTE also reveals it (triangulation — different starting method)', () => {
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    selectFormaPago('TARJETA')
    expect(screen.queryByPlaceholderText(/buscar cliente/i)).not.toBeInTheDocument()

    selectFormaPago('CUENTA_CORRIENTE')
    expect(screen.getByPlaceholderText(/buscar cliente/i)).toBeInTheDocument()
  })
})

// ── Task 6.2 — disappears ────────────────────────────────────────────────────

describe('VentaForm — the customer field disappears leaving cuenta corriente (task 6.2)', () => {
  it('switching to EFECTIVO removes the field from the DOM and submitting sends no cliente_id', async () => {
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    selectFormaPago('CUENTA_CORRIENTE')
    expect(screen.getByPlaceholderText(/buscar cliente/i)).toBeInTheDocument()

    selectFormaPago('EFECTIVO')
    expect(screen.queryByPlaceholderText(/buscar cliente/i)).not.toBeInTheDocument()

    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(lastCreatedBody).not.toBeNull())
    expect(lastCreatedBody).not.toHaveProperty('cliente_id')
  })

  it('switching to TARJETA also removes it and sends no cliente_id (triangulation)', async () => {
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    selectFormaPago('CUENTA_CORRIENTE')
    selectFormaPago('TARJETA')
    expect(screen.queryByPlaceholderText(/buscar cliente/i)).not.toBeInTheDocument()

    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(lastCreatedBody).not.toBeNull())
    expect(lastCreatedBody).not.toHaveProperty('cliente_id')
  })
})

// ── Task 6.3 — a fiado cannot be submitted without a customer ──────────────

describe('VentaForm — a fiado needs a customer (task 6.3)', () => {
  it('blocks submission when CUENTA_CORRIENTE is selected and no customer is chosen', async () => {
    const onSuccess = vi.fn()
    render(<VentaForm onSuccess={onSuccess} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    selectFormaPago('CUENTA_CORRIENTE')
    await fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    const alertText = screen.getAllByRole('alert').map((a) => a.textContent ?? '').join(' ')
    expect(alertText).toMatch(/fiado/i)
    expect(alertText).toMatch(/cliente/i)
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('blocks submission again if a customer was selected and then cleared (triangulation)', async () => {
    const onSuccess = vi.fn()
    render(<VentaForm onSuccess={onSuccess} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    selectFormaPago('CUENTA_CORRIENTE')
    await fillRequiredFields()

    const searchInput = screen.getByPlaceholderText(/buscar cliente/i)
    fireEvent.change(searchInput, { target: { value: 'Juan' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /juan pérez/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: /juan pérez/i }))
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /limpiar selección/i }))

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

// ── Task 6.4 — usable at the counter: today's date + focus ─────────────────

describe('VentaForm — opens ready to use (task 6.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens with today\'s date in America/Argentina/Buenos_Aires and focus on the amount field', () => {
    // 2026-08-14T02:00:00Z is 2026-08-13T23:00:00-03:00 in Buenos Aires —
    // still the 13th there, already the 14th in UTC (same fixture as
    // date.test.ts, proving the form is wired to the real helper).
    vi.setSystemTime(new Date('2026-08-14T02:00:00.000Z'))
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })

    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    expect(fechaInput.value).toBe('2026-08-13')

    const montoInput = screen.getByLabelText(/monto/i)
    expect(montoInput).toHaveFocus()
  })

  it('edit mode defaults the date field to the existing venta\'s date, not today (triangulation)', () => {
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'))
    render(<VentaForm venta={mockVentaFiada} onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: createWrapper(),
    })
    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    expect(fechaInput.value).toBe('2026-08-10')
  })
})

// ── Task 6.5 — future date and non-positive amount refused ─────────────────

describe('VentaForm — client validation names the rule (task 6.5)', () => {
  it('refuses a future date, naming the rule', async () => {
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    selectFormaPago('EFECTIVO')
    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2099-12-31' } })
    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '1000' } })

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    const alertText = screen.getAllByRole('alert').map((a) => a.textContent ?? '').join(' ')
    expect(alertText).toMatch(/futura|future/i)
  })

  it('refuses a non-positive amount, naming the rule (triangulation)', async () => {
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    fireEvent.change(fechaInput, { target: { value: '2026-08-01' } })
    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '0' } })

    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0))
    const alertText = screen.getAllByRole('alert').map((a) => a.textContent ?? '').join(' ')
    expect(alertText).toMatch(/cero|mayor/i)
  })
})

// ── Task 6.6 — backend 422 shown, not a generic failure ─────────────────────

describe('VentaForm — backend rejection is shown (task 6.6)', () => {
  it('shows the backend detail string instead of a generic failure', async () => {
    server.use(
      http.post('/api/ventas', () =>
        HttpResponse.json(
          { detail: 'Una venta en cuenta corriente necesita un cliente.' },
          { status: 422 },
        ),
      ),
    )
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() =>
      expect(screen.getByText(/una venta en cuenta corriente necesita un cliente/i)).toBeInTheDocument(),
    )
  })

  it('shows the first pydantic-array detail message (triangulation — different detail shape)', async () => {
    server.use(
      http.post('/api/ventas', () =>
        HttpResponse.json(
          { detail: [{ loc: ['body', 'monto'], msg: 'el monto debe ser mayor a 0', type: 'value_error' }] },
          { status: 422 },
        ),
      ),
    )
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() =>
      expect(screen.getByText(/el monto debe ser mayor a 0/i)).toBeInTheDocument(),
    )
  })
})

// ── Task 8.2/8.3/8.6 — the disappearing-debt warning on edit ───────────────
//
// design.md D5: saving an edit that moves a sale AWAY from CUENTA_CORRIENTE
// warns before the PATCH is sent. The amount/customer named in the warning
// come from the venta as loaded (`clienteInicial`, `venta.monto`) — the
// original debt, not whatever the (already-cleared) form state holds.

const mockClienteInicial = { id: 'cliente-1', nombre: 'Juan Pérez' }

describe('VentaForm — warns before saving when a fiado leaves cuenta corriente (task 8.2)', () => {
  it('opens the warning BEFORE sending the PATCH when the payment method is changed away from CUENTA_CORRIENTE', async () => {
    render(
      <VentaForm
        venta={mockVentaFiada}
        clienteInicial={mockClienteInicial}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    selectFormaPago('EFECTIVO')
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    expect(screen.getByText(/juan pérez/i)).toBeInTheDocument()
    // The request must NOT have gone out yet.
    expect(lastPatchBody).toBeNull()
  })

  it('sends the PATCH (new forma_pago, no cliente_id) once the warning is confirmed (triangulation)', async () => {
    render(
      <VentaForm
        venta={mockVentaFiada}
        clienteInicial={mockClienteInicial}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    selectFormaPago('EFECTIVO')
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('deuda-dialog-confirm'))

    await waitFor(() => expect(lastPatchBody).not.toBeNull())
    expect(lastPatchBody?.forma_pago).toBe('EFECTIVO')
    expect(lastPatchBody).not.toHaveProperty('cliente_id')
  })
})

describe('VentaForm — cancelling the warning changes nothing (task 8.3)', () => {
  it('sends no request and leaves the sale unchanged when the warning is cancelled', async () => {
    const onSuccess = vi.fn()
    render(
      <VentaForm
        venta={mockVentaFiada}
        clienteInicial={mockClienteInicial}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    selectFormaPago('EFECTIVO')
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('deuda-dialog-cancel'))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(lastPatchBody).toBeNull()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})

// ── C-42 (tasks 9.5-9.10) — result classification in the counter form ──────
//
// MSW drives every response here with REAL status codes and REAL headers —
// no mocking of `idempotency.ts`/`submitOutcome.ts`/`ventasApi.ts` — so
// these tests exercise the real classification path end to end.

describe('VentaForm — an unconfirmed ("desconocida") outcome (C-42, task 9.5)', () => {
  it('says it could not confirm the save, offers a safe retry, and keeps every field as typed', async () => {
    server.use(http.post('/api/ventas', () => HttpResponse.error()))
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.getByRole('status').textContent).toMatch(/no pudimos confirmar/i)
    expect(screen.getByRole('status').textContent).toMatch(/seguro/i)

    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    const fechaInput = document.getElementById('fecha') as HTMLInputElement
    expect(montoInput.value).toBe('1000')
    expect(fechaInput.value).toBe('2026-08-10')

    // The primary action relabels to make the retry explicit.
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })
})

describe('VentaForm — retrying sends the same Idempotency-Key (C-42, task 9.6)', () => {
  it('the retry after an unconfirmed failure reuses the key from the first attempt', async () => {
    const capturedKeys: (string | null)[] = []
    let call = 0
    server.use(
      http.post('/api/ventas', async ({ request }) => {
        call += 1
        capturedKeys.push(request.headers.get('Idempotency-Key'))
        if (call === 1) return HttpResponse.error()
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...mockVentaFiada, ...body }, { status: 201 })
      }),
    )
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    await waitFor(() => expect(capturedKeys).toHaveLength(2))

    expect(capturedKeys[0]).not.toBeNull()
    expect(capturedKeys[0]).toBe(capturedKeys[1])
  })
})

describe('VentaForm — a deduplicated replay reads as success (C-42, task 9.7)', () => {
  it('reports success with the "already recorded" flag and shows no error', async () => {
    server.use(
      http.post('/api/ventas', () =>
        HttpResponse.json(mockVentaFiada, { status: 200, headers: { 'Idempotent-Replay': 'true' } }),
      ),
    )
    const onSuccess = vi.fn()
    render(<VentaForm onSuccess={onSuccess} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: mockVentaFiada.id }),
      { replay: true },
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('an ordinary 201 creation reports replay: false (triangulation)', async () => {
    const onSuccess = vi.fn()
    render(<VentaForm onSuccess={onSuccess} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: mockVentaFiada.id }),
      { replay: false },
    )
  })
})

describe('VentaForm — a conflicting key explains itself, not as an unknown outcome (C-42, task 9.9)', () => {
  it('shows the backend\'s conflict message and never the "desconocida" banner', async () => {
    server.use(
      http.post('/api/ventas', () =>
        HttpResponse.json(
          {
            detail: {
              mensaje: 'Esta operación ya fue registrada con otros datos.',
              venta_existente: { ...mockVentaFiada },
            },
          },
          { status: 409 },
        ),
      ),
    )
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() =>
      expect(screen.getByText(/esta operación ya fue registrada con otros datos/i)).toBeInTheDocument(),
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('VentaForm — repeated unconfirmed attempts offer the sales list (C-42, task 9.10)', () => {
  it('does NOT offer the list after a single unconfirmed attempt', async () => {
    server.use(http.post('/api/ventas', () => HttpResponse.error()))
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /listado de ventas/i })).not.toBeInTheDocument()
  })

  it('offers the sales list after a second consecutive unconfirmed attempt (triangulation)', async () => {
    server.use(http.post('/api/ventas', () => HttpResponse.error()))
    render(<VentaForm onSuccess={vi.fn()} onCancel={vi.fn()} />, { wrapper: createWrapper() })
    await fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /reintentar/i }))
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /listado de ventas/i })).toBeInTheDocument(),
    )
  })
})

describe('VentaForm — editing only the amount of a fiado does not trigger the warning (task 8.6)', () => {
  it('saves directly, without the warning, when forma_pago stays CUENTA_CORRIENTE', async () => {
    render(
      <VentaForm
        venta={mockVentaFiada}
        clienteInicial={mockClienteInicial}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: createWrapper() },
    )
    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => expect(lastPatchBody).not.toBeNull())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(lastPatchBody?.monto).toBe('600')
  })
})
