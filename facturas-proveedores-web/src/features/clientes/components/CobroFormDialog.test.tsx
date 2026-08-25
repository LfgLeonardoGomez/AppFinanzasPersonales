/**
 * Tests for CobroFormDialog (C-36, design.md D6/D8/D11, tasks 8.1-8.11).
 *
 * The ceiling shown here is a COURTESY — the backend recomputes the
 * available balance server-side on every create and its `422 detail` is the
 * actual rule (design.md D6). This form implements NO idempotency: no
 * `Idempotency-Key`, no `@shared/api/idempotency` import — that is C-43
 * Fase B (design.md D7).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { CobroFormDialog } from './CobroFormDialog'
import type { CrearCobroResult } from '../api/cobrosApi'

// The dialog always calls `useCrearCobro()` internally (even when a test
// passes `externalCreateMutation` to bypass the real network call) — it
// needs a QueryClient in the tree, mirroring `PagoForm.test.tsx`. The
// unconfirmed-outcome banner also renders a router `<Link>`, so this mirrors
// `VentaForm.test.tsx`'s MemoryRouter wrapping too.
function renderDialog(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

/** A duck-typed AxiosError shape — `isAxiosError: true` is what
 * `axios.isAxiosError` actually checks; a plain object without it is NOT
 * recognized, which would misclassify every rejection as "unknown". */
function axiosError(status: number, data?: unknown) {
  return { isAxiosError: true, response: { status, data } }
}

interface MutateOpts {
  onSuccess: (result: CrearCobroResult) => void
  onError: (err: unknown) => void
}
type MutateFn = (data: import('@shared/api/api').CobroClienteCreate, opts: MutateOpts) => void

function makeMutation(overrides: Partial<{
  mutate: MutateFn
  isPending: boolean
}> = {}) {
  return {
    mutate: overrides.mutate ?? vi.fn(),
    isPending: overrides.isPending ?? false,
    isError: false,
    isSuccess: false,
    error: null,
    data: undefined,
    // Minimal duck-typed shape — the component only reads mutate/isPending.
  } as unknown as import('@tanstack/react-query').UseMutationResult<
    CrearCobroResult,
    Error,
    import('@shared/api/api').CobroClienteCreate
  >
}

describe('CobroFormDialog — the ceiling is stated (task 8.1)', () => {
  it('shows the maximum collectable amount, equal to the account balance', () => {
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1500}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation()}
      />,
    )
    expect(screen.getByText(/1\.500/)).toBeInTheDocument()
    expect(screen.getByLabelText(/monto/i)).toHaveAttribute('max', '1500')
  })
})

describe('CobroFormDialog — refused before the request (task 8.2)', () => {
  it('an amount above the balance shows the problem and issues no request', () => {
    const mutate = vi.fn()
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation({ mutate })}
      />,
    )
    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '1500' } })
    fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: '2026-08-16' } })
    fireEvent.change(screen.getByLabelText(/método/i), { target: { value: 'EFECTIVO' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))

    expect(screen.getByRole('alert').textContent).toMatch(/supera|máximo|excede/i)
    expect(mutate).not.toHaveBeenCalled()
  })
})

describe('CobroFormDialog — the amount is left exactly as typed (task 8.3)', () => {
  it('does not rewrite an over-ceiling amount to fit', () => {
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation()}
      />,
    )
    const input = screen.getByLabelText(/monto/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: '9999' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))
    expect(input.value).toBe('9999')
  })
})

describe('CobroFormDialog — the backend is the rule (task 8.4)', () => {
  it('shows the 422 detail verbatim, keeps every value, and invalidates the account on rejection', async () => {
    const onInvalidate = vi.fn()
    const mutate = vi.fn((_data, opts) => {
      opts.onError(axiosError(422, { detail: 'El monto supera el saldo pendiente ($800.00).' }))
    })
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={800}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation({ mutate })}
        onAccountInvalidate={onInvalidate}
      />,
    )
    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '700' } })
    fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: '2026-08-16' } })
    fireEvent.change(screen.getByLabelText(/método/i), { target: { value: 'EFECTIVO' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('El monto supera el saldo pendiente'),
    )
    expect((screen.getByLabelText(/monto/i) as HTMLInputElement).value).toBe('700')
    expect(onInvalidate).toHaveBeenCalled()
  })
})

describe('CobroFormDialog — date and amount validation (task 8.5)', () => {
  it('opens on today\'s Argentina date with that date as max, and refuses a future date / non-positive amount', () => {
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation()}
      />,
    )
    const fechaInput = screen.getByLabelText(/fecha/i) as HTMLInputElement
    expect(fechaInput.max).toBeTruthy()
    expect(fechaInput.value).toBe(fechaInput.max)

    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))
    expect(screen.getByText(/mayor a cero/i)).toBeInTheDocument()
  })
})

describe('CobroFormDialog — method options (task 8.6)', () => {
  it('offers exactly cash, transfer, card and other — no on-account option', () => {
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation()}
      />,
    )
    const select = screen.getByLabelText(/método/i) as HTMLSelectElement
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean)
    expect(values.sort()).toEqual(['EFECTIVO', 'OTRO', 'TARJETA', 'TRANSFERENCIA'].sort())
    expect(values).not.toContain('CUENTA_CORRIENTE')
  })
})

describe('CobroFormDialog — no way to select a sale (task 8.7)', () => {
  it('offers no venta selector or reference', () => {
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation()}
      />,
    )
    expect(screen.queryByLabelText(/venta/i)).not.toBeInTheDocument()
  })
})

