/**
 * End-to-end integration test for the IA vision PAGO flow (C-21, task 5.3;
 * mirrors `PropuestaIAModal.e2e.test.tsx` for the factura path).
 *
 * C-21 (D1) SUPERSEDES the C-15 decision that "the modal does not POST;
 * the form creates on its own Confirmar" (D-19 / RN-IA-04-frontend). This
 * pago-path suite is the equivalent inversion of the C-15 "modal does NOT
 * POST" regression test: it now asserts the modal's single "Confirmar"
 * DOES POST exactly once, with `origen: 'IA'`.
 *
 * Covers:
 *   - opening the IA modal from the create-mode `PagoFormPage`
 *   - picking a valid comprobante image (MSW returns a full `PropuestaPago`)
 *   - the detected supplier auto-matches a normalized-exact hit (D4) and
 *     pre-selects it, enabling Confirmar without a manual search
 *   - clicking Confirmar uploads the comprobante image to Cloudinary
 *     FIRST (tipo='comprobante'), then fires exactly ONE `POST /api/pagos`
 *     with `origen: 'IA'`, `comprobante_url` = the uploaded `secure_url`,
 *     `proveedor_id` = the matched supplier, and NO `factura_id` key
 *     (RN-PAG-01 — a pago is never linked to a factura)
 *   - the modal closes and the page redirects to `/proveedores/:id`
 *     (no second form is ever shown for the IA path)
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

let server = buildServer()

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
  fireEvent.click(screen.getByText(/Cargar con foto/i))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  const fileInput = screen.getByLabelText(/Elegir imagen para extraer datos con IA/i) as HTMLInputElement
  const file = new File([new Uint8Array(100)], 'comprobante.jpg', { type: 'image/jpeg' })
  fireEvent.change(fileInput, { target: { files: [file] } })
  await waitFor(() => {
    expect(screen.getByText(/Revisá la propuesta/)).toBeInTheDocument()
  })
}

describe('IA vision end-to-end (pago) — terminal confirm (C-21, task 5.3)', () => {
  it('auto-matches the detected supplier, enables Confirmar, and a single Confirmar creates the pago directly (no second form, no factura_id)', async () => {
    await openModalAndPickImage()

    // The auto-match (D4) resolves against the "Ferretería Sur" supplier
    // returned by /api/proveedores/buscar — Confirmar enables without any
    // manual search interaction. (D4 wired into PropuestaPagoFields —
    // the pago modal previously had NO supplier control at all.)
    const confirmar = await waitFor(() => {
      const btn = screen.getByRole('button', { name: /^Confirmar$/ })
      expect(btn).not.toBeDisabled()
      return btn
    })

    fireEvent.click(confirmar)

    // The modal closes and the page redirects to the supplier's cuenta
    // corriente — the manual PagoForm is never rendered for the IA path.
    await waitFor(() => {
      expect(screen.getByText(/Cuenta corriente del proveedor/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Exactly one POST /api/pagos fired, with origen 'IA', comprobante_url
    // set to the uploaded secure_url, the matched proveedor_id, and NO
    // factura_id key (RN-PAG-01 — a pago never links to a factura).
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

    // The Cloudinary upload happened before the pago POST.
    expect(callOrder).toEqual(['cloudinary', 'pagos'])
  })

  it('does NOT render the IA selector in edit mode', async () => {
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
    expect(screen.queryByText(/Cargar con foto/i)).not.toBeInTheDocument()
  })
})

describe('IA vision end-to-end (pago) — upload failure (C-21, task 5.4/5.5)', () => {
  it('an upload failure keeps the modal open, shows the error, and fires NO POST /api/pagos', async () => {
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

describe('IA vision end-to-end (pago) — 422 backend validation error (C-21, task 5.3)', () => {
  it('a 422 on POST /api/pagos keeps the modal open, shows an error, and does not close or redirect', async () => {
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
    expect(screen.getByText(/Revisá la propuesta/)).toBeInTheDocument()
    expect(screen.queryByText(/Cuenta corriente del proveedor/)).not.toBeInTheDocument()
  })
})
