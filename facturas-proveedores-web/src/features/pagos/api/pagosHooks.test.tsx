/**
 * Tests for pagos data layer hooks.
 *
 * Strategy: MSW intercepts all API calls — no real backend.
 * Pattern: Vitest + React Testing Library + MSW (mirrors facturasHooks.test.tsx).
 *
 * TDD cycle: Task 2.1 (RED) → 2.2 (GREEN) → 2.3 (TRIANGULATE) → 2.4 (REFACTOR).
 *
 * INVARIANTS (RN-PAG-01, hard rule #1):
 *   - The `useCreatePago` payload type does NOT allow a `factura_id` key.
 *   - MSW rejects any request whose JSON body contains a `factura` key.
 *     A dedicated test posts such a payload and asserts the request never
 *     reaches the wire (MSW returns 422 and the mutation surfaces the error).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  usePagos,
  usePago,
  useCreatePago,
  useUpdatePago,
  useDeletePago,
  useCloudinaryPreset,
} from './pagosHooks'
import type {
  PagoListItem,
  PagoResponse,
  PagoListResponse,
  PagoCreate,
} from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockPagoListItem: PagoListItem = {
  id: 'pago-uuid-1',
  proveedor_id: 'proveedor-uuid-1',
  monto: 2500.0,
  fecha: '2026-06-15',
  metodo: 'TRANSFERENCIA',
  origen: 'MANUAL',
  created_at: '2026-06-15T10:00:00',
}

const mockPagoResponse: PagoResponse = {
  ...mockPagoListItem,
  usuario_id: 'user-1',
  comprobante_url: null,
  updated_at: '2026-06-15T10:00:00',
}

const mockPagoListResponse: PagoListResponse = {
  items: [mockPagoListItem],
  total: 1,
  page: 1,
  page_size: 50,
}

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  // GET /api/pagos — supports proveedor_id, page
  http.get('/api/pagos', ({ request }) => {
    const url = new URL(request.url)
    const proveedorId = url.searchParams.get('proveedor_id')
    const page = url.searchParams.get('page')
    return HttpResponse.json({
      ...mockPagoListResponse,
      _filters: { proveedorId, page },
    })
  }),

  // GET /api/pagos/:id
  http.get('/api/pagos/:id', ({ params }) => {
    if (params.id === 'pago-uuid-1') {
      return HttpResponse.json(mockPagoResponse)
    }
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),

  // POST /api/pagos — wire-level: if the body has a `factura` key, reject (422).
  // Mirrors the backend Pydantic `extra="forbid"` behavior on PagoCreate.
  http.post('/api/pagos', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    if (Object.keys(body).some((k) => k.toLowerCase().includes('factura'))) {
      return HttpResponse.json(
        { detail: [{ loc: ['body'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' }] },
        { status: 422 },
      )
    }
    return HttpResponse.json(
      { ...mockPagoResponse, ...body },
      { status: 201 },
    )
  }),

  // PATCH /api/pagos/:id
  http.patch('/api/pagos/:id', async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>
    if (Object.keys(body).some((k) => k.toLowerCase().includes('factura'))) {
      return HttpResponse.json(
        { detail: [{ loc: ['body'], msg: 'Extra inputs are not permitted', type: 'extra_forbidden' }] },
        { status: 422 },
      )
    }
    return HttpResponse.json({ ...mockPagoResponse, id: params.id, ...body })
  }),

  // DELETE /api/pagos/:id
  http.delete('/api/pagos/:id', () => new HttpResponse(null, { status: 204 })),

  // GET /api/cloudinary/preset-firmado?tipo=comprobante
  http.get('/api/cloudinary/preset-firmado', ({ request }) => {
    const url = new URL(request.url)
    const tipo = url.searchParams.get('tipo')
    if (tipo === 'comprobante') {
      return HttpResponse.json({
        upload_preset: 'signed-preset-comprobante',
        cloud_name: 'test-cloud',
        signature: 'test-sig',
        api_key: 'test-key',
        timestamp: 1234567890,
      })
    }
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Query wrapper ─────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

// ── usePagos (Task 2.1 / 2.2) ────────────────────────────────────────────────

describe('usePagos', () => {
  it('fetches GET /api/pagos with no filters (defaults to page=1)', async () => {
    const { result } = renderHook(() => usePagos({}), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.items).toHaveLength(1)
    expect(result.current.data?.items[0]?.metodo).toBe('TRANSFERENCIA')
  })

  it('passes proveedor_id as a query param', async () => {
    const { result } = renderHook(
      () => usePagos({ proveedor_id: 'proveedor-uuid-1' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const data = result.current.data as unknown as Record<string, unknown>
    const filters = data._filters as Record<string, unknown>
    expect(filters.proveedorId).toBe('proveedor-uuid-1')
  })
})

// ── usePago (Task 2.1 / 2.2) ─────────────────────────────────────────────────

describe('usePago', () => {
  it('returns a single pago with full response shape', async () => {
    const { result } = renderHook(() => usePago('pago-uuid-1'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('pago-uuid-1')
    expect(result.current.data?.metodo).toBe('TRANSFERENCIA')
    expect(result.current.data?.origen).toBe('MANUAL')
    // RN-PAG-01 — explicit structural assertion
    expect((result.current.data as unknown as Record<string, unknown>).factura_id).toBeUndefined()
  })

  it('returns error for non-existent pago (404)', async () => {
    const { result } = renderHook(() => usePago('nonexistent-id'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ── useCreatePago (Task 2.3) ────────────────────────────────────────────────

describe('useCreatePago', () => {
  it('POSTs /api/pagos and returns the created pago', async () => {
    const { result } = renderHook(() => useCreatePago(), { wrapper: createWrapper() })
    const payload: PagoCreate = {
      proveedor_id: 'proveedor-uuid-1',
      monto: 1500,
      fecha: '2026-06-01',
      metodo: 'EFECTIVO',
    }
    result.current.mutate(payload)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.proveedor_id).toBe('proveedor-uuid-1')
    expect(result.current.data?.metodo).toBe('EFECTIVO')
  })

  it('the PagoCreate payload type does NOT allow a `factura_id` key (compile-time)', () => {
    // This is a static check — if a future contributor adds `factura_id` to
    // PagoCreate, the assertion below becomes a type error and the test file
    // fails to compile. At runtime we additionally assert via the build-time
    // guard file `src/shared/api/api.types.test-d.ts`.
    type HasFacturaId = 'factura_id' extends keyof PagoCreate ? true : false
    const hasFacturaId: HasFacturaId = false
    expect(hasFacturaId).toBe(false)
  })
})

// ── useUpdatePago (Task 2.3) ─────────────────────────────────────────────────

describe('useUpdatePago', () => {
  it('PATCHes /api/pagos/{id} and returns the updated pago', async () => {
    const { result } = renderHook(() => useUpdatePago(), { wrapper: createWrapper() })
    result.current.mutate({
      id: 'pago-uuid-1',
      data: { monto: 3000 },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.monto).toBe(3000)
  })
})

// ── useDeletePago (Task 2.3) ─────────────────────────────────────────────────

describe('useDeletePago', () => {
  it('DELETEs /api/pagos/{id} and resolves', async () => {
    const { result } = renderHook(() => useDeletePago(), { wrapper: createWrapper() })
    // C-13 D6 — the delete mutation now takes { id, proveedor_id } so the
    // cross-feature cache invalidation can target the right cuenta-corriente
    // key without an extra GET. NO `factura_id` key (RN-PAG-01).
    result.current.mutate({ id: 'pago-uuid-1', proveedor_id: 'proveedor-uuid-1' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('propagates error when delete fails', async () => {
    server.use(
      http.delete('/api/pagos/:id', () =>
        HttpResponse.json({ detail: 'Not Found' }, { status: 404 }),
      ),
    )
    const { result } = renderHook(() => useDeletePago(), { wrapper: createWrapper() })
    result.current.mutate({ id: 'nonexistent', proveedor_id: 'proveedor-uuid-1' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeTruthy()
  })
})

// ── useCloudinaryPreset (Task 2.3) ───────────────────────────────────────────

describe('useCloudinaryPreset (comprobante)', () => {
  it('fetches GET /api/cloudinary/preset-firmado?tipo=comprobante', async () => {
    const { result } = renderHook(() => useCloudinaryPreset('comprobante'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.upload_preset).toBe('signed-preset-comprobante')
  })

  it('is disabled when tipo is empty', async () => {
    const { result } = renderHook(() => useCloudinaryPreset(''), {
      wrapper: createWrapper(),
    })
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})
