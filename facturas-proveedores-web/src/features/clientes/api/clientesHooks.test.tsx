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
import {
  CLIENTE_KEYS,
  useClientes,
  useBuscarClientes,
  useCreateCliente,
  useCliente,
  useCuentaCorrienteCliente,
} from './clientesHooks'
import { useCreateVenta } from '@features/ventas/api/ventasHooks'
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

  http.get('/api/clientes/:id', ({ params }) => {
    if (params.id === 'cliente-1') return HttpResponse.json(mockCliente)
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),

  http.get('/api/clientes/:id/cuenta-corriente', ({ params }) => {
    cuentaCorrienteGetCount += 1
    return HttpResponse.json({
      cliente_id: params.id as string,
      saldo: '500.00',
      ventas_con_estado: [],
      historial: [],
    })
  }),

  http.post('/api/ventas', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json(
      {
        id: 'venta-new',
        negocio_id: 'negocio-1',
        cliente_id: 'cliente-1',
        fecha: '2026-08-16',
        monto: '500.00',
        forma_pago: 'CUENTA_CORRIENTE',
        notas: null,
        created_at: '2026-08-16T10:00:00',
        updated_at: '2026-08-16T10:00:00',
        ...body,
      },
      { status: 201 },
    )
  }),
)

let cuentaCorrienteGetCount = 0

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  clientesList = [mockCliente]
  cuentaCorrienteGetCount = 0
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

// ── CLIENTE_KEYS.cuentaCorriente is prefixed by CLIENTE_KEYS.all (task 6.1,
// design.md D4) ───────────────────────────────────────────────────────────

describe('CLIENTE_KEYS.cuentaCorriente — key prefix contract', () => {
  it('CLIENTE_KEYS.cuentaCorriente(id) starts with the exact CLIENTE_KEYS.all array', () => {
    const key = CLIENTE_KEYS.cuentaCorriente('cliente-1')
    expect(key.slice(0, CLIENTE_KEYS.all.length)).toEqual(CLIENTE_KEYS.all)
  })

  it('a different id still nests under the same prefix (triangulation)', () => {
    const key = CLIENTE_KEYS.cuentaCorriente('cliente-999')
    expect(key[0]).toBe(CLIENTE_KEYS.all[0])
  })
})

// ── useCuentaCorrienteCliente (task 6.2) ─────────────────────────────────────

describe('useCuentaCorrienteCliente', () => {
  it('is disabled (idle, no fetch) on an empty id', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCuentaCorrienteCliente(''), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.data).toBeUndefined()
  })

  it('fetches the account for a non-empty id and does not retry on failure', async () => {
    let notFoundGetCount = 0
    server.use(
      http.get('/api/clientes/:id/cuenta-corriente', () => {
        notFoundGetCount += 1
        return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
      }),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCuentaCorrienteCliente('cliente-404'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    // retry: false — exactly one attempt, no retry spinner.
    expect(notFoundGetCount).toBe(1)
  })

  it('has staleTime 0 so a revisit refetches (triangulation)', async () => {
    const { Wrapper, queryClient } = createWrapper()
    const { result, unmount } = renderHook(() => useCuentaCorrienteCliente('cliente-1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(cuentaCorrienteGetCount).toBe(1)
    unmount()
    queryClient.clear()

    const { result: result2 } = renderHook(() => useCuentaCorrienteCliente('cliente-1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result2.current.isSuccess).toBe(true))
    expect(cuentaCorrienteGetCount).toBe(2)
  })
})

// ── Cross-feature invalidation without editing ventasHooks.ts (task 6.3) ────
//
// If this fails, the key layout (design.md D4) is wrong — fix
// CLIENTE_KEYS.cuentaCorriente, never ventasHooks.ts, which this test
// imports UNMODIFIED.

describe('useCreateVenta (unmodified) reaches the customer account query (task 6.3)', () => {
  it('marks a cached account query stale after creating a CUENTA_CORRIENTE sale', async () => {
    const { Wrapper, queryClient } = createWrapper()
    const accountHook = renderHook(() => useCuentaCorrienteCliente('cliente-1'), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(accountHook.result.current.isSuccess).toBe(true))

    const createVentaHook = renderHook(() => useCreateVenta(), { wrapper: Wrapper })
    createVentaHook.result.current.mutate({
      monto: '500.00',
      fecha: '2026-08-16',
      forma_pago: 'CUENTA_CORRIENTE',
      cliente_id: 'cliente-1',
    })
    await waitFor(() => expect(createVentaHook.result.current.isSuccess).toBe(true))

    // The account query is actively mounted, so invalidation triggers an
    // immediate refetch — a GET count that goes up is the durable,
    // observable signal (mirrors `ventasHooks.test.tsx`'s own rationale for
    // preferring this over the transient `isInvalidated` flag).
    await waitFor(() => expect(cuentaCorrienteGetCount).toBeGreaterThan(1))
    expect(queryClient.getQueryData(CLIENTE_KEYS.cuentaCorriente('cliente-1'))).toBeTruthy()
  })
})

// ── useCliente (single, task 6.6) ────────────────────────────────────────────

describe('useCliente', () => {
  it('fetches a single customer by id', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCliente('cliente-1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.nombre).toBe('Juan Pérez')
  })

  it('is disabled on an empty id (triangulation)', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCliente(''), { wrapper: Wrapper })
    expect(result.current.fetchStatus).toBe('idle')
  })
})
