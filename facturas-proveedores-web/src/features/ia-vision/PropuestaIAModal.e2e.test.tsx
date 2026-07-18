/**
 * End-to-end integration test for the IA vision flow (C-15, section 9;
 * REWRITTEN for C-21 — the modal is now TERMINAL, task 3.2).
 *
 * C-21 (D1) SUPERSEDES the C-15 decision that "the modal does not POST;
 * the form creates on its own Confirmar" (D-19 / RN-IA-04-frontend).
 * RN-IA-04 itself is UNCHANGED: it governs the `/extraer-ia` EXTRACTION
 * endpoint, which still never persists. What changed is that the human
 * confirm — inside the modal — now creates the resource directly.
 *
 * This suite covers the contract that:
 *   - opening the IA modal from the create-mode `FacturaFormPage`
 *   - picking a valid image (MSW returns a full `PropuestaFactura`)
 *   - the modal transitions to `proposal`
 *   - the detected supplier auto-matches a normalized-exact hit (D4)
 *     and pre-selects it, enabling Confirmar without a manual search
 *   - clicking Confirmar uploads the image to Cloudinary FIRST, then
 *     fires exactly ONE `POST /api/facturas` with `origen: 'IA'` and
 *     `archivo_url` set to the uploaded `secure_url`
 *   - the modal closes and the page redirects to `/proveedores/:id`
 *     (no second form is ever shown for the IA path)
 *   - an upload failure keeps the modal open and fires NO create
 *   - a 422 from the create keeps the modal open, shows the error, and
 *     does not close or redirect
 *
 * The cancel and 429 flows (no persistence occurs) are also covered.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { FacturaFormPage } from '@features/facturas/FacturaFormPage'
import type { PropuestaFactura } from '@shared/api/api'

const MATCHED_PROVEEDOR_ID = 'prov-match-1'

const propuestaOk: PropuestaFactura = {
  proveedor_nombre: 'Acme SA',
  numero: '0001-00012345',
  fecha_emision: '2026-06-15',
  monto_total: 1234.56,
  error: false,
  error_message: null,
}

const matchedProveedor = {
  id: MATCHED_PROVEEDOR_ID,
  usuario_id: 'user-1',
  nombre: 'Acme SA',
  cuit: null,
  telefono: null,
  categoria: 'OTRO' as const,
  notas: null,
  saldo: 0,
  created_at: '2026-06-15T00:00:00',
  updated_at: '2026-06-15T00:00:00',
}

const cloudinaryPreset = {
  cloud_name: 'test-cloud',
  signature: 'test-sig',
  api_key: 'test-key',
  timestamp: 1234567890,
  folder: 'facturas',
  allowed_formats: ['pdf', 'jpg', 'png'],
  max_file_size: 10485760,
}

let postFacturasBody: Record<string, unknown> | null = null
let callOrder: string[] = []

function buildServer() {
  return setupServer(
    http.post('/api/facturas/extraer-ia', () => HttpResponse.json(propuestaOk, { status: 200 })),
    http.get('/api/proveedores/buscar', () => HttpResponse.json([matchedProveedor])),
    http.get('/api/cloudinary/preset-firmado', () => HttpResponse.json(cloudinaryPreset)),
    http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () => {
      callOrder.push('cloudinary')
      return HttpResponse.json({ secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/f.jpg' })
    }),
    http.post('/api/facturas', async ({ request }) => {
      callOrder.push('facturas')
      postFacturasBody = (await request.json()) as Record<string, unknown>
      return HttpResponse.json(
        {
          id: 'factura-new-1',
          usuario_id: 'user-1',
          proveedor_id: postFacturasBody.proveedor_id as string,
          numero: postFacturasBody.numero as string | null,
          fecha_emision: postFacturasBody.fecha_emision as string,
          fecha_vencimiento: null,
          monto_total: postFacturasBody.monto_total as number,
          archivo_url: postFacturasBody.archivo_url as string | null,
          origen: (postFacturasBody.origen as string) ?? 'MANUAL',
          estado: 'PENDIENTE',
          created_at: '2026-06-15T00:00:00',
          updated_at: '2026-06-15T00:00:00',
          items: [],
          items_sum_mismatch: false,
        },
        { status: 201 },
      )
    }),
  )
}

let server = buildServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  postFacturasBody = null
  callOrder = []
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/facturas/nueva']}>
          <Routes>
            <Route path="/facturas/nueva" element={children} />
            <Route path="/facturas" element={<div>Facturas list</div>} />
            <Route path="/proveedores/:id" element={<div>Cuenta corriente del proveedor</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

async function openModalAndPickImage() {
  render(<FacturaFormPage />, { wrapper: makeWrapper() })
  fireEvent.click(screen.getByText(/Cargar con foto/i))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  const fileInput = screen.getByLabelText(/Elegir imagen para extraer datos con IA/i) as HTMLInputElement
  const file = new File([new Uint8Array(100)], 'factura.jpg', { type: 'image/jpeg' })
  fireEvent.change(fileInput, { target: { files: [file] } })
  await waitFor(() => {
    expect(screen.getByText(/Revisá la propuesta/)).toBeInTheDocument()
  })
}

describe('IA vision end-to-end — terminal confirm (C-21, task 3.2)', () => {
  it('auto-matches the detected supplier, enables Confirmar, and a single Confirmar creates the factura directly (no second form)', async () => {
    await openModalAndPickImage()

    // The auto-match (D4) resolves against the "Acme SA" supplier
    // returned by /api/proveedores/buscar — Confirmar enables without
    // any manual search interaction.
    const confirmar = await waitFor(() => {
      const btn = screen.getByRole('button', { name: /^Confirmar$/ })
      expect(btn).not.toBeDisabled()
      return btn
    })

    fireEvent.click(confirmar)

    // The modal closes and the page redirects to the supplier's
    // cuenta corriente — the manual FacturaForm is never rendered.
    await waitFor(() => {
      expect(screen.getByText(/Cuenta corriente del proveedor/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Exactly one POST /api/facturas fired, with origen 'IA' and the
    // uploaded secure_url as archivo_url — proof the upload happened
    // BEFORE the create (the URL could only come from the upload).
    expect(postFacturasBody).not.toBeNull()
    expect(postFacturasBody).toMatchObject({
      proveedor_id: MATCHED_PROVEEDOR_ID,
      fecha_emision: '2026-06-15',
      monto_total: 1234.56,
      numero: '0001-00012345',
      archivo_url: 'https://res.cloudinary.com/test-cloud/image/upload/f.jpg',
      origen: 'IA',
    })

    // The Cloudinary upload happened before the factura POST.
    expect(callOrder).toEqual(['cloudinary', 'facturas'])
  })

  it('does NOT render the IA selector in edit mode', async () => {
    const editWrapper = () => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
      return function Wrapper({ children }: { children: ReactNode }) {
        return (
          <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={['/facturas/edit-1/editar']}>
              <Routes>
                <Route path="/facturas/:id/editar" element={children} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        )
      }
    }
    render(<FacturaFormPage />, { wrapper: editWrapper() })
    await waitFor(() => {
      expect(screen.getByText(/Cargando factura|No se encontró la factura/)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Cargar con foto/i)).not.toBeInTheDocument()
  })
})

describe('IA vision end-to-end — upload failure (C-21, task 3.3)', () => {
  it('an upload failure keeps the modal open, shows the error, and fires NO POST /api/facturas', async () => {
    server.use(
      http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () =>
        HttpResponse.json({ error: { message: 'Firma inválida' } }, { status: 401 }),
      ),
    )

    await openModalAndPickImage()
    const confirmar = await waitFor(() => {
      const btn = screen.getByRole('button', { name: /^Confirmar$/ })
      expect(btn).not.toBeDisabled()
      return btn
    })

    fireEvent.click(confirmar)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Firma inválida')
    })
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(postFacturasBody).toBeNull()
  })
})

describe('IA vision end-to-end — 422 backend validation error (C-21, task 3.5)', () => {
  it('a 422 on POST /api/facturas keeps the modal open, shows an error, and does not close or redirect', async () => {
    server.use(
      http.post('/api/facturas', () =>
        HttpResponse.json({ detail: 'monto_total debe ser mayor a cero' }, { status: 422 }),
      ),
    )

    await openModalAndPickImage()
    const confirmar = await waitFor(() => {
      const btn = screen.getByRole('button', { name: /^Confirmar$/ })
      expect(btn).not.toBeDisabled()
      return btn
    })

    fireEvent.click(confirmar)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    // Still on the proposal — the dialog remains open, no redirect happened.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Revisá la propuesta/)).toBeInTheDocument()
    expect(screen.queryByText(/Cuenta corriente del proveedor/)).not.toBeInTheDocument()
  })
})

describe('IA vision end-to-end — cancel flow (C-15, section 9.4)', () => {
  it('opening the modal, picking an image, then canceling leaves the form empty and no request fires', async () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    await openModalAndPickImage()

    // Click the modal's "Cancelar" — the modal closes, returns to selector, no POST fires
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancelar$/ }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    // Back at the selector (not the form)
    expect(screen.getByText(/Cargar con foto/i)).toBeInTheDocument()
    expect(screen.getByText(/Cargar manual/i)).toBeInTheDocument()

    // No POST has fired (the cancel aborted the flow before any
    // submission).
    expect(postFacturasBody).toBeNull()
  })
})

describe('IA vision end-to-end — 429 rate limit (C-15, section 9.5)', () => {
  it('a 429 response shows the countdown and Cancelar closes the modal without firing a POST', async () => {
    // Override the extraer-ia handler for this test only
    server.use(
      http.post('/api/facturas/extraer-ia', () =>
        HttpResponse.json(
          { detail: 'Too many requests' },
          { status: 429, headers: { 'Retry-After': '600' } },
        ),
      ),
    )

    render(<FacturaFormPage />, { wrapper: makeWrapper() })

    fireEvent.click(screen.getByText(/Cargar con foto/i))
    const fileInput = screen.getByLabelText(/Elegir imagen para extraer datos con IA/i) as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array(100)], 'f.jpg', { type: 'image/jpeg' })] },
    })

    // The 429 state shows the rate-limit message (the body, scoped
    // to the dialog — the title also says "Demasiadas solicitudes")
    const dialog = screen.getByRole('dialog')
    await waitFor(() => {
      expect(within(dialog).getByText(/Has alcanzado el límite de extracciones con IA/)).toBeInTheDocument()
    })
    // The countdown is shown (initial value derived from Retry-After: 600s
    // → "10 minutos")
    expect(within(dialog).getByText(/Podés reintentar en/)).toBeInTheDocument()

    // No POST has fired (the 429 is a real answer, not a network error
    // to retry)
    expect(postFacturasBody).toBeNull()

    // Cancelar closes the modal
    fireEvent.click(within(dialog).getByRole('button', { name: /^Cancelar$/ }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
