/**
 * Smoke tests for `CargaModal` — the unified carga modal (factura+pago,
 * IA+manual). Full end-to-end contracts (upload → create → onCreated,
 * for both origins and both tipos) live in
 * `PropuestaIAModal.e2e.test.tsx` and `PropuestaIAModal.pago.e2e.test.tsx`
 * (exercised through `FacturaFormPage`/`PagoFormPage`). These component
 * tests verify the React wiring for the origen step and its toggles.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import type { PropuestaFactura } from '@shared/api/api'
import { CargaModal } from './CargaModal'

const propuestaOk: PropuestaFactura = {
  proveedor_nombre: 'Acme SA',
  numero: '0001-00012345',
  fecha_emision: '2026-06-15',
  monto_total: 1234.56,
  error: false,
  error_message: null,
}

const server = setupServer(
  http.post('/api/facturas/extraer-ia', () => HttpResponse.json(propuestaOk, { status: 200 })),
  http.get('/api/proveedores/buscar', () => HttpResponse.json([])),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

function renderModal(overrides: Partial<Parameters<typeof CargaModal>[0]> = {}) {
  return render(
    <CargaModal
      open
      initialTipo="factura"
      onClose={vi.fn()}
      onCreated={vi.fn()}
      createFactura={vi.fn()}
      createPago={vi.fn()}
      {...overrides}
    />,
    { wrapper: makeWrapper() },
  )
}

describe('CargaModal — viewport fit (c-23)', () => {
  it('caps its height and scrolls internally so content is never clipped', () => {
    // This card grows with the AI proposal form, making it the dialog most
    // likely to outgrow a phone screen. See the sibling contract in
    // `features/proveedores/components/ModalViewportFit.test.tsx` — and note
    // the same caveat: JSDOM does no layout, so this locks the declaration,
    // not the rendered result.
    renderModal()

    const dialog = screen.getByRole('dialog')

    expect(
      /max-h-\[\d+dvh\]/.test(dialog.className),
      'no dvh-based max-height — a tall proposal form will overflow the viewport',
    ).toBe(true)
    expect(
      /overflow-(y-)?auto/.test(dialog.className),
      'height cap without a scroll container just hides the overflow',
    ).toBe(true)
  })

  it('keeps the flex centring layout after the cap', () => {
    // The cap sits on the card, not on the flex wrapper — regression guard
    // for the hand-rolled (non-Radix) centring this modal relies on.
    renderModal()

    const dialog = screen.getByRole('dialog')

    expect(dialog.className).toMatch(/\bflex\b/)
    expect(dialog.className).toMatch(/flex-col/)
    expect(dialog.parentElement?.className).toMatch(/items-center/)
    expect(dialog.parentElement?.className).toMatch(/justify-center/)
  })
})

describe('CargaModal — basic render and origen step', () => {
  it('renders the dialog when open, titled for the initial tipo, with both toggles and the dropzone', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Cargar factura')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Factura' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pago' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Con imagen/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Manual' })).toBeInTheDocument()
    expect(screen.getByTestId('imagen-picker-dropzone')).toBeInTheDocument()
    // Continuar starts disabled — no image picked yet.
    expect(screen.getByRole('button', { name: 'Continuar' })).toBeDisabled()
  })

  it('does NOT render the modal when open is false', () => {
    renderModal({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('toggling to Pago updates the title', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Pago' }))
    expect(screen.getByText('Registrar pago')).toBeInTheDocument()
  })

  it('toggling to Manual swaps the dropzone for the manual explanation and enables Continuar', () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    expect(screen.queryByTestId('imagen-picker-dropzone')).not.toBeInTheDocument()
    expect(screen.getByText(/completar los campos vos mismo/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continuar' })).not.toBeDisabled()
  })
})

describe('CargaModal — escape and close', () => {
  it('Escape closes the modal in the origen step', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('CargaModal — clearing the prefilled supplier (c-26)', () => {
  /**
   * Reproduces the user's actual path: opening the carga from INSIDE a
   * proveedor (`?proveedor_id=`), which arrives as `initialSelectedProveedor`.
   *
   * The prefill-sync effect guarded on `selectedProveedor === null`, a state
   * that means both "the prefill has not been applied yet" and "the user just
   * cleared it on purpose", so clearing was undone on the next render. Same
   * defect as SupplierMatchControl in c-23, one level up — fixing the child
   * alone was not enough, because this parent re-applies the prefill.
   *
   * The assertion has to survive an effect pass; asserting synchronously
   * right after the click passes against the broken code.
   */
  const PREFILL = {
    id: 'prov-1',
    usuario_id: 'user-1',
    nombre: 'Pencamar',
    cuit: null,
    telefono: null,
    categoria: 'OTRO' as const,
    notas: null,
    saldo: 0,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
  }

  async function reachReviewWithPrefill() {
    renderModal({ initialSelectedProveedor: PREFILL })
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await waitFor(() => expect(screen.getByLabelText(/Monto total/i)).toBeInTheDocument())
  }

  it('prefills the supplier when opened from a proveedor', async () => {
    await reachReviewWithPrefill()

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /limpiar/i })).toBeInTheDocument(),
    )
  })

  it('keeps the supplier cleared after the user clicks the x', async () => {
    await reachReviewWithPrefill()
    const clear = await screen.findByRole('button', { name: /limpiar/i })

    fireEvent.click(clear)

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /limpiar/i })).not.toBeInTheDocument(),
    )
    // Survives the next effect pass — the whole point of the bug.
    await new Promise((r) => setTimeout(r, 60))
    expect(screen.queryByRole('button', { name: /limpiar/i })).not.toBeInTheDocument()
  })

  it('leaves the supplier search usable so a different one can be typed', async () => {
    await reachReviewWithPrefill()
    fireEvent.click(await screen.findByRole('button', { name: /limpiar/i }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /limpiar/i })).not.toBeInTheDocument(),
    )
    expect(screen.getByRole('combobox')).toBeEnabled()
  })

  it('disables Confirmar once the supplier is cleared', async () => {
    // A cleared supplier must not be silently re-applied at confirm time —
    // creating the resource against the prefilled supplier the user just
    // rejected would be worse than the visual glitch.
    await reachReviewWithPrefill()
    fireEvent.click(await screen.findByRole('button', { name: /limpiar/i }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled(),
    )
  })
})

