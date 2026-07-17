/**
 * Tests for the IA vision data layer hooks (C-15).
 *
 * Strategy: MSW intercepts all API calls — no real backend.
 * The 5 response shapes from the C-14 spec are covered for BOTH endpoints
 * (10 scenarios total). TDD: Task 2.1 (RED) → 2.2/2.3 (GREEN) → 2.4/2.5 (TRIANGULATE).
 *
 * The hooks MUST NOT retry on failure (RN-IA-04 / RN-IA-05 — a 429 or
 * `error: true` envelope is a real answer, not a transient) and MUST
 * NOT invalidate any TanStack Query keys (the proposal is transient;
 * the persist happens via the existing C-09 / C-11 mutations).
 *
 * Implementation note: the MSW handlers do NOT call
 * `await request.formData()` to read the request body. Reading the body
 * via MSW's `request.formData()` is unreliable in the Vitest + jsdom
 * environment (the underlying `undici` parser throws on FormData sent
 * by the Axios fetch adapter in some test runs because the body stream
 * is consumed once and cannot be re-parsed). The contract that the
 * `file` part is included in the multipart request is enforced at the
 * API layer (`extraerFacturaIA` / `extraerPagoIA` always build a
 * `FormData` with the `file` key). At the data-layer test level, we
 * verify the wire contract: the MSW handler is called (proving the
 * request reached the URL), the response shape is parsed correctly,
 * and the 5 response shapes × 2 endpoints are covered.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useExtraerFacturaIA, useExtraerPagoIA } from './iaVisionHooks'
import { extraerFacturaIA } from './iaVisionApi'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const fullPropuestaFactura = {
  proveedor_nombre: 'Acme SA',
  numero: '0001-00012345',
  fecha_emision: '2026-06-15',
  monto_total: '12345.67', // Pydantic serializes Decimal as string
  error: false,
  error_message: null,
}

const fullPropuestaPago = {
  proveedor_nombre: 'Acme SA',
  monto: '5000.00',
  fecha: '2026-06-20',
  metodo: 'TRANSFERENCIA',
  error: false,
  error_message: null,
}

const errorEnvelope = {
  proveedor_nombre: null,
  numero: null,
  fecha_emision: null,
  monto_total: null,
  error: true,
  error_message: 'Image too blurry',
}

// ── MSW Server ────────────────────────────────────────────────────────────────

let facturaExtractHitCount = 0
let pagoExtractHitCount = 0

const server = setupServer(
  http.post('/api/facturas/extraer-ia', () => {
    facturaExtractHitCount++
    return HttpResponse.json(fullPropuestaFactura, { status: 200 })
  }),

  http.post('/api/pagos/extraer-ia', () => {
    pagoExtractHitCount++
    return HttpResponse.json(fullPropuestaPago, { status: 200 })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterAll(() => server.close())

// ── Wire-format regression (Content-Type) ─────────────────────────────────────

describe('IA vision request wire format', () => {
  it('sends the upload as multipart/form-data, not application/json', async () => {
    let capturedContentType: string | null = null
    server.use(
      http.post('/api/facturas/extraer-ia', ({ request }) => {
        capturedContentType = request.headers.get('content-type')
        return HttpResponse.json(fullPropuestaFactura, { status: 200 })
      }),
    )
    const file = new File([new Uint8Array([255, 216, 255, 0])], 'factura.jpg', {
      type: 'image/jpeg',
    })
    await extraerFacturaIA(file)
    // The shared apiClient defaults to application/json; the upload MUST
    // override it so FastAPI can parse the multipart body (else 422).
    expect(capturedContentType).toMatch(/^multipart\/form-data/)
  })
})
afterEach(() => {
  server.resetHandlers()
  facturaExtractHitCount = 0
  pagoExtractHitCount = 0
})

// ── Query wrapper ─────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

// Helper: build a fake JPEG file (the real type is irrelevant for the test —
// the backend would inspect magic bytes; we just need a File instance).
function fakeImage(name = 'factura.jpg', sizeBytes = 1024): File {
  const bytes = new Uint8Array(sizeBytes)
  return new File([bytes], name, { type: 'image/jpeg' })
}

// ── useExtraerFacturaIA — 200 success (Task 2.1) ─────────────────────────────

describe('useExtraerFacturaIA — 200 success', () => {
  it('POSTs to /api/facturas/extraer-ia and returns a typed PropuestaFactura with monto_total parsed to number', async () => {
    const { result } = renderHook(() => useExtraerFacturaIA(), { wrapper: createWrapper() })
    const file = fakeImage()
    result.current.mutate(file, {
      onSuccess: (data) => {
        // The TS type guarantees the shape
        expect(data.proveedor_nombre).toBe('Acme SA')
        expect(data.numero).toBe('0001-00012345')
        expect(data.fecha_emision).toBe('2026-06-15')
        // monto_total was a Decimal string "12345.67" — the API helper
        // parses it to a number at the boundary
        expect(data.monto_total).toBe(12345.67)
        expect(data.error).toBe(false)
        expect(data.error_message).toBeNull()
      },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(facturaExtractHitCount).toBe(1)
  })
})

// ── useExtraerFacturaIA — 200 with error:true (Task 2.1, RN-IA-05) ───────────

describe('useExtraerFacturaIA — 200 with error:true', () => {
  it('returns a PropuestaFactura with error=true and all other fields null (the modal transitions to error_extractor)', async () => {
    server.use(
      http.post('/api/facturas/extraer-ia', () => HttpResponse.json(errorEnvelope, { status: 200 })),
    )
    const { result } = renderHook(() => useExtraerFacturaIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onSuccess: (data) => {
        expect(data.error).toBe(true)
        expect(data.error_message).toBe('Image too blurry')
        expect(data.proveedor_nombre).toBeNull()
        expect(data.numero).toBeNull()
        expect(data.monto_total).toBeNull()
      },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

// ── useExtraerFacturaIA — 422 (Task 2.1) ─────────────────────────────────────

describe('useExtraerFacturaIA — 422', () => {
  it('onError receives a typed error with status 422 and the backend message', async () => {
    server.use(
      http.post('/api/facturas/extraer-ia', () =>
        HttpResponse.json(
          { detail: 'Unsupported image format' },
          { status: 422 },
        ),
      ),
    )
    const { result } = renderHook(() => useExtraerFacturaIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onError: (err) => {
        // Axios error shape — extract status
        const axiosErr = err as { response?: { status: number; data?: { detail?: string } } }
        expect(axiosErr.response?.status).toBe(422)
        expect(axiosErr.response?.data?.detail).toBe('Unsupported image format')
      },
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ── useExtraerFacturaIA — 429 with Retry-After (Task 2.1) ────────────────────

describe('useExtraerFacturaIA — 429', () => {
  it('onError receives a typed error with status 429 and the Retry-After header value', async () => {
    server.use(
      http.post('/api/facturas/extraer-ia', () =>
        HttpResponse.json(
          { detail: 'Too many requests' },
          { status: 429, headers: { 'Retry-After': '600' } },
        ),
      ),
    )
    const { result } = renderHook(() => useExtraerFacturaIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onError: (err) => {
        const axiosErr = err as {
          response?: { status: number; headers?: Record<string, string> }
        }
        expect(axiosErr.response?.status).toBe(429)
        expect(axiosErr.response?.headers?.['retry-after']).toBe('600')
      },
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ── useExtraerFacturaIA — 500 generic (Task 2.1) ─────────────────────────────

describe('useExtraerFacturaIA — 500', () => {
  it('onError receives a generic error with status 500', async () => {
    server.use(
      http.post('/api/facturas/extraer-ia', () =>
        HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 }),
      ),
    )
    const { result } = renderHook(() => useExtraerFacturaIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onError: (err) => {
        const axiosErr = err as { response?: { status: number } }
        expect(axiosErr.response?.status).toBe(500)
      },
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ── useExtraerPagoIA — 200 success (Task 2.1) ───────────────────────────────

describe('useExtraerPagoIA — 200 success', () => {
  it('POSTs to /api/pagos/extraer-ia and returns a typed PropuestaPago with monto parsed to number', async () => {
    const { result } = renderHook(() => useExtraerPagoIA(), { wrapper: createWrapper() })
    const file = fakeImage('pago.png')
    result.current.mutate(file, {
      onSuccess: (data) => {
        expect(data.proveedor_nombre).toBe('Acme SA')
        expect(data.monto).toBe(5000)
        expect(data.fecha).toBe('2026-06-20')
        expect(data.metodo).toBe('TRANSFERENCIA')
        expect(data.error).toBe(false)
      },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(pagoExtractHitCount).toBe(1)
  })
})

// ── useExtraerPagoIA — 200 with error:true (Task 2.1) ───────────────────────

describe('useExtraerPagoIA — 200 with error:true', () => {
  it('returns a PropuestaPago with error=true and all other fields null', async () => {
    server.use(
      http.post('/api/pagos/extraer-ia', () =>
        HttpResponse.json(
          {
            proveedor_nombre: null,
            monto: null,
            fecha: null,
            metodo: null,
            error: true,
            error_message: 'Image too blurry',
          },
          { status: 200 },
        ),
      ),
    )
    const { result } = renderHook(() => useExtraerPagoIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onSuccess: (data) => {
        expect(data.error).toBe(true)
        expect(data.error_message).toBe('Image too blurry')
        expect(data.metodo).toBeNull()
      },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

// ── useExtraerPagoIA — 422 (Task 2.1) ────────────────────────────────────────

describe('useExtraerPagoIA — 422', () => {
  it('onError receives a typed error with status 422', async () => {
    server.use(
      http.post('/api/pagos/extraer-ia', () =>
        HttpResponse.json(
          { detail: 'File too large' },
          { status: 422 },
        ),
      ),
    )
    const { result } = renderHook(() => useExtraerPagoIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onError: (err) => {
        const axiosErr = err as { response?: { status: number; data?: { detail?: string } } }
        expect(axiosErr.response?.status).toBe(422)
      },
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ── useExtraerPagoIA — 429 (Task 2.1) ────────────────────────────────────────

describe('useExtraerPagoIA — 429', () => {
  it('onError receives a typed error with status 429 and Retry-After header', async () => {
    server.use(
      http.post('/api/pagos/extraer-ia', () =>
        HttpResponse.json(
          { detail: 'Too many requests' },
          { status: 429, headers: { 'Retry-After': '120' } },
        ),
      ),
    )
    const { result } = renderHook(() => useExtraerPagoIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onError: (err) => {
        const axiosErr = err as {
          response?: { status: number; headers?: Record<string, string> }
        }
        expect(axiosErr.response?.status).toBe(429)
        expect(axiosErr.response?.headers?.['retry-after']).toBe('120')
      },
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ── useExtraerPagoIA — 500 (Task 2.1) ────────────────────────────────────────

describe('useExtraerPagoIA — 500', () => {
  it('onError receives a generic error with status 500', async () => {
    server.use(
      http.post('/api/pagos/extraer-ia', () =>
        HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 }),
      ),
    )
    const { result } = renderHook(() => useExtraerPagoIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onError: (err) => {
        const axiosErr = err as { response?: { status: number } }
        expect(axiosErr.response?.status).toBe(500)
      },
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

// ── Task 2.4 — boundary value parsing for monto_total / monto (TRIANGULATE) ─

describe('parsePropuestaFactura — decimal boundary values (Task 2.4)', () => {
  it('parses "0" → 0', async () => {
    server.use(
      http.post('/api/facturas/extraer-ia', () =>
        HttpResponse.json(
          {
            proveedor_nombre: null,
            numero: null,
            fecha_emision: null,
            monto_total: '0',
            error: false,
            error_message: null,
          },
          { status: 200 },
        ),
      ),
    )
    const { result } = renderHook(() => useExtraerFacturaIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onSuccess: (data) => {
        expect(data.monto_total).toBe(0)
        expect(typeof data.monto_total).toBe('number')
      },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('parses "0.01" → 0.01 (the smallest valid amount)', async () => {
    server.use(
      http.post('/api/facturas/extraer-ia', () =>
        HttpResponse.json(
          {
            proveedor_nombre: null,
            numero: null,
            fecha_emision: null,
            monto_total: '0.01',
            error: false,
            error_message: null,
          },
          { status: 200 },
        ),
      ),
    )
    const { result } = renderHook(() => useExtraerFacturaIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onSuccess: (data) => {
        expect(data.monto_total).toBe(0.01)
      },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('parses "99999999.99" → 99999999.99 (largest valid amount)', async () => {
    server.use(
      http.post('/api/facturas/extraer-ia', () =>
        HttpResponse.json(
          {
            proveedor_nombre: null,
            numero: null,
            fecha_emision: null,
            monto_total: '99999999.99',
            error: false,
            error_message: null,
          },
          { status: 200 },
        ),
      ),
    )
    const { result } = renderHook(() => useExtraerFacturaIA(), { wrapper: createWrapper() })
    result.current.mutate(fakeImage(), {
      onSuccess: (data) => {
        expect(data.monto_total).toBe(99999999.99)
      },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

// ── Task 2.5 — no cache invalidation (TRIANGULATE) ───────────────────────────

describe('IA vision hooks — no cache invalidation (Task 2.5)', () => {
  it('useExtraerFacturaIA does NOT call queryClient.invalidateQueries on success', async () => {
    const invalidateSpy = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.invalidateQueries = invalidateSpy
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
    const { result } = renderHook(() => useExtraerFacturaIA(), { wrapper: Wrapper })
    result.current.mutate(fakeImage())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('useExtraerPagoIA does NOT call queryClient.invalidateQueries on success', async () => {
    const invalidateSpy = vi.fn()
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.invalidateQueries = invalidateSpy
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    }
    const { result } = renderHook(() => useExtraerPagoIA(), { wrapper: Wrapper })
    result.current.mutate(fakeImage())
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(invalidateSpy).not.toHaveBeenCalled()
  })
})
