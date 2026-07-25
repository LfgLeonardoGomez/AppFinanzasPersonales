/**
 * End-to-end integration test for the unified carga-modal flow, pago
 * path (originally C-21 task 5.3; REWRITTEN for the carga-modal
 * convergence — `CargaModal` replaces the old `ModeSelector` +
 * `PropuestaIAModal` split; mirrors `PropuestaIAModal.e2e.test.tsx` for
 * the factura path).
 *
 * `PagoFormPage`'s create route (`/pagos/nuevo`) now opens `CargaModal`
 * directly. Covers:
 *   - visiting the create route renders the modal already open, on the
 *     'pago' tipo, origen step
 *   - picking a valid comprobante image (MSW returns a full
 *     `PropuestaPago`) and clicking Continuar transitions to review
 *   - the detected supplier auto-matches a normalized-exact hit (D4)
 *     and pre-selects it, enabling Confirmar without a manual search
 *   - clicking Confirmar uploads the comprobante image to Cloudinary
 *     FIRST (tipo='comprobante'), then fires exactly ONE `POST
 *     /api/pagos` with `origen: 'IA'`, `comprobante_url` = the
 *     uploaded `secure_url`, `proveedor_id` = the matched supplier,
 *     and NO `factura_id` key (RN-PAG-01), landing on the success step
 *   - clicking the success step's CTA fires the page's redirect to
 *     `/proveedores/:id` (no second form is ever shown for the IA path)
 *   - the manual origin skips extraction entirely and reaches review
 *     with empty fields, stamping `origen: 'MANUAL'` with no
 *     comprobante_url on confirm
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { PagoFormPage } from '@features/pagos/PagoFormPage'
import type { PropuestaPago } from '@shared/api/api'

const MATCHED_PROVEEDOR_ID = 'prov-match-pago-1'

const propuestaOk: PropuestaPago = {
  proveedor_nombre: 'Ferretería Sur',
  monto: 5000,
  fecha: '2026-06-20',
  metodo: 'TRANSFERENCIA',
  error: false,
  error_message: null,
}

const matchedProveedor = {
  id: MATCHED_PROVEEDOR_ID,
  usuario_id: 'user-1',
  nombre: 'Ferretería Sur',
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
  folder: 'comprobantes',
  allowed_formats: ['pdf', 'jpg', 'png'],
  max_file_size: 10485760,
}

let postPagosBody: Record<string, unknown> | null = null
let callOrder: string[] = []

function buildServer() {
  return setupServer(
    http.post('/api/pagos/extraer-ia', () => HttpResponse.json(propuestaOk, { status: 200 })),
    http.get('/api/proveedores/buscar', () => HttpResponse.json([matchedProveedor])),
    http.get('/api/cloudinary/preset-firmado', ({ request }) => {
      const url = new URL(request.url)
      // Assert the pago path requests the 'comprobante' preset tipo.
      expect(url.searchParams.get('tipo')).toBe('comprobante')
      return HttpResponse.json(cloudinaryPreset)
    }),
    http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () => {
      callOrder.push('cloudinary')
      return HttpResponse.json({ secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/p.jpg' })
    }),
    http.post('/api/pagos', async ({ request }) => {
      callOrder.push('pagos')
      postPagosBody = (await request.json()) as Record<string, unknown>
      return HttpResponse.json(
        {
          id: 'pago-new-1',
          usuario_id: 'user-1',
          proveedor_id: postPagosBody.proveedor_id as string,
          monto: postPagosBody.monto as number,
          fecha: postPagosBody.fecha as string,
          metodo: postPagosBody.metodo as string,
          comprobante_url: postPagosBody.comprobante_url as string | null,
          origen: (postPagosBody.origen as string) ?? 'MANUAL',
          created_at: '2026-06-15T00:00:00',
          updated_at: '2026-06-15T00:00:00',
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
  postPagosBody = null
  callOrder = []
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/pagos/nuevo']}>
          <Routes>
            <Route path="/pagos/nuevo" element={children} />
            <Route path="/pagos" element={<div>Pagos list</div>} />
            <Route path="/proveedores/:id" element={<div>Cuenta corriente del proveedor</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

async function openModalAndPickImage() {
  render(<PagoFormPage />, { wrapper: makeWrapper() })
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  expect(screen.getByText('Registrar pago')).toBeInTheDocument()
  const fileInput = screen.getByLabelText(/Elegir imagen para extraer datos con IA/i) as HTMLInputElement
  const file = new File([new Uint8Array(100)], 'comprobante.jpg', { type: 'image/jpeg' })
  fireEvent.change(fileInput, { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))
  await waitFor(() => {
    expect((screen.getByLabelText(/^Monto$/i) as HTMLInputElement).value).toBe('5000')
  })
}

describe('carga modal end-to-end (pago) — terminal confirm', () => {
  it('auto-matches the detected supplier, enables Confirmar, and a single Confirmar creates the pago directly (no second form, no factura_id)', async () => {
    await openModalAndPickImage()

    const confirmar = await waitFor(() => {
      const btn = screen.getByRole('button', { name: /^Confirmar$/ })
      expect(btn).not.toBeDisabled()
      return btn
    })

    fireEvent.click(confirmar)

    const cta = await waitFor(() => screen.getByRole('button', { name: /Ver cuenta corriente/ }))
    expect(screen.getByText('Pago confirmado')).toBeInTheDocument()
    fireEvent.click(cta)

    await waitFor(() => {
      expect(screen.getByText(/Cuenta corriente del proveedor/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    expect(postPagosBody).not.toBeNull()
    expect(postPagosBody).toMatchObject({
      proveedor_id: MATCHED_PROVEEDOR_ID,
      monto: 5000,
      fecha: '2026-06-20',
      metodo: 'TRANSFERENCIA',
      comprobante_url: 'https://res.cloudinary.com/test-cloud/image/upload/p.jpg',
      origen: 'IA',
    })
    expect(postPagosBody).not.toHaveProperty('factura_id')

    expect(callOrder).toEqual(['cloudinary', 'pagos'])
  })

  it('does NOT render the carga modal in edit mode', async () => {
    const editWrapper = () => {
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
      return function Wrapper({ children }: { children: ReactNode }) {
        return (
          <QueryClientProvider client={qc}>
            <MemoryRouter initialEntries={['/pagos/edit-1/editar']}>
              <Routes>
                <Route path="/pagos/:id/editar" element={children} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        )
      }
    }
    render(<PagoFormPage />, { wrapper: editWrapper() })
    await waitFor(() => {
      expect(screen.getByText(/Cargando pago|No se encontró el pago/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('carga modal end-to-end (pago) — upload failure', () => {
  it('an upload failure keeps the modal on review, shows the error, and fires NO POST /api/pagos', async () => {
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
    expect(postPagosBody).toBeNull()
  })
})

describe('carga modal end-to-end (pago) — 422 backend validation error', () => {
  it('a 422 on POST /api/pagos keeps the modal on review, shows an error, and does not close or redirect', async () => {
    server.use(
      http.post('/api/pagos', () =>
        HttpResponse.json({ detail: 'monto debe ser mayor a cero' }, { status: 422 }),
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
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Monto$/i)).toBeInTheDocument()
    expect(screen.queryByText(/Cuenta corriente del proveedor/)).not.toBeInTheDocument()
  })
})

describe('carga modal end-to-end (pago) — manual origin', () => {
  it('switching to Manual skips extraction, reaches review with empty fields, and stamps origen MANUAL with no comprobante_url', async () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([matchedProveedor])))
    render(<PagoFormPage />, { wrapper: makeWrapper() })

    fireEvent.click(screen.getByRole('button', { name: 'Manual' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }))

    await waitFor(() => {
      expect((screen.getByLabelText(/^Monto$/i) as HTMLInputElement).value).toBe('')
    })
    // No "revisá y corregí" banner for the manual origin (no image involved).
    expect(screen.queryByText(/revisá y corregí/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/^Monto$/i), { target: { value: '2500' } })
    fireEvent.change(screen.getByLabelText(/^Fecha$/i), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText(/^Método$/i), { target: { value: 'EFECTIVO' } })

    // Manual origin: proveedor_nombre is null, so there is no auto-match —
    // the user must search and pick the supplier explicitly.
    fireEvent.change(screen.getByPlaceholderText(/Buscar proveedor/i), {
      target: { value: 'Ferretería Sur' },
    })
    const option = await waitFor(() => screen.getByText('Ferretería Sur'))
    fireEvent.click(option)

    const confirmar = await waitFor(() => {
      const btn = screen.getByRole('button', { name: /^Confirmar$/ })
      expect(btn).not.toBeDisabled()
      return btn
    })
    fireEvent.click(confirmar)

    await waitFor(() => {
      expect(screen.getByText('Pago confirmado')).toBeInTheDocument()
    })
    expect(postPagosBody).toMatchObject({
      proveedor_id: MATCHED_PROVEEDOR_ID,
      monto: 2500,
      fecha: '2026-07-01',
      metodo: 'EFECTIVO',
      origen: 'MANUAL',
    })
    expect(postPagosBody).not.toHaveProperty('comprobante_url')
    expect(postPagosBody).not.toHaveProperty('factura_id')
  })
})
