/**
 * Regression tests for the cross-feature cache invalidation contract (C-13,
 * task 9 / D6).
 *
 * Contract: every `useCreateFactura`, `useUpdateFactura`, `useDeleteFactura`,
 * `useCreatePago`, `useUpdatePago`, `useDeletePago` mutation must
 * invalidate the `cuenta-corriente.detail(proveedorId)` key when the
 * mutation touches a `Factura` or `Pago` for that supplier.
 *
 * Without this, the cuenta-corriente view would not refresh after a
 * mutation and the saldo would be stale (hard rule on the "fresh triple
 * after mutation" guarantee).
 *
 * Strategy: a real `QueryClient` with a spy on its `invalidateQueries`
 * method. The mutation hooks run against MSW handlers; the spy asserts
 * the right key was invalidated.
 *
 * TDD: Task 9.1 (RED) → 9.2 / 9.3 (GREEN) → 9.6 (TRIANGULATE).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import {
  QueryClient,
  QueryClientProvider,
  type QueryClient as QueryClientType,
} from '@tanstack/react-query'
import type { ReactNode } from 'react'
import {
  useCreateFactura,
  useUpdateFactura,
  useDeleteFactura,
} from '@features/facturas/api/facturasHooks'
import {
  useCreatePago,
  useUpdatePago,
  useDeletePago,
} from '@features/pagos/api/pagosHooks'
import { useCuentaCorriente, CUENTA_CORRIENTE_KEYS } from './cuentaCorrienteHooks'
import type {
  FacturaResponse,
  FacturaListItem,
  PagoResponse,
  PagoListItem,
  CuentaCorrienteResponse,
} from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROVEEDOR_A = 'proveedor-A'
const PROVEEDOR_B = 'proveedor-B'

const mockFacturaListItem: FacturaListItem = {
  id: 'factura-1',
  proveedor_id: PROVEEDOR_A,
  numero: 'FAC-001',
  fecha_emision: '2026-06-01',
  monto_total: 1000,
  estado: 'PENDIENTE',
}

const mockFacturaResponse: FacturaResponse = {
  ...mockFacturaListItem,
  // c-26: the LEAN list row does not carry these — the full response does.
  usuario_id: 'user-1',
  fecha_vencimiento: null,
  archivo_url: null,
  origen: 'MANUAL',
  created_at: '2026-06-01T10:00:00',
  updated_at: '2026-06-01T10:00:00',
  items: [],
  items_sum_mismatch: false,
}

const mockPagoListItem: PagoListItem = {
  id: 'pago-1',
  proveedor_id: PROVEEDOR_A,
  monto: 500,
  fecha: '2026-06-10',
  metodo: 'EFECTIVO',
  origen: 'MANUAL',
  created_at: '2026-06-10T10:00:00',
}

const mockPagoResponse: PagoResponse = {
  ...mockPagoListItem,
  usuario_id: 'user-1',
  comprobante_url: null,
  updated_at: '2026-06-10T10:00:00',
}

const mockCuentaCorriente: CuentaCorrienteResponse = {
  proveedor_id: PROVEEDOR_A,
  saldo: 1000,
  facturas_con_estado: [{ ...mockFacturaResponse, estado: 'PENDIENTE' as const }],
  historial: [
    {
      id: 'factura-1',
      tipo: 'FACTURA',
      fecha: '2026-06-01',
      monto: 1000,
      saldo_acumulado: 1000,
    },
  ],
}

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get(/\/api\/proveedores\/[^/]+\/cuenta-corriente$/, () => {
    return HttpResponse.json({
      proveedor_id: PROVEEDOR_A,
      saldo: '1000.00',
      facturas_con_estado: [
        {
          ...mockFacturaListItem,
          monto_total: '1000.00',
        },
      ],
      historial: [
        {
          id: 'factura-1',
          tipo: 'FACTURA',
          fecha: '2026-06-01',
          monto: '1000.00',
          saldo_acumulado: '1000.00',
        },
      ],
    })
  }),

  http.post('/api/facturas', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json(
      { ...mockFacturaResponse, ...body },
      { status: 201 },
    )
  }),

  http.patch('/api/facturas/:id', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...mockFacturaResponse, ...body })
  }),

  http.delete('/api/facturas/:id', () => new HttpResponse(null, { status: 204 })),

  http.post('/api/pagos', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json(
      { ...mockPagoResponse, ...body },
      { status: 201 },
    )
  }),

  http.patch('/api/pagos/:id', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...mockPagoResponse, ...body })
  }),

  http.delete('/api/pagos/:id', () => new HttpResponse(null, { status: 204 })),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Wrapper factory with spied QueryClient ────────────────────────────────────

type InvalidateSpy = {
  mock: { calls: unknown[][] }
  mockClear: () => void
}

function createSpiedWrapper(): {
  Wrapper: (props: { children: ReactNode }) => JSX.Element
  queryClient: QueryClientType
  invalidateSpy: InvalidateSpy
} {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries') as unknown as InvalidateSpy
  return {
    queryClient,
    invalidateSpy,
    Wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    },
  }
}

function invalidateCallsFor(spy: InvalidateSpy, proveedorId: string): number {
  const target = CUENTA_CORRIENTE_KEYS.detail(proveedorId)
  return spy.mock.calls.filter((args: unknown[]) => {
    const arg = args[0] as { queryKey?: readonly unknown[] } | undefined
    if (!arg?.queryKey) return false
    return (
      arg.queryKey.length === target.length &&
      arg.queryKey.every((v, i) => v === target[i])
    )
  }).length
}

// ── Pre-warm cache for the cuenta-corriente hook ──────────────────────────────

async function prewarmCache(queryClient: QueryClientType, proveedorId: string) {
  // Set the cache data so we can verify invalidation cleared it
  queryClient.setQueryData(
    CUENTA_CORRIENTE_KEYS.detail(proveedorId),
    mockCuentaCorriente,
  )
  // Force a render of the hook to register the query in the cache
  const { unmount } = renderHook(() => useCuentaCorriente(proveedorId), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
  await waitFor(() => {
    const data = queryClient.getQueryData(CUENTA_CORRIENTE_KEYS.detail(proveedorId))
    expect(data).toBeDefined()
  })
  unmount()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Cross-feature cache invalidation — cuenta-corriente.detail(proveedorId)', () => {
  it('useCreateFactura with data.proveedor_id = A invalidates cuenta-corriente.detail(A)', async () => {
    const { Wrapper, queryClient, invalidateSpy } = createSpiedWrapper()
    await prewarmCache(queryClient, PROVEEDOR_A)

    const { result } = renderHook(() => useCreateFactura(), { wrapper: Wrapper })
    invalidateSpy.mockClear() // ignore prewarm noise
    act(() => {
      result.current.mutate({
        proveedor_id: PROVEEDOR_A,
        fecha_emision: '2026-06-01',
        monto_total: 1000,
      })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateCallsFor(invalidateSpy, PROVEEDOR_A)).toBeGreaterThanOrEqual(1)
  })

  it('useUpdateFactura with response.proveedor_id = A invalidates cuenta-corriente.detail(A)', async () => {
    const { Wrapper, queryClient, invalidateSpy } = createSpiedWrapper()
    await prewarmCache(queryClient, PROVEEDOR_A)

    const { result } = renderHook(() => useUpdateFactura(), { wrapper: Wrapper })
    invalidateSpy.mockClear()
    act(() => {
      result.current.mutate({ id: 'factura-1', data: { monto_total: 2000 } })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateCallsFor(invalidateSpy, PROVEEDOR_A)).toBeGreaterThanOrEqual(1)
  })

  it('useDeleteFactura({ id, proveedor_id: A }) invalidates cuenta-corriente.detail(A)', async () => {
    const { Wrapper, queryClient, invalidateSpy } = createSpiedWrapper()
    await prewarmCache(queryClient, PROVEEDOR_A)

    const { result } = renderHook(() => useDeleteFactura(), { wrapper: Wrapper })
    invalidateSpy.mockClear()
    act(() => {
      result.current.mutate({ id: 'factura-1', proveedor_id: PROVEEDOR_A })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateCallsFor(invalidateSpy, PROVEEDOR_A)).toBeGreaterThanOrEqual(1)
  })

  it('useCreatePago with data.proveedor_id = A invalidates cuenta-corriente.detail(A)', async () => {
    const { Wrapper, queryClient, invalidateSpy } = createSpiedWrapper()
    await prewarmCache(queryClient, PROVEEDOR_A)

    const { result } = renderHook(() => useCreatePago(), { wrapper: Wrapper })
    invalidateSpy.mockClear()
    act(() => {
      result.current.mutate({
        proveedor_id: PROVEEDOR_A,
        monto: 500,
        fecha: '2026-06-10',
        metodo: 'EFECTIVO',
      })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateCallsFor(invalidateSpy, PROVEEDOR_A)).toBeGreaterThanOrEqual(1)
  })

  it('useUpdatePago with response.proveedor_id = A invalidates cuenta-corriente.detail(A)', async () => {
    const { Wrapper, queryClient, invalidateSpy } = createSpiedWrapper()
    await prewarmCache(queryClient, PROVEEDOR_A)

    const { result } = renderHook(() => useUpdatePago(), { wrapper: Wrapper })
    invalidateSpy.mockClear()
    act(() => {
      result.current.mutate({ id: 'pago-1', data: { monto: 1000 } })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateCallsFor(invalidateSpy, PROVEEDOR_A)).toBeGreaterThanOrEqual(1)
  })

  it('useDeletePago({ id, proveedor_id: A }) invalidates cuenta-corriente.detail(A)', async () => {
    const { Wrapper, queryClient, invalidateSpy } = createSpiedWrapper()
    await prewarmCache(queryClient, PROVEEDOR_A)

    const { result } = renderHook(() => useDeletePago(), { wrapper: Wrapper })
    invalidateSpy.mockClear()
    act(() => {
      result.current.mutate({ id: 'pago-1', proveedor_id: PROVEEDOR_A })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invalidateCallsFor(invalidateSpy, PROVEEDOR_A)).toBeGreaterThanOrEqual(1)
  })

  it('cross-contamination: a mutation on A does NOT invalidate cuenta-corriente.detail(B)', async () => {
    // Triangulation: the invalidation key MUST be derived from the mutation's
    // supplier, not from a global invalidation. A bug that calls
    // `invalidateQueries({ queryKey: CUENTA_CORRIENTE_KEYS.all })` would
    // invalidate B too — and the test catches that.
    const { Wrapper, queryClient, invalidateSpy } = createSpiedWrapper()
    await prewarmCache(queryClient, PROVEEDOR_A)
    await prewarmCache(queryClient, PROVEEDOR_B)

    const { result } = renderHook(() => useCreateFactura(), { wrapper: Wrapper })
    invalidateSpy.mockClear()
    act(() => {
      result.current.mutate({
        proveedor_id: PROVEEDOR_A,
        fecha_emision: '2026-06-01',
        monto_total: 1000,
      })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // A IS invalidated
    expect(invalidateCallsFor(invalidateSpy, PROVEEDOR_A)).toBeGreaterThanOrEqual(1)
    // B is NOT
    expect(invalidateCallsFor(invalidateSpy, PROVEEDOR_B)).toBe(0)
  })
})
