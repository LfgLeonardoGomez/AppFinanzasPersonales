/**
 * Tests for the cobros hooks layer (C-36, design.md D4/D7, tasks 6.4-6.5).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCrearCobro } from './cobrosHooks'
import { useClientes } from './clientesHooks'

let clientesGetCount = 0

const RAW_COBRO = {
  id: 'cobro-1',
  negocio_id: 'negocio-1',
  cliente_id: 'cliente-1',
  monto: '500.00',
  fecha: '2026-08-16',
  metodo: 'EFECTIVO',
  comprobante_url: null,
  created_at: '2026-08-16T10:00:00',
  updated_at: '2026-08-16T10:00:00',
}

const server = setupServer(
  http.get('/api/clientes', () => {
    clientesGetCount += 1
    return HttpResponse.json([])
  }),
  http.post('/api/cobros', () => HttpResponse.json(RAW_COBRO, { status: 201 })),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  clientesGetCount = 0
})
afterEach(() => server.resetHandlers())

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, Wrapper }
}

describe('useCrearCobro — invalidates CLIENTE_KEYS.all (task 6.4)', () => {
  it('invalidates the customer list on success, so the balance column refreshes', async () => {
    const { Wrapper } = createWrapper()
    const listHook = renderHook(() => useClientes(), { wrapper: Wrapper })
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true))
    expect(clientesGetCount).toBe(1)

    const cobroHook = renderHook(() => useCrearCobro(), { wrapper: Wrapper })
    cobroHook.result.current.mutate({
      cliente_id: 'cliente-1',
      monto: '500.00',
      fecha: '2026-08-16',
      metodo: 'EFECTIVO',
    })
    await waitFor(() => expect(cobroHook.result.current.isSuccess).toBe(true))
    await waitFor(() => expect(clientesGetCount).toBeGreaterThan(1))
  })
})

describe('useCrearCobro — result passthrough (task 6.5)', () => {
  it('resolves { cobro, replay } — not unwrapped to a bare cobro', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCrearCobro(), { wrapper: Wrapper })
    result.current.mutate({
      cliente_id: 'cliente-1',
      monto: '500.00',
      fecha: '2026-08-16',
      metodo: 'EFECTIVO',
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveProperty('cobro')
    expect(result.current.data).toHaveProperty('replay')
    expect(result.current.data?.replay).toBe(false)
  })

  it('passes replay=true through unwrapped when the server reports a replay (triangulation)', async () => {
    server.use(
      http.post('/api/cobros', () =>
        HttpResponse.json(RAW_COBRO, { status: 200, headers: { 'Idempotent-Replay': 'true' } }),
      ),
    )
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useCrearCobro(), { wrapper: Wrapper })
    result.current.mutate({
      cliente_id: 'cliente-1',
      monto: '500.00',
      fecha: '2026-08-16',
      metodo: 'EFECTIVO',
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.replay).toBe(true)
  })
})