describe('CobroFormDialog — unconfirmed outcome (task 8.8-8.9)', () => {
  it('a request with no response renders a role=status banner distinct from role=alert and retains the typed values', async () => {
    const mutate = vi.fn((_data, opts) => {
      opts.onError({ isAxiosError: true }) // network error / timeout — no `response` at all
    })
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation({ mutate })}
      />,
    )
    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: '2026-08-16' } })
    fireEvent.change(screen.getByLabelText(/método/i), { target: { value: 'EFECTIVO' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect((screen.getByLabelText(/monto/i) as HTMLInputElement).value).toBe('500')

    // C-43 Fase B (design.md D8) — this assertion USED to read "points at
    // the movements, never claims retry is safe". That was the honest copy
    // for an endpoint that did not dedupe. `crearCobro` now sends the key,
    // so the promise became true and the copy moved with it; the detailed
    // wording is pinned in the "unconfirmed-outcome copy after C-43" block
    // below. What this test still guards is the STRUCTURE: an unconfirmed
    // outcome is a status, never an alert, and never clears the form.
    const banner = screen.getByRole('status')
    expect(banner.textContent).toMatch(/no pudimos confirmar/i)
  })

  it('a 500 also renders the unconfirmed banner, not the ordinary rejected path (triangulation)', async () => {
    const mutate = vi.fn((_data, opts) => {
      opts.onError(axiosError(500, {}))
    })
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation({ mutate })}
      />,
    )
    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: '2026-08-16' } })
    fireEvent.change(screen.getByLabelText(/método/i), { target: { value: 'EFECTIVO' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
  })
})

describe('CobroFormDialog — ordinary rejection path (task 8.10)', () => {
  it('a 4xx below 500 shows the backend detail via role=alert, no unconfirmed banner', async () => {
    const mutate = vi.fn((_data, opts) => {
      opts.onError(axiosError(409, { detail: 'Conflicto.' }))
    })
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation({ mutate })}
      />,
    )
    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: '2026-08-16' } })
    fireEvent.change(screen.getByLabelText(/método/i), { target: { value: 'EFECTIVO' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Conflicto.'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

describe('CobroFormDialog — the C-43 branch is live (task 8.11)', () => {
  it('reports the cobro as already recorded when crearCobro resolves { replay: true }', async () => {
    const onSuccess = vi.fn()
    const mutate = vi.fn((_data, opts) => {
      opts.onSuccess({ cobro: { id: 'cobro-1' }, replay: true })
    })
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={onSuccess}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation({ mutate })}
      />,
    )
    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '500' } })
    fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: '2026-08-16' } })
    fireEvent.change(screen.getByLabelText(/método/i), { target: { value: 'EFECTIVO' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
    const [, meta] = onSuccess.mock.calls[0] as [unknown, { replay?: boolean } | undefined]
    expect(meta?.replay).toBe(true)
  })
})

// ── C-43 Fase B — the copy the protection earns (task 12.4, design.md D8) ────
//
// D8's rule is general: the promise "retrying is safe" may ONLY be made by a
// form that actually sends the key. `crearCobro` now does, so the interim
// copy C-36 wrote — which pointed at the customer's movements and never
// offered a retry — is retired here, in the same deliverable as the wiring.

describe('CobroFormDialog — unconfirmed-outcome copy after C-43 (task 12.4)', () => {
  function submitWithUnknownOutcome() {
    const mutate = vi.fn((_data, opts) => {
      // No `response` at all — a lost answer, the ambiguous case.
      opts.onError({ isAxiosError: true })
    })
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation({ mutate })}
      />,
    )
    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '1000' } })
    fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: '2026-08-16' } })
    fireEvent.change(screen.getByLabelText(/método/i), { target: { value: 'EFECTIVO' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))
  }

  it('says retrying should be safe and no longer asks to check the movements first', async () => {
    submitWithUnknownOutcome()

    const banner = await screen.findByRole('status')
    expect(banner.textContent).toMatch(/reintentar debería ser seguro/i)
    // The retired claim, not the link: the movements pointer legitimately
    // survives inside the closed-or-reloaded caveat (next test), the same
    // way VentaForm keeps its list link there. What had to go is the
    // statement that the operation is NOT identified — now false.
    expect(banner.textContent).not.toMatch(/no queda identificada/i)
    // And checking the movements is no longer the precondition for retrying.
    expect(banner.textContent).not.toMatch(/antes de reintentar,\s*revis/i)
  })

  it('keeps the closed-or-reloaded-page caveat — the one state where the pending key is genuinely lost', async () => {
    submitWithUnknownOutcome()

    const banner = await screen.findByRole('status')
    expect(banner.textContent).toMatch(/cerrado o recargado/i)
  })

  it('offers the retry as the primary action — the submit button relabels to "Reintentar"', async () => {
    submitWithUnknownOutcome()

    await screen.findByRole('status')
    expect(screen.getByRole('button', { name: /^reintentar$/i })).toBeInTheDocument()
  })

  it('a real rejection still shows the backend detail and no unconfirmed banner (triangulation — the copy swap did not blur the two)', async () => {
    const mutate = vi.fn((_data, opts) => {
      opts.onError(axiosError(422, { detail: 'El monto supera el saldo pendiente.' }))
    })
    renderDialog(
      <CobroFormDialog
        open
        clienteId="cliente-1"
        saldo={1000}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
        externalCreateMutation={makeMutation({ mutate })}
      />,
    )
    fireEvent.change(screen.getByLabelText(/monto/i), { target: { value: '1000' } })
    fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: '2026-08-16' } })
    fireEvent.change(screen.getByLabelText(/método/i), { target: { value: 'EFECTIVO' } })
    fireEvent.click(screen.getByRole('button', { name: /guardar|registrar/i }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('El monto supera el saldo pendiente.'),
    )
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /registrar cobro/i })).toBeInTheDocument()
  })
})
