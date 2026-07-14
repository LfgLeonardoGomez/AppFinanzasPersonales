/**
 * Tests for the cuenta-corriente data layer (C-13, task 3).
 *
 * MSW intercepts all API calls. The hook is read-only; the response is
 * the C-12 `CuentaCorrienteResponse` triple (`{saldo, facturas_con_estado,
 * historial}`). Decimals arrive as Pydantic-v2 JSON strings; the API
 * boundary (`parseCuentaCorriente`) parses them to `number`.
 *
 * INVARIANTS:
 *   - 404 is a real answer, not a transient error — `retry: false`.
 *   - `staleTime: 0` so a revisit re-fetches.
 *   - The hook issues `GET /api/proveedores/{id}/cuenta-corriente` with
 *     NO query parameters (the C-12 endpoint has no query params).
 *   - The hook is disabled when `proveedorId === ''`.
 *   - `data.saldo` is a `number` (parsed at the API boundary), not a string.
 *
 * TDD: Task 3.1 (RED) → 3.2 / 3.3 (GREEN) → 3.4 (TRIANGULATE).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useCuentaCorriente } from './cuentaCorrienteHooks'

// ── Fixtures ──────────────────────────────────────────────────────────────────

// Raw wire shape — Pydantic v2 serializes Decimal as a string.
const mockFullTripleRaw = {
  proveedor_id: 'proveedor-uuid-1',
  saldo: '1500.00',
  facturas_con_estado: [
    {
      id: 'factura-uuid-1',
      usuario_id: 'user-1',
      proveedor_id: 'proveedor-uuid-1',
      numero: 'FAC-001',
      fecha_emision: '2026-06-01',
      fecha_vencimiento: '2026-07-01',
      monto_total: '1500.00',
      archivo_url: null,
      origen: 'MANUAL',
      estado: 'PENDIENTE',
      created_at: '2026-06-01T10:00:00',
      updated_at: '2026-06-01T10:00:00',
    },
  ],
  historial: [
    {
      id: 'factura-uuid-1',
      tipo: 'FACTURA',
      fecha: '2026-06-01',
      monto: '1500.00',
      saldo_acumulado: '1500.00',
    },
  ],
}

const mockEmptyTripleRaw = {
  proveedor_id: 'proveedor-empty',
  saldo: '0.00',
  facturas_con_estado: [] as unknown[],
  historial: [] as unknown[],
}

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/proveedores/proveedor-uuid-1/cuenta-corriente', () => {
    return HttpResponse.json(mockFullTripleRaw)
  }),
  http.get('/api/proveedores/proveedor-empty/cuenta-corriente', () => {
    return HttpResponse.json(mockEmptyTripleRaw)
  }),
  http.get('/api/proveedores/proveedor-foreign/cuenta-corriente', () => {
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useCuentaCorriente', () => {
  it('issues GET /api/proveedores/{id}/cuenta-corriente with no query params', async () => {
    const seenUrls: string[] = []
    server.use(
      http.get('/api/proveedores/:id/cuenta-corriente', ({ request }) => {
        seenUrls.push(request.url)
        return HttpResponse.json(mockFullTripleRaw)
      }),
    )
    const { result } = renderHook(() => useCuentaCorriente('proveedor-uuid-1'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seenUrls).toHaveLength(1)
    const url = seenUrls[0]!
    expect(url).toContain('/api/proveedores/proveedor-uuid-1/cuenta-corriente')
    // No query parameters
    expect(new URL(url).search).toBe('')
  })

  it('is disabled when proveedorId is empty (no request fires)', async () => {
    const fetcher = vi.fn()
    server.use(
      http.get('/api/proveedores/:id/cuenta-corriente', () => {
        fetcher()
        return HttpResponse.json(mockFullTripleRaw)
      }),
    )
    const { result } = renderHook(() => useCuentaCorriente(''), {
      wrapper: createWrapper(),
    })
    // Should be idle / pending without firing
    expect(result.current.isSuccess).toBe(false)
    expect(result.current.fetchStatus).toBe('idle')
    // Give it a microtask to confirm no fetch is made
    await new Promise((r) => setTimeout(r, 50))
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('200 with full triple → data has saldo, facturas_con_estado, historial populated from the response', async () => {
    const { result } = renderHook(() => useCuentaCorriente('proveedor-uuid-1'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.saldo).toBe(1500.0)
    expect(result.current.data?.facturas_con_estado).toHaveLength(1)
    expect(result.current.data?.facturas_con_estado[0]?.estado).toBe('PENDIENTE')
    expect(result.current.data?.historial).toHaveLength(1)
    expect(result.current.data?.historial[0]?.tipo).toBe('FACTURA')
  })

  it('200 with empty triple → data is the empty triple (no exception)', async () => {
    const { result } = renderHook(() => useCuentaCorriente('proveedor-empty'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.saldo).toBe(0)
    expect(result.current.data?.facturas_con_estado).toEqual([])
    expect(result.current.data?.historial).toEqual([])
  })

  it('404 → isError is true (no retry, 404 is a real answer)', async () => {
    const { result } = renderHook(() => useCuentaCorriente('proveedor-foreign'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.isSuccess).toBe(false)
  })

  it('Decimal strings are parsed to number at the API boundary', async () => {
    // The wire shape sends '1500.00' as a string; the hook's data exposes
    // it as a number. This is the D13 contract.
    const { result } = renderHook(() => useCuentaCorriente('proveedor-uuid-1'), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(typeof result.current.data?.saldo).toBe('number')
    expect(result.current.data?.saldo).toBe(1500.0)
    const fac = result.current.data?.facturas_con_estado[0]
    expect(typeof fac?.monto_total).toBe('number')
    expect(fac?.monto_total).toBe(1500.0)
    const h = result.current.data?.historial[0]
    expect(typeof h?.monto).toBe('number')
    expect(typeof h?.saldo_acumulado).toBe('number')
    expect(h?.saldo_acumulado).toBe(1500.0)
  })
})
