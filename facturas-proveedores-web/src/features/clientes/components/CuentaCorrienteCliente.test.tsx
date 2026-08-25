/**
 * Tests for CuentaCorrienteCliente (C-36, design.md D1/D3, tasks 7.1-7.3,
 * 7.9-7.10).
 *
 * The panel composes SaldoBadge, TablaVentasFiadas and the VENTA/COBRO
 * HistorialTable config over a `CuentaCorrienteClienteResponse`. It does NO
 * client-side arithmetic — `saldo`, each fiado's `estado`, and each history
 * row's `saldo_acumulado` render exactly as the response carries them
 * (RN-SALDO, RN-FIFO, RN-HIST).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { CuentaCorrienteCliente } from './CuentaCorrienteCliente'
import { toast } from '@shared/components/Toaster/toast'

// C-43 Fase B — the panel is what turns the dialog's `meta.replay` into
// something the person can read. The Toaster itself is mounted once in
// AuthenticatedLayout, so it is not in this tree; the call is what matters.
vi.mock('@shared/components/Toaster/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
import type { CuentaCorrienteClienteResponse } from '@shared/api/api'

// CuentaCorrienteCliente renders CobroFormDialog when there is something to
// collect (task 9.4), which needs a QueryClient + Router in the tree.
function renderPanel(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function account(overrides: Partial<CuentaCorrienteClienteResponse> = {}): CuentaCorrienteClienteResponse {
  return {
    cliente_id: 'cliente-1',
    saldo: 1000,
    ventas_con_estado: [],
    historial: [],
    ...overrides,
  }
}

describe('CuentaCorrienteCliente — the negative balance renders as the real figure (task 7.1)', () => {
  it('a balance below zero renders as a credit in the customer\'s favour, with the real amount present', () => {
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: -450 })} />)
    const badge = screen.getByTestId('saldo-badge')
    expect(badge.dataset.variant).toBe('a-favor')
    expect(badge.textContent).toContain('450')
  })
})

describe('CuentaCorrienteCliente — saldo sign dispatch (task 7.2)', () => {
  it('a positive balance renders as debt, distinguishable from settled and credit', () => {
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: 800 })} />)
    expect(screen.getByTestId('saldo-badge').dataset.variant).toBe('deuda')
  })

  it('a zero balance renders as settled (triangulation)', () => {
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: 0 })} />)
    expect(screen.getByTestId('saldo-badge').dataset.variant).toBe('al-dia')
  })
})

describe('CuentaCorrienteCliente — the balance is the response field, never a sum (task 7.3)', () => {
  it('renders the response saldo even when it disagrees with the movement totals', () => {
    // Deliberately inconsistent: saldo says 200, but the fiado alone is 5000.
    // If the component summed movements instead of reading `saldo`, this
    // would render 5000 (or some derived figure), not 200.
    renderPanel(
      <CuentaCorrienteCliente
        cuentaCorriente={account({
          saldo: 200,
          ventas_con_estado: [
            {
              id: 'v-1',
              negocio_id: 'negocio-1',
              cliente_id: 'cliente-1',
              fecha: '2026-08-01',
              monto: 5000,
              forma_pago: 'CUENTA_CORRIENTE',
              notas: null,
              estado: 'PENDIENTE',
              created_at: '2026-08-01T10:00:00',
              updated_at: '2026-08-01T10:00:00',
            },
          ],
        })}
      />,
    )
    expect(screen.getByTestId('saldo-badge').textContent).toContain('200')
  })
})

describe('CuentaCorrienteCliente — history order invariant (task 7.9)', () => {
  const historial: CuentaCorrienteClienteResponse['historial'] = [
    { id: 'h-1', tipo: 'VENTA', fecha: '2026-08-01', monto: 1000, saldo_acumulado: 1000 },
    { id: 'h-2', tipo: 'COBRO', fecha: '2026-08-05', monto: 400, saldo_acumulado: 600 },
    { id: 'h-3', tipo: 'VENTA', fecha: '2026-08-10', monto: 300, saldo_acumulado: 900 },
  ]

  it('oldest-first and newest-first show the same saldo_acumulado per row, only reordered', () => {
    const { unmount } = renderPanel(
      <CuentaCorrienteCliente cuentaCorriente={account({ historial })} historialOrderDefault="asc" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    const ascSaldos = ['h-1', 'h-2', 'h-3'].map(
      (id) => screen.getByTestId(`historial-row-${id}`).querySelector('[data-testid="historial-saldo-acumulado"]')
        ?.textContent,
    )
    unmount()

    renderPanel(
      <CuentaCorrienteCliente cuentaCorriente={account({ historial })} historialOrderDefault="desc" />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    const descSaldos = ['h-3', 'h-2', 'h-1'].map(
      (id) => screen.getByTestId(`historial-row-${id}`).querySelector('[data-testid="historial-saldo-acumulado"]')
        ?.textContent,
    )

    expect(descSaldos).toEqual(ascSaldos.slice().reverse())
  })
})

// ── Nothing to collect (design.md D6, tasks 9.1-9.4) ─────────────────────────

describe('CuentaCorrienteCliente — the cobro action is absent, not disabled, when there is nothing to collect', () => {
  it('a zero balance offers no cobro action and states the customer is settled (task 9.1)', () => {
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: 0 })} />)
    expect(screen.queryByRole('button', { name: /registrar cobro/i })).not.toBeInTheDocument()
    expect(screen.getByText(/al día/i)).toBeInTheDocument()
  })

  it('a negative balance offers no cobro action and states the credit as a fact, not an error (task 9.2)', () => {
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: -300 })} />)
    expect(screen.queryByRole('button', { name: /registrar cobro/i })).not.toBeInTheDocument()
    // Both the badge ("$ 300,00 a favor") and the explanatory copy mention
    // "a favor" — the fact is stated at least once.
    expect(screen.getAllByText(/a favor/i).length).toBeGreaterThan(0)
    // Presented as a fact — not inside anything with role="alert".
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a positive balance DOES offer the cobro action (task 9.3)', () => {
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: 800 })} />)
    expect(screen.getByRole('button', { name: /registrar cobro/i })).toBeInTheDocument()
  })

  it('clicking "Registrar cobro" opens the CobroFormDialog (task 9.4)', () => {
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: 800 })} />)
    fireEvent.click(screen.getByRole('button', { name: /registrar cobro/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

// ── C-43 Fase B — the replay reaches the person (task 12.4) ────────────────
//
// `CobroFormDialog` resolves `{ cobro, replay }` and hands `replay` up via
// `onSuccess`'s second argument. Until now this panel dropped it on the
// floor: a deduplicated retry closed the dialog exactly like a fresh
// collection, so the one thing the person needed to know — that their
// retry did NOT charge the customer twice — was never said out loud.
//
// `useCrearCobro` is mocked so the dialog's own mutation resolves with a
// chosen `replay`, exercising the real dialog → panel → toast path.

const crearCobroMutate = vi.fn()
vi.mock('../api/cobrosHooks', () => ({
  useCrearCobro: () => ({
    mutate: (data: unknown, opts: { onSuccess: (r: unknown) => void }) =>
      crearCobroMutate(data, opts),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
  }),
}))

describe('CuentaCorrienteCliente — cobro outcome feedback (C-43 Fase B)', () => {
  beforeEach(() => {
    vi.mocked(toast.success).mockClear()
    crearCobroMutate.mockReset()
  })

  function submitCobro(replay: boolean) {
    crearCobroMutate.mockImplementation((_data, opts) => {
      opts.onSuccess({ cobro: { id: 'cobro-1' }, replay })
    })
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: 1000 })} />)
    fireEvent.click(screen.getByRole('button', { name: /registrar cobro/i }))
    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '1000' } })
    fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: '2026-08-20' } })
    fireEvent.change(screen.getByLabelText(/método/i), { target: { value: 'EFECTIVO' } })
    fireEvent.click(screen.getByRole('button', { name: /^registrar cobro$/i }))
  }

  it('says the cobro ALREADY was registered when the save was a deduplicated replay', () => {
    submitCobro(true)

    expect(toast.success).toHaveBeenCalledTimes(1)
    expect(vi.mocked(toast.success).mock.calls[0]?.[0]).toMatch(/ya estaba registrado/i)
  })

  it('says the cobro was registered on an ordinary creation (triangulation)', () => {
    submitCobro(false)

    expect(toast.success).toHaveBeenCalledTimes(1)
    const message = String(vi.mocked(toast.success).mock.calls[0]?.[0])
    expect(message).toMatch(/cobro registrado/i)
    expect(message).not.toMatch(/ya estaba/i)
  })
})

describe('CuentaCorrienteCliente — C-39, task 9.1: offers the export action', () => {
  it('a customer with debt shows the export action', () => {
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: 1000 })} />)
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument()
  })

  it('a saldo-cero customer still shows the export action (triangulation)', () => {
    renderPanel(<CuentaCorrienteCliente cuentaCorriente={account({ saldo: 0 })} />)
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument()
  })
})
