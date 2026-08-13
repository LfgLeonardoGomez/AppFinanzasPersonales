/**
 * Tests for clientes data layer hooks (C-34, tasks 3.5/3.6).
 *
 * Strategy: MSW intercepts all API calls — no real backend (mirrors
 * `proveedoresHooks.test.tsx`).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { CLIENTE_KEYS, useClientes, useBuscarClientes, useCreateCliente } from './clientesHooks'
import type { Cliente, ClienteListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockCliente: Cliente = {
  id: 'cliente-1',
  negocio_id: 'negocio-1',
  nombre: 'Juan Pérez',
  nombre_normalizado: 'JUAN PEREZ',
  telefono: null,
  notas: null,
  created_at: '2026-08-01T10:00:00',
  updated_at: '2026-08-01T10:00:00',
  saldo: null,
}

// ── MSW Server — `clientesList` is mutated by POST so invalidation can be
// observed functionally: a refetch after create must pick up the new row.

let clientesList: ClienteListItem[] = [mockCliente]

const server = setupServer(
  http.get('/api/clientes', () => HttpResponse.json(clientesList)),

  http.get('/api/clientes/buscar', ({ request }) => {
    const url = new URL(request.url)
    const nombre = url.searchParams.get('nombre') ?? ''
    if (!nombre || nombre.length < 2) return HttpResponse.json([])
    return HttpResponse.json([mockCliente])
  }),

  http.post('/api/clientes', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    const created: Cliente = {
      ...mockCliente,
      id: 'cliente-new',
      nombre: body.nombre as string,
    }
    clientesList = [...clientesList, created]
    return HttpResponse.json(created, { status: 201 })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  clientesList = [mockCliente]
})
afterEach(() => server.resetHandlers())

// ── Query wrapper ─────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, Wrapper }
}

// ── useClientes ───────────────────────────────────────────────────────────────

describe('useClientes', () => {
  it("returns the negocio's active customers", async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0]?.nombre).toBe('Juan Pérez')
  })
})

// ── useBuscarClientes (task 3.5) ─────────────────────────────────────────────

describe('useBuscarClientes', () => {
  it('is disabled (idle, no fetch) below the minimum query length', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useBuscarClientes('j'), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })

  it('is enabled and fetches above the minimum query length', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useBuscarClientes('ju'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
  })

  it('CLIENTE_KEYS is exported so other features can invalidate it', () => {
    expect(CLIENTE_KEYS.all).toEqual(['clientes'])
  })
})

// ── useCreateCliente (task 3.6) ──────────────────────────────────────────────

describe('useCreateCliente', () => {
  it("invalidates CLIENTE_KEYS.all on success, so a customer created inline appears in the list immediately", async () => {
    const { Wrapper } = createWrapper()
    const listHook = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(listHook.result.current.data).toHaveLength(1))

    const createHook = renderHook(() => useCreateCliente(), { wrapper: Wrapper })
    createHook.result.current.mutate({ nombre: 'Nueva Clienta' })
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true))

    await waitFor(() => expect(listHook.result.current.data).toHaveLength(2))
    expect(listHook.result.current.data?.[1]?.nombre).toBe('Nueva Clienta')
  })

  it('returns the newly created customer from the mutation itself (triangulation)', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCreateCliente(), { wrapper: Wrapper })
    result.current.mutate({ nombre: 'Otro Cliente' })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.nombre).toBe('Otro Cliente')
  })
})
