/**
 * End-to-end integration test for the unified carga-modal flow, factura
 * path (originally C-15 section 9 / C-21 task 3.2; REWRITTEN for the
 * carga-modal convergence — `CargaModal` replaces the old
 * `ModeSelector` + `PropuestaIAModal` split).
 *
 * `FacturaFormPage`'s create route (`/facturas/nueva`) now opens
 * `CargaModal` directly — there is no more mode-selector screen. This
 * suite covers the contract that:
 *   - visiting the create route renders the modal already open, on the
 *     'factura' tipo, origen step
 *   - picking a valid image (MSW returns a full `PropuestaFactura`) and
 *     clicking Continuar transitions through processing to review
 *   - the detected supplier auto-matches a normalized-exact hit (D4)
 *     and pre-selects it, enabling Confirmar without a manual search
 *   - clicking Confirmar uploads the image to Cloudinary FIRST, then
 *     fires exactly ONE `POST /api/facturas` with `origen: 'IA'` and
 *     `archivo_url` set to the uploaded `secure_url`, landing on the
 *     success step
 *   - clicking the success step's CTA fires the page's redirect to
 *     `/proveedores/:id` (no second form is ever shown for the IA path)
 *   - an upload failure keeps the modal on review, shows the error, and
 *     fires NO create
 *   - a 422 from the create keeps the modal on review, shows the
 *     error, and does not close or redirect
 *   - closing the modal (Escape) navigates back to the list, firing no
 *     request
 *   - a 429 shows the countdown in the origen step's error banner
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

const server = buildServer()

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
  // The create route opens the unified carga modal directly — no
  // mode-selector screen.
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText('Cargar factura')).toBeInTheDocument()
  const fileInput = screen.getByLabelText(/Elegir imagen para extraer datos con IA/i) as HTMLInputElement
  const file = new File([new Uint8Array(100)], 'factura.jpg', { type: 'image/jpeg' })
  fireEvent.change(fileInput, { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  await waitFor(() => {
    expect((screen.getByLabelText(/Monto total/i) as HTMLInputElement).value).toBe('1234.56')
  })
}

describe('carga modal end-to-end (factura) — terminal confirm', () => {
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

    // Confirmar lands on the success step first (the modal's explicit
    // "success" state) — the user then clicks the CTA to continue.
    const cta = await waitFor(() => screen.getByRole('button', { name: /Ver cuenta corriente/ }))
    expect(screen.getByText('Factura confirmada')).toBeInTheDocument()
    fireEvent.click(cta)

    // The page redirects to the supplier's cuenta corriente — the
    // manual FacturaForm is never rendered for the create path.
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

  it('does NOT render the carga modal in edit mode', async () => {
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
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('carga modal end-to-end (factura) — upload failure', () => {
  it('an upload failure keeps the modal on review, shows the error, and fires NO POST /api/facturas', async () => {
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

describe('carga modal end-to-end (factura) — 422 backend validation error', () => {
  it('a 422 on POST /api/facturas keeps the modal on review, shows an error, and does not close or redirect', async () => {
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
    // Still on review — the dialog remains open, no redirect happened.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/Monto total/i)).toBeInTheDocument()
    expect(screen.queryByText(/Cuenta corriente del proveedor/)).not.toBeInTheDocument()
  })
})

describe('carga modal end-to-end (factura) — cancel flow', () => {
  it('picking an image, then closing the modal (Escape) navigates back to the list and fires no request', async () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    await openModalAndPickImage()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Facturas list')).toBeInTheDocument()
    expect(postFacturasBody).toBeNull()
  })
})

describe('carga modal end-to-end (factura) — 429 rate limit', () => {
  it('a 429 response shows the countdown in the origen-step error banner and Escape closes with no POST', async () => {
    server.use(
      http.post('/api/facturas/extraer-ia', () =>
        HttpResponse.json(
          { detail: 'Too many requests' },
          { status: 429, headers: { 'Retry-After': '600' } },
        ),
      ),
    )

    render(<FacturaFormPage />, { wrapper: makeWrapper() })

    const fileInput = screen.getByLabelText(/Elegir imagen para extraer datos con IA/i) as HTMLInputElement
    fireEvent.change(fileInput, {
      target: { files: [new File([new Uint8Array(100)], 'f.jpg', { type: 'image/jpeg' })] },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

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

    // Escape closes the modal (back to the list).
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })
})