describe('CargaModal — manual flow reaches review with empty fields', () => {
  it('Manual → Continuar renders the review step with empty inputs and no image banner', async () => {
    renderModal()
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await waitFor(() => {
      expect(screen.getByLabelText(/Monto total/i)).toBeInTheDocument()
    })
    expect((screen.getByLabelText(/Monto total/i) as HTMLInputElement).value).toBe('')
    expect(screen.queryByText(/revisá y corregí/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
  })
})

describe('CargaModal — imagen extraction flow', () => {
  it('picking a file transitions origen → processing → review; the banner shows and Confirmar starts disabled', async () => {
    const onCreated = vi.fn()
    const createFactura = vi.fn()
    renderModal({ onCreated, createFactura })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(100)], 'f.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await waitFor(() => {
      expect((screen.getByLabelText(/Monto total/i) as HTMLInputElement).value).toBe('1234.56')
    })
    expect(screen.getByText(/revisá y corregí/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Confirmar' })).toBeDisabled()
    })
    expect(onCreated).not.toHaveBeenCalled()
    expect(createFactura).not.toHaveBeenCalled()
  })
})

// ── Radix dialog shell (c-27, item B) ───────────────────────────────────────
//
// These lock the contract added by `specs/ia-vision-frontend/spec.md`
// ("The carga modal behaves like every other dialog") for the Radix
// migration. They are NEW coverage — the pre-existing tests above are the
// behaviour-preservation contract (design D3) and are deliberately left
// untouched.
describe('CargaModal — Radix dialog shell (c-27)', () => {
  it('traps focus: tabbing forward past the last focusable control stays inside the modal', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <button type="button" data-testid="outside-button">
          Fuera del modal
        </button>
        <CargaModal
          open
          initialTipo="factura"
          onClose={vi.fn()}
          onCreated={vi.fn()}
          createFactura={vi.fn()}
          createPago={vi.fn()}
        />
      </div>,
      { wrapper: makeWrapper() },
    )
    // Manual origin enables Continuar immediately, making it the last
    // focusable control without waiting on an extraction round-trip.
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    const continuar = screen.getByRole('button', { name: 'Continuar' })
    continuar.focus()
    expect(continuar).toHaveFocus()

    await user.tab()

    // The outside button is aria-hidden while the dialog is open (Radix
    // hides the rest of the page from assistive tech), so it is queried by
    // raw DOM lookup here rather than getByRole — an accessible-role query
    // would correctly fail to find it at all while the trap is active.
    const outsideButton = document.querySelector('[data-testid="outside-button"]')
    expect(outsideButton).not.toBeNull()
    expect(outsideButton).not.toHaveFocus()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })

  it('Esc closes the modal from the review step when dismissal is allowed', async () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await waitFor(() => expect(screen.getByLabelText(/Monto total/i)).toBeInTheDocument())

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('activating the backdrop closes the modal when dismissal is allowed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })

    const overlay = document.querySelector('[data-testid="carga-modal-overlay"]')
    expect(overlay).not.toBeNull()
    await user.click(overlay as Element)

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does NOT close on Esc or backdrop activation while extraction is in progress', async () => {
    // The extraction request never resolves, holding the modal on
    // 'processing' for the duration of the assertions.
    server.use(
      http.post('/api/facturas/extraer-ia', () => new Promise(() => {})),
    )
    const user = userEvent.setup()
    const onClose = vi.fn()
    renderModal({ onClose })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(100)], 'f.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await waitFor(() => expect(screen.getByText(/La IA está leyendo el documento/i)).toBeInTheDocument())

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    const overlay = document.querySelector('[data-testid="carga-modal-overlay"]')
    if (overlay) {
      await user.click(overlay as Element)
    }

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('returns focus to the element that opened it (B.7)', async () => {
    // The hand-rolled version tracked the previously-focused element in a ref
    // and restored it by hand. Radix's FocusScope does this on unmount, so the
    // manual ref was removed — this test is what makes that removal safe
    // instead of a silent regression.
    const opener = document.createElement('button')
    opener.textContent = 'Cargar'
    document.body.appendChild(opener)
    opener.focus()
    expect(document.activeElement).toBe(opener)

    const { rerender } = renderModal({ open: true })
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument())
    // Focus moved into the dialog.
    expect(document.activeElement).not.toBe(opener)

    rerender(
      <CargaModal
        open={false}
        initialTipo="factura"
        onClose={vi.fn()}
        onCreated={vi.fn()}
        createFactura={vi.fn()}
        createPago={vi.fn()}
      />,
    )

    await waitFor(() => expect(document.activeElement).toBe(opener))
    opener.remove()
  })
})
