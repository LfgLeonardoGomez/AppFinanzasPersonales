/**
 * Tests for the actividad-reciente TanStack Query hook (C-44, D2).
 *
 * MSW intercepts the raw Axios call — no real backend. Handlers are
 * declared here, inside `features/proveedores/`, mirroring
 * `actividadRecienteApi.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useActividadReciente, ACTIVIDAD_RECIENTE_KEYS } from './actividadRecienteHooks'

const mockItem = {
  tipo: 'factura',
  id: 'act-1',
  proveedor_id: 'prov-1',
  proveedor_nombre: 'Proveedor Uno',
  monto: '1500.50',
  fecha: '2026-06-01',
  created_at: '2026-06-01T10:00:00',
}

let capturedLimit: string | null = null

const server = setupServer(
  http.get('/api/actividad-reciente', ({ request }) => {
    const url = new URL(request.url)
    capturedLimit = url.searchParams.get('limit')
    return HttpResponse.json([mockItem])
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  capturedLimit = null
})

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('useActividadReciente', () => {
  it('fetches and parses the recent-activity feed', async () => {
    const { result } = renderHook(() => useActividadReciente(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0]?.monto).toBe(1500.5)
    expect(capturedLimit).toBe('8')
  })

  it('sends a custom limit and reflects it in the request', async () => {
    const { result } = renderHook(() => useActividadReciente(3), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(capturedLimit).toBe('3')
  })
})

describe('ACTIVIDAD_RECIENTE_KEYS', () => {
  it('includes the limit in the query key, so changing it is a refetch, not a cache hit', () => {
    expect(ACTIVIDAD_RECIENTE_KEYS.list(8)).not.toEqual(ACTIVIDAD_RECIENTE_KEYS.list(3))
  })
})
