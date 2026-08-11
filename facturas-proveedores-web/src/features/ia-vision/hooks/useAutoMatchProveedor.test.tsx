/**
 * Tests for the `useAutoMatchProveedor` hook (C-21, task 2.5).
 *
 * Drives `buscarProveedores` (via MSW) and applies the normalized-exact
 * unique-match rule (D4): lowercase + strip accents + trim. Partial,
 * multiple, or absent matches all resolve to `no-match` — only a
 * single normalized-exact hit resolves to `matched`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import type { ProveedorListItem } from '@shared/api/api'
import { useAutoMatchProveedor } from './useAutoMatchProveedor'

function proveedor(overrides: Partial<ProveedorListItem>): ProveedorListItem {
  return {
    id: 'prov-1',
    nombre: 'Acme SA',
    cuit: null,
    telefono: null,
    categoria: 'OTRO',
    notas: null,
    saldo: 0,
    created_at: '2026-06-01T00:00:00',
    updated_at: '2026-06-01T00:00:00',
    ...overrides,
  }
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

describe('useAutoMatchProveedor — normalized-exact unique match', () => {
  it('resolves to matched when exactly one supplier normalizes to the same name', async () => {
    server.use(
      http.get('/api/proveedores/buscar', () => HttpResponse.json([proveedor({ nombre: 'Acme SA' })])),
    )
    const { result } = renderHook(() => useAutoMatchProveedor('acme sa'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('matched'))
    if (result.current.status === 'matched') {
      expect(result.current.proveedor.nombre).toBe('Acme SA')
    }
  })

  it('matches ignoring accents and case (Ferretería vs ferreteria)', async () => {
    server.use(
      http.get('/api/proveedores/buscar', () =>
        HttpResponse.json([proveedor({ id: 'prov-2', nombre: 'Ferretería Nueva' })]),
      ),
    )
    const { result } = renderHook(() => useAutoMatchProveedor('ferreteria nueva'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.status).toBe('matched'))
  })
})

describe('useAutoMatchProveedor — no match cases', () => {
  it('resolves to no-match when there are zero results', async () => {
    server.use(http.get('/api/proveedores/buscar', () => HttpResponse.json([])))
    const { result } = renderHook(() => useAutoMatchProveedor('Ferretería Nueva'), {
      wrapper: makeWrapper(),
    })
    await waitFor(() => expect(result.current.status).toBe('no-match'))
  })

  it('resolves to no-match on a partial ("contains") match, not auto-selected', async () => {
    server.use(
      http.get('/api/proveedores/buscar', () =>
        HttpResponse.json([proveedor({ nombre: 'Acme SA Sucursal Norte' })]),
      ),
    )
    const { result } = renderHook(() => useAutoMatchProveedor('Acme'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('no-match'))
  })

  it('resolves to no-match when multiple suppliers normalize to the same name', async () => {
    server.use(
      http.get('/api/proveedores/buscar', () =>
        HttpResponse.json([
          proveedor({ id: 'prov-1', nombre: 'Acme SA' }),
          proveedor({ id: 'prov-2', nombre: 'acme sa' }),
        ]),
      ),
    )
    const { result } = renderHook(() => useAutoMatchProveedor('Acme SA'), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('no-match'))
  })
})

describe('useAutoMatchProveedor — null proveedor_nombre', () => {
  it('resolves to idle (no query fired) when proveedorNombre is null', () => {
    const { result } = renderHook(() => useAutoMatchProveedor(null), { wrapper: makeWrapper() })
    expect(result.current.status).toBe('idle')
  })
})
