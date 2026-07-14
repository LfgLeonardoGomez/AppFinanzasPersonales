/**
 * Tests for proveedores data layer hooks.
 *
 * Strategy: MSW intercepts all API calls — no real backend.
 * Pattern: Vitest + React Testing Library + MSW (same as C-04 auth tests).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  useProveedores,
  useProveedor,
  useCreateProveedor,
  useUpdateProveedor,
  useDeleteProveedor,
  useBuscarProveedores,
} from './proveedoresHooks'
import type {
  Proveedor,
  ProveedorListItem,
  ProveedorDeleteResponse,
} from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockProveedor: Proveedor = {
  id: 'uuid-1',
  usuario_id: 'user-1',
  nombre: 'Proveedor Test SA',
  cuit: '20-12345678-9',
  telefono: null,
  categoria: 'SERVICIO',
  notas: null,
  saldo: 1500.5,
  created_at: '2026-06-21T10:00:00',
  updated_at: '2026-06-21T10:00:00',
}

const mockListResponse: ProveedorListItem[] = [mockProveedor]

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/proveedores', ({ request }) => {
    const url = new URL(request.url)
    const page = url.searchParams.get('page')
    if (page === '2') {
      return HttpResponse.json([])
    }
    return HttpResponse.json(mockListResponse)
  }),

  http.get('/api/proveedores/buscar', ({ request }) => {
    const url = new URL(request.url)
    const nombre = url.searchParams.get('nombre') ?? ''
    if (!nombre || nombre.length < 2) {
      return HttpResponse.json([])
    }
    return HttpResponse.json([mockProveedor])
  }),

  http.get('/api/proveedores/:id', ({ params }) => {
    if (params.id === 'uuid-1') {
      return HttpResponse.json(mockProveedor)
    }
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),

  http.post('/api/proveedores', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json(
      { ...mockProveedor, nombre: body.nombre as string },
      { status: 201 },
    )
  }),

  http.patch('/api/proveedores/:id', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({ ...mockProveedor, ...body })
  }),

  http.delete('/api/proveedores/:id', ({ params }) => {
    const deleteResponse: ProveedorDeleteResponse = {
      id: params.id as string,
      tiene_dependencias: false,
    }
    return HttpResponse.json(deleteResponse)
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useProveedores', () => {
  it('returns list with saldo per item', async () => {
    const { result } = renderHook(() => useProveedores(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const items = result.current.data ?? []
    expect(items).toHaveLength(1)
    expect(items[0]?.nombre).toBe('Proveedor Test SA')
    expect(items[0]?.saldo).toBe(1500.5)
  })

  it('passes order_by=saldo to the API', async () => {
    let capturedUrl = ''
    server.use(
      http.get('/api/proveedores', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json(mockListResponse)
      }),
    )
    const { result } = renderHook(() => useProveedores({ orderBy: 'saldo' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl).toContain('order_by=saldo')
  })

  it('passes page=2 to the API', async () => {
    let capturedUrl = ''
    server.use(
      http.get('/api/proveedores', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json([])
      }),
    )
    const { result } = renderHook(() => useProveedores({ page: 2 }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(capturedUrl).toContain('page=2')
  })
})

describe('useProveedor', () => {
  it('returns a single supplier with saldo', async () => {
    const { result } = renderHook(() => useProveedor('uuid-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.id).toBe('uuid-1')
    expect(result.current.data?.saldo).toBe(1500.5)
  })

  it('returns error for non-existent supplier (404)', async () => {
    const { result } = renderHook(() => useProveedor('nonexistent'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useCreateProveedor', () => {
  it('fires POST /api/proveedores and returns the created supplier', async () => {
    const { result } = renderHook(() => useCreateProveedor(), { wrapper: createWrapper() })
    result.current.mutate({ nombre: 'Nuevo Proveedor' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.nombre).toBe('Nuevo Proveedor')
  })
})

describe('useUpdateProveedor', () => {
  it('fires PATCH /api/proveedores/{id} with the update payload', async () => {
    const { result } = renderHook(() => useUpdateProveedor(), { wrapper: createWrapper() })
    result.current.mutate({ id: 'uuid-1', data: { nombre: 'Nombre Actualizado' } })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.nombre).toBe('Nombre Actualizado')
  })
})

describe('useDeleteProveedor', () => {
  it('fires DELETE /api/proveedores/{id} and returns tiene_dependencias', async () => {
    const { result } = renderHook(() => useDeleteProveedor(), { wrapper: createWrapper() })
    result.current.mutate('uuid-1')
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.tiene_dependencias).toBe(false)
  })

  it('handles 404 gracefully when supplier does not exist', async () => {
    server.use(
      http.delete('/api/proveedores/:id', () =>
        HttpResponse.json({ detail: 'Not Found' }, { status: 404 }),
      ),
    )
    const { result } = renderHook(() => useDeleteProveedor(), { wrapper: createWrapper() })
    result.current.mutate('missing-id')
    await waitFor(() => expect(result.current.isError).toBe(true))
    // Error is surfaced, not silently swallowed
    expect(result.current.error).toBeTruthy()
  })
})

describe('useBuscarProveedores', () => {
  it('returns matching suppliers when query has ≥2 chars', async () => {
    const { result } = renderHook(() => useBuscarProveedores('Pro'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const data = result.current.data ?? []
    expect(data).toHaveLength(1)
    expect(data[0]?.nombre).toBe('Proveedor Test SA')
  })

  it('is disabled (no fetch) when query is shorter than 2 chars', async () => {
    const { result } = renderHook(() => useBuscarProveedores('P'), {
      wrapper: createWrapper(),
    })
    // enabled=false → query never runs → remains in idle state, no data
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })

  it('is disabled when query is empty string', async () => {
    const { result } = renderHook(() => useBuscarProveedores(''), {
      wrapper: createWrapper(),
    })
    // Query should be disabled (no fetch) — remains in pending state
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
  })
})
