/**
 * Tests for ventas data layer hooks (C-34, tasks 5.6/5.7).
 *
 * Strategy: MSW intercepts all API calls — no real backend (mirrors
 * `clientesHooks.test.tsx` / `pagosHooks.test.tsx`).
 *
 * D6/D7 (design.md) — cross-feature cache invalidation: mutating a `Venta`
 * that was (or becomes) on account ALSO invalidates `CLIENTE_KEYS.all`, so
 * C-35/C-36's account view refreshes. Mirrors the C-13 cross-invalidation of
 * `CUENTA_CORRIENTE_KEYS` in `pagosHooks.ts`.
 *
 * Invalidation is asserted functionally, via GET call counters, rather than
 * by reading `QueryState.isInvalidated`: an actively-mounted query that gets
 * invalidated auto-refetches immediately, and `isInvalidated` resets to
 * `false` again the instant that refetch resolves — by the time a test's
 * `await waitFor(...)` returns, the flag has often already flipped back.
 * A GET count that goes up is the durable, observable signal that a refetch
 * actually happened.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  VENTA_KEYS,
  useVentas,
  useVenta,
  useCreateVenta,
  useUpdateVenta,
  useDeleteVenta,
} from './ventasHooks'
import { useClientes } from '@features/clientes/api/clientesHooks'
import type { Venta, VentaListItem, ClienteListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockVentaEfectivo: VentaListItem = {
  id: 'venta-1',
  negocio_id: 'negocio-1',
  cliente_id: null,
  fecha: '2026-08-10',
  monto: '1000.00',
  forma_pago: 'EFECTIVO',
  notas: null,
  created_at: '2026-08-10T10:00:00',
  updated_at: '2026-08-10T10:00:00',
}

const mockVentaFiada: Venta = {
  id: 'venta-2',
  negocio_id: 'negocio-1',
  cliente_id: 'cliente-1',
  fecha: '2026-08-10',
  monto: '500.00',
  forma_pago: 'CUENTA_CORRIENTE',
  notas: null,
  created_at: '2026-08-10T10:00:00',
  updated_at: '2026-08-10T10:00:00',
}

const mockCliente: ClienteListItem = {
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

// ── MSW Server ────────────────────────────────────────────────────────────────
//
// Call counters let a test observe whether a refetch actually happened after
// invalidation, without depending on the transient `isInvalidated` flag.

let ventasAllGetCount = 0
let clientesGetCount = 0

const server = setupServer(
  http.get('/api/ventas', ({ request }) => {
    const url = new URL(request.url)
    const formaPago = url.searchParams.get('forma_pago')
    if (formaPago === 'CUENTA_CORRIENTE') return HttpResponse.json([mockVentaFiada])
    if (!formaPago) {
      ventasAllGetCount += 1
      return HttpResponse.json([mockVentaEfectivo])
    }
    return HttpResponse.json([mockVentaEfectivo])
  }),

  http.get('/api/ventas/:id', ({ params }) => {
    if (params.id === 'venta-2') return HttpResponse.json(mockVentaFiada)
    if (params.id === 'venta-1') return HttpResponse.json(mockVentaEfectivo)
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),

  http.post('/api/ventas', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...mockVentaFiada, ...body }, { status: 201 })
  }),

  http.patch('/api/ventas/:id', async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...mockVentaFiada, id: params.id, ...body })
  }),

  http.delete('/api/ventas/:id', () => new HttpResponse(null, { status: 204 })),

  http.get('/api/clientes', () => {
    clientesGetCount += 1
    return HttpResponse.json([mockCliente])
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  ventasAllGetCount = 0
  clientesGetCount = 0
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

// ── Review fix (finding F) ───────────────────────────────────────────────────
//
// The "does NOT invalidate clientes" tests used to prove absence with a
// fixed `setTimeout(50)` — a race, not a wait: a late invalidation still
// passes the assertion, and it flakes under load. This forces a SECOND,
// fully-awaited ventas refetch cycle (a manual `invalidateQueries` on the
// already-mounted `useVentas({})` query, deterministically awaited) AFTER
// the mutation's own cycle has settled, then asserts the clientes GET count
// never moved across BOTH cycles. Two real round trips give a would-be
// delayed clientes invalidation two full chances to show up — no fixed
// timeout anywhere, mirroring the `waitFor`-based positive assertions
// already used elsewhere in this file.
async function assertNoStrayClienteInvalidation(
  queryClient: QueryClient,
  ventasCountBaseline: number,
) {
  await waitFor(() => expect(ventasAllGetCount).toBeGreaterThan(ventasCountBaseline))
  const afterCycle1 = clientesGetCount

  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: VENTA_KEYS.all })
  })
  await waitFor(() => expect(ventasAllGetCount).toBeGreaterThan(ventasCountBaseline + 1))

  expect(clientesGetCount).toBe(afterCycle1)
  expect(clientesGetCount).toBe(1)
}

// ── VENTA_KEYS ────────────────────────────────────────────────────────────────

describe('VENTA_KEYS', () => {
  it('is exported with a stable `all` key', () => {
    expect(VENTA_KEYS.all).toEqual(['ventas'])
  })
})

// ── useVentas (task 5.6) ──────────────────────────────────────────────────────

describe('useVentas', () => {
  it('keys by the filter object — different filters fetch independently', async () => {
    const { Wrapper } = createWrapper()
    const { result: cashResult } = renderHook(() => useVentas({ forma_pago: 'EFECTIVO' }), {
      wrapper: Wrapper,
    })
    const { result: fiadoResult } = renderHook(
      () => useVentas({ forma_pago: 'CUENTA_CORRIENTE' }),
      { wrapper: Wrapper },
    )
    await waitFor(() => expect(cashResult.current.isSuccess).toBe(true))
    await waitFor(() => expect(fiadoResult.current.isSuccess).toBe(true))
    expect(cashResult.current.data?.[0]?.id).toBe('venta-1')
    expect(fiadoResult.current.data?.[0]?.id).toBe('venta-2')
  })
})

// ── useVenta (single) ─────────────────────────────────────────────────────────

describe('useVenta', () => {
  it('fetches a single venta by id', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useVenta('venta-2'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.forma_pago).toBe('CUENTA_CORRIENTE')
  })
})

// ── useCreateVenta (task 5.6) ────────────────────────────────────────────────

describe('useCreateVenta', () => {
  it('invalidates VENTA_KEYS.all on success — the mounted ventas list refetches', async () => {
    const { Wrapper } = createWrapper()
    const listHook = renderHook(() => useVentas({}), { wrapper: Wrapper })
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true))
    expect(ventasAllGetCount).toBe(1)

    const createHook = renderHook(() => useCreateVenta(), { wrapper: Wrapper })
    createHook.result.current.mutate({
      monto: '500.00',
      fecha: '2026-08-10',
      forma_pago: 'CUENTA_CORRIENTE',
      cliente_id: 'cliente-1',
    })
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(ventasAllGetCount).toBeGreaterThan(1))
  })

  it('also invalidates CLIENTE_KEYS.all when the created sale is on account (triangulation)', async () => {
    const { Wrapper } = createWrapper()
    const clientesHook = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(clientesHook.result.current.isSuccess).toBe(true))
    expect(clientesGetCount).toBe(1)

    const createHook = renderHook(() => useCreateVenta(), { wrapper: Wrapper })
    createHook.result.current.mutate({
      monto: '500.00',
      fecha: '2026-08-10',
      forma_pago: 'CUENTA_CORRIENTE',
      cliente_id: 'cliente-1',
    })
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(clientesGetCount).toBeGreaterThan(1))
  })

  it('does NOT invalidate CLIENTE_KEYS.all when the created sale is cash (triangulation)', async () => {
    const { queryClient, Wrapper } = createWrapper()
    const listHook = renderHook(() => useVentas({}), { wrapper: Wrapper })
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true))
    const clientesHook = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(clientesHook.result.current.isSuccess).toBe(true))
    expect(clientesGetCount).toBe(1)

    const ventasCountBaseline = ventasAllGetCount
    const createHook = renderHook(() => useCreateVenta(), { wrapper: Wrapper })
    createHook.result.current.mutate({
      monto: '1000.00',
      fecha: '2026-08-10',
      forma_pago: 'EFECTIVO',
    })
    await waitFor(() => expect(createHook.result.current.isSuccess).toBe(true))

    await assertNoStrayClienteInvalidation(queryClient, ventasCountBaseline)
  })
})

// ── useUpdateVenta (task 5.6) ─────────────────────────────────────────────────

describe('useUpdateVenta', () => {
  it('invalidates VENTA_KEYS.all and CLIENTE_KEYS.all when the sale WAS on account before the edit', async () => {
    const { Wrapper } = createWrapper()
    const listHook = renderHook(() => useVentas({}), { wrapper: Wrapper })
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true))
    const clientesHook = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(clientesHook.result.current.isSuccess).toBe(true))

    const updateHook = renderHook(() => useUpdateVenta(), { wrapper: Wrapper })
    // The caller (VentaForm, task 6.8) knows the sale being edited WAS on
    // account before this PATCH — the response alone can't tell us that,
    // since it only reflects the new state (design.md D5).
    updateHook.result.current.mutate({
      id: 'venta-2',
      data: { forma_pago: 'EFECTIVO' },
      wasOnAccount: true,
    })
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true))

    await waitFor(() => expect(ventasAllGetCount).toBeGreaterThan(1))
    await waitFor(() => expect(clientesGetCount).toBeGreaterThan(1))
  })

  it('invalidates CLIENTE_KEYS.all when the sale stays on account (triangulation — no wasOnAccount flag needed)', async () => {
    const { Wrapper } = createWrapper()
    const clientesHook = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(clientesHook.result.current.isSuccess).toBe(true))
    expect(clientesGetCount).toBe(1)

    const updateHook = renderHook(() => useUpdateVenta(), { wrapper: Wrapper })
    updateHook.result.current.mutate({
      id: 'venta-2',
      data: { monto: '600.00' },
    })
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(clientesGetCount).toBeGreaterThan(1))
  })

  it('does NOT invalidate CLIENTE_KEYS.all editing a cash sale that stays cash (triangulation)', async () => {
    server.use(
      http.patch('/api/ventas/:id', async ({ request, params }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...mockVentaEfectivo, id: params.id, ...body })
      }),
    )
    const { queryClient, Wrapper } = createWrapper()
    const listHook = renderHook(() => useVentas({}), { wrapper: Wrapper })
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true))
    const clientesHook = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(clientesHook.result.current.isSuccess).toBe(true))
    expect(clientesGetCount).toBe(1)

    const ventasCountBaseline = ventasAllGetCount
    const updateHook = renderHook(() => useUpdateVenta(), { wrapper: Wrapper })
    updateHook.result.current.mutate({
      id: 'venta-1',
      data: { monto: '1200.00' },
    })
    await waitFor(() => expect(updateHook.result.current.isSuccess).toBe(true))

    await assertNoStrayClienteInvalidation(queryClient, ventasCountBaseline)
  })
})

// ── useDeleteVenta (task 5.6) ─────────────────────────────────────────────────

describe('useDeleteVenta', () => {
  it('invalidates VENTA_KEYS.all and CLIENTE_KEYS.all when the deleted sale was on account', async () => {
    const { Wrapper } = createWrapper()
    const listHook = renderHook(() => useVentas({}), { wrapper: Wrapper })
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true))
    const clientesHook = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(clientesHook.result.current.isSuccess).toBe(true))

    const deleteHook = renderHook(() => useDeleteVenta(), { wrapper: Wrapper })
    deleteHook.result.current.mutate({
      id: 'venta-2',
      cliente_id: 'cliente-1',
      forma_pago: 'CUENTA_CORRIENTE',
    })
    await waitFor(() => expect(deleteHook.result.current.isSuccess).toBe(true))

    await waitFor(() => expect(ventasAllGetCount).toBeGreaterThan(1))
    await waitFor(() => expect(clientesGetCount).toBeGreaterThan(1))
  })

  it('invalidates VENTA_KEYS.all but NOT CLIENTE_KEYS.all when the deleted sale was cash (triangulation)', async () => {
    const { queryClient, Wrapper } = createWrapper()
    const listHook = renderHook(() => useVentas({}), { wrapper: Wrapper })
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true))
    const clientesHook = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(clientesHook.result.current.isSuccess).toBe(true))
    expect(clientesGetCount).toBe(1)

    const ventasCountBaseline = ventasAllGetCount
    const deleteHook = renderHook(() => useDeleteVenta(), { wrapper: Wrapper })
    deleteHook.result.current.mutate({
      id: 'venta-1',
      cliente_id: null,
      forma_pago: 'EFECTIVO',
    })
    await waitFor(() => expect(deleteHook.result.current.isSuccess).toBe(true))

    await assertNoStrayClienteInvalidation(queryClient, ventasCountBaseline)
  })
})
