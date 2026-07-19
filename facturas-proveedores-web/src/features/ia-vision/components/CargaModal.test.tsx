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
