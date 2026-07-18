/**
 * Smoke tests for the PropuestaIAModal component (C-15, section 6;
 * TERMINAL as of C-21, D1).
 *
 * The full state-machine behavior is tested via the pure reducer
 * (`propuestaModalReducer.test.ts`). These component tests verify the
 * React wiring: the modal renders, the idle state shows the
 * ImagenPicker, the Confirmar button is disabled until a supplier is
 * picked. The full terminal-confirm contract (upload → create →
 * onCreated) is covered by `PropuestaIAModal.e2e.test.tsx` (task 3.2).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import type { PropuestaFactura } from '@shared/api/api'
import { PropuestaIAModal } from './PropuestaIAModal'

const propuestaOk: PropuestaFactura = {
  proveedor_nombre: 'Acme SA',
  numero: '0001-00012345',
  fecha_emision: '2026-06-15',
  monto_total: 1234.56,
  error: false,
  error_message: null,
}

const server = setupServer(
  http.post('/api/facturas/extraer-ia', () =>
    HttpResponse.json(propuestaOk, { status: 200 }),
  ),
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

function renderModal(overrides: Partial<Parameters<typeof PropuestaIAModal>[0]> = {}) {
  return render(
    <PropuestaIAModal
      open
      tipo="factura"
      onClose={vi.fn()}
      onCreated={vi.fn()}
      createResource={vi.fn()}
      {...overrides}
    />,
    { wrapper: makeWrapper() },
  )
}

describe('PropuestaIAModal — basic render and idle state', () => {
  it('renders the dialog when open and the ImagenPicker in the idle state', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Cargar con imagen/i)).toBeInTheDocument()
    // The drop zone of the ImagenPicker is rendered
    expect(screen.getByTestId('imagen-picker-dropzone')).toBeInTheDocument()
  })

  it('does NOT render the modal when open is false', () => {
    renderModal({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('PropuestaIAModal — escape and cancel', () => {
  it('Escape closes the modal in idle state', () => {
    const onClose = vi.fn()
    renderModal({ onClose })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PropuestaIAModal — extraction flow', () => {
  it('picking a file transitions to extracting and then to proposal; Confirmar starts disabled (no supplier picked, no auto-match)', async () => {
    const onCreated = vi.fn()
    const createResource = vi.fn()
    renderModal({ onCreated, createResource })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File([new Uint8Array(100)], 'f.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [file] } })
    // Wait for the proposal state to render (idle → extracting → proposal)
    await waitFor(() => {
      expect(screen.getByText(/Revisá la propuesta/)).toBeInTheDocument()
    })
    // The monto_total input is populated with the parsed Decimal
    expect((screen.getByLabelText(/Monto total/i) as HTMLInputElement).value).toBe('1234.56')
    // The Confirmar button is rendered but disabled — the MSW handler
    // above returns zero results, so the auto-match resolves to
    // no-match and no supplier is pre-selected.
    await waitFor(() => {
      const confirmar = screen.getByRole('button', { name: /Confirmar/ })
      expect(confirmar).toBeDisabled()
    })
    // Nothing was created yet — the user hasn't confirmed.
    expect(onCreated).not.toHaveBeenCalled()
    expect(createResource).not.toHaveBeenCalled()
  })
})
