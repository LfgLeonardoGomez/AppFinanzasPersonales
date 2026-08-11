/**
 * Tests for facturas data layer hooks.
 *
 * Strategy: MSW intercepts all API calls — no real backend.
 * Pattern: Vitest + React Testing Library + MSW (mirrors proveedoresHooks.test.tsx).
 *
 * TDD cycle: Tasks 2.1 (RED) → 2.2 (GREEN) → 2.3 (TRIANGULATE) → 2.4/2.5 (REFACTOR).
 * estado is NEVER computed here — it comes from the API response (RN-FAC-09).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  useFacturas,
  useFactura,
  useCreateFactura,
  useUpdateFactura,
  useDeleteFactura,
  useCloudinaryPreset,
} from './facturasHooks'
import type {
  FacturaResponse,
  FacturaListItem,
} from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockFacturaListItem: FacturaListItem = {
  id: 'factura-uuid-1',
  proveedor_id: 'proveedor-uuid-1',
  numero: 'FAC-001',
  fecha_emision: '2026-06-01',
  monto_total: 1500.0,
  estado: 'PENDIENTE',
}

const mockFacturaResponse: FacturaResponse = {
  ...mockFacturaListItem,
  // c-26: the LEAN list row does not carry these — the full response does.
  negocio_id: 'user-1',
  fecha_vencimiento: null,
  archivo_url: null,
  origen: 'MANUAL',
  created_at: '2026-06-01T10:00:00',
  updated_at: '2026-06-01T10:00:00',
  items: [],
  items_sum_mismatch: false,
}

const mockListResponse: FacturaListItem[] = [mockFacturaListItem]

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  // GET /api/facturas — supports proveedor_id, estado, fecha_desde, fecha_hasta
  http.get('/api/facturas', ({ request }) => {
    const url = new URL(request.url)
    const proveedorId = url.searchParams.get('proveedor_id')
    const estado = url.searchParams.get('estado')
    const fechaDesde = url.searchParams.get('fecha_desde')
    const fechaHasta = url.searchParams.get('fecha_hasta')

    // Return a response that echoes back the filter params so tests can assert them
    return HttpResponse.json([
      { ...mockFacturaListItem, _filters: { proveedorId, estado, fechaDesde, fechaHasta } },
    ])
  }),

  // GET /api/facturas/:id
  http.get('/api/facturas/:id', ({ params }) => {
    if (params.id === 'factura-uuid-1') {
      return HttpResponse.json(mockFacturaResponse)
    }
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),

  // POST /api/facturas
  http.post('/api/facturas', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json(
      { ...mockFacturaResponse, proveedor_id: body.proveedor_id as string },
      { status: 201 },
    )
  }),

  // PATCH /api/facturas/:id
  http.patch('/api/facturas/:id', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({ ...mockFacturaResponse, ...body })
  }),

  // DELETE /api/facturas/:id
  http.delete('/api/facturas/:id', () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // GET /api/cloudinary/preset-firmado?tipo=factura
  http.get('/api/cloudinary/preset-firmado', ({ request }) => {
    const url = new URL(request.url)
    const tipo = url.searchParams.get('tipo')
    if (tipo === 'factura') {
      return HttpResponse.json({
        cloud_name: 'test-cloud',
        signature: 'test-sig',
        api_key: 'test-key',
        timestamp: 1234567890,
        folder: 'facturas',
        allowed_formats: ['pdf', 'jpg', 'png'],
        max_file_size: 10485760,
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

// ── useFacturas (Task 2.1 — RED, Task 2.2 — GREEN) ────────────────────────────

describe('useFacturas', () => {
  it('fetches GET /api/facturas with no filters', async () => {
    const { result } = renderHook(() => useFacturas({}), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const items = result.current.data ?? []
    expect(items).toHaveLength(1)
    expect(items[0]?.estado).toBe('PENDIENTE')
  })

  it('passes proveedor_id as a query param', async () => {
    let capturedUrl = ''
    server.use(
      http.get('/api/facturas', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(mockListResponse)
      }),
    )
    const { result } = renderHook(
      () => useFacturas({ proveedor_id: 'proveedor-uuid-1' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl).toContain('proveedor_id=proveedor-uuid-1')
  })

  it('passes estado as a query param', async () => {
    let capturedUrl = ''
    server.use(
      http.get('/api/facturas', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(mockListResponse)
      }),
    )
    const { result } = renderHook(
      () => useFacturas({ estado: 'PAGADA' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl).toContain('estado=PAGADA')
  })

  it('passes fecha_desde and fecha_hasta as query params', async () => {
    let capturedUrl = ''
    server.use(
      http.get('/api/facturas', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(mockListResponse)
      }),
    )
    const { result } = renderHook(
      () => useFacturas({ fecha_desde: '2026-01-01', fecha_hasta: '2026-12-31' }),
      { wrapper: createWrapper() },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl).toContain('fecha_desde=2026-01-01')
    expect(capturedUrl).toContain('fecha_hasta=2026-12-31')
  })
})

// ── useFactura (Task 2.3 — TRIANGULATE) ──────────────────────────────────────

describe('useFactura', () => {
  it('returns a single factura with estado and items', async () => {
    const { result } = renderHook(() => useFactura('factura-uuid-1'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('factura-uuid-1')
    expect(result.current.data?.estado).toBe('PENDIENTE')
    expect(result.current.data?.items_sum_mismatch).toBe(false)
  })

  it('returns error for non-existent factura (404)', async () => {
    const { result } = renderHook(() => useFactura('nonexistent-id'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ── useCreateFactura (Task 2.3 — TRIANGULATE) ─────────────────────────────────

describe('useCreateFactura', () => {
  it('POSTs /api/facturas and returns the created factura', async () => {
    const { result } = renderHook(() => useCreateFactura(), { wrapper: createWrapper() })
    result.current.mutate({
      proveedor_id: 'proveedor-uuid-1',
      fecha_emision: '2026-06-01',
      monto_total: 1500.0,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.proveedor_id).toBe('proveedor-uuid-1')
    expect(result.current.data?.estado).toBe('PENDIENTE')
  })
})

// ── useUpdateFactura (Task 2.3 — TRIANGULATE) ─────────────────────────────────

describe('useUpdateFactura', () => {
  it('PATCHes /api/facturas/{id} and returns the updated factura', async () => {
    const { result } = renderHook(() => useUpdateFactura(), { wrapper: createWrapper() })
    result.current.mutate({ id: 'factura-uuid-1', data: { monto_total: 2000 } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.monto_total).toBe(2000)
  })
})

// ── useDeleteFactura (Task 2.3 — TRIANGULATE) ─────────────────────────────────

describe('useDeleteFactura', () => {
  it('DELETEs /api/facturas/{id} and resolves', async () => {
    const { result } = renderHook(() => useDeleteFactura(), { wrapper: createWrapper() })
    // C-13 D6 — the delete mutation now takes { id, proveedor_id } so the
    // cross-feature cache invalidation can target the right cuenta-corriente
    // key without an extra GET.
    result.current.mutate({ id: 'factura-uuid-1', proveedor_id: 'proveedor-uuid-1' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('propagates error when delete fails', async () => {
    server.use(
      http.delete('/api/facturas/:id', () =>
        HttpResponse.json({ detail: 'Not Found' }, { status: 404 }),
      ),
    )
    const { result } = renderHook(() => useDeleteFactura(), { wrapper: createWrapper() })
    result.current.mutate({ id: 'nonexistent', proveedor_id: 'proveedor-uuid-1' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeTruthy()
  })
})

// ── useCloudinaryPreset (Task 2.4 — TRIANGULATE) ─────────────────────────────

describe('useCloudinaryPreset', () => {
  it('fetches GET /api/cloudinary/preset-firmado?tipo=factura', async () => {
    const { result } = renderHook(() => useCloudinaryPreset('factura'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.folder).toBe('facturas')
    expect(result.current.data?.cloud_name).toBe('test-cloud')
  })

  it('is disabled when tipo is empty', async () => {
    const { result } = renderHook(() => useCloudinaryPreset(''), {
      wrapper: createWrapper(),
    })
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})
