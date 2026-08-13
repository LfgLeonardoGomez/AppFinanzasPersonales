/**
 * Tests for the customers API layer (C-34, tasks 3.1-3.3).
 *
 * MSW intercepts the raw Axios calls — no real backend, no TanStack Query
 * involved (that layer is covered separately in clientesHooks.test.tsx).
 * Mirrors the plain-async-function style of `cuentaCorrienteApi.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { buscarClientes, crearCliente, listClientes } from './clientesApi'
import type { Cliente, ClienteListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockPena: ClienteListItem = {
  id: 'cliente-2',
  negocio_id: 'negocio-1',
  nombre: 'Juan Pena',
  nombre_normalizado: 'JUAN PENA',
  telefono: null,
  notas: null,
  created_at: '2026-08-01T10:00:00',
  updated_at: '2026-08-01T10:00:00',
  saldo: null,
}

const mockPenia: ClienteListItem = {
  id: 'cliente-1',
  negocio_id: 'negocio-1',
  nombre: 'María Peña',
  nombre_normalizado: 'MARIA PEÑA',
  telefono: null,
  notas: null,
  created_at: '2026-08-01T10:00:00',
  updated_at: '2026-08-01T10:00:00',
  saldo: null,
}

// ── MSW Server ────────────────────────────────────────────────────────────────

let capturedUrl = ''

const server = setupServer(
  http.get('/api/clientes/buscar', ({ request }) => {
    capturedUrl = request.url
    const url = new URL(request.url)
    const nombre = url.searchParams.get('nombre') ?? ''
    if (!nombre) return HttpResponse.json([])
    // The server decides order (exact match first, RN-CLI-02) — the client
    // must render this order verbatim, so the exact match is returned SECOND
    // here to make a wrongful client-side sort observable.
    return HttpResponse.json([mockPena, mockPenia])
  }),

  http.get('/api/clientes', () => HttpResponse.json([mockPenia, mockPena])),

  http.post('/api/clientes', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    const created: Cliente & { _receivedKeys: string[] } = {
      id: 'cliente-new',
      negocio_id: 'negocio-1',
      nombre: body.nombre as string,
      nombre_normalizado: (body.nombre as string).toUpperCase(),
      telefono: null,
      notas: null,
      created_at: '2026-08-13T10:00:00',
      updated_at: '2026-08-13T10:00:00',
      saldo: null,
      _receivedKeys: Object.keys(body),
    }
    return HttpResponse.json(created, { status: 201 })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  capturedUrl = ''
})

// ── buscarClientes (task 3.1) ───────────────────────────────────────────────

describe('buscarClientes', () => {
  it('sends the trimmed fragment as `nombre`', async () => {
    await buscarClientes('  pena  ')
    expect(capturedUrl).toContain('nombre=pena')
  })

  it('returns results in server order — no client-side sorting', async () => {
    const results = await buscarClientes('pena')
    expect(results.map((c) => c.id)).toEqual(['cliente-2', 'cliente-1'])
  })

  it('sends an accented fragment as typed, with no normalization applied', async () => {
    await buscarClientes('peña')
    expect(capturedUrl).toContain('nombre=pe')
    expect(decodeURIComponent(capturedUrl)).toContain('nombre=peña')
  })
})

// ── crearCliente (task 3.2) ──────────────────────────────────────────────────

describe('crearCliente', () => {
  it('posts only `nombre` — no `nombre_normalizado`, no `negocio_id`', async () => {
    const created = (await crearCliente({ nombre: 'Nueva Clienta' })) as Cliente & {
      _receivedKeys: string[]
    }
    expect(created.nombre).toBe('Nueva Clienta')
    expect(created._receivedKeys).toEqual(['nombre'])
  })

  it('posts a different name unchanged (triangulation)', async () => {
    const created = (await crearCliente({ nombre: 'Otro Cliente' })) as Cliente & {
      _receivedKeys: string[]
    }
    expect(created.nombre).toBe('Otro Cliente')
    expect(created._receivedKeys).toEqual(['nombre'])
  })
})

// ── listClientes (task 3.3) ──────────────────────────────────────────────────

describe('listClientes', () => {
  it("returns the negocio's active customers", async () => {
    const results = await listClientes()
    expect(results).toHaveLength(2)
    expect(results.map((c) => c.id)).toEqual(['cliente-1', 'cliente-2'])
  })
})

// ── saldo passthrough (review finding C — contract drift with the backend) ──
//
// `ClienteResponse.saldo: Optional[Decimal] = None` (backend
// app/schemas/cliente.py) is populated by GET /api/clientes. Pydantic
// serializes Decimal as a JSON string on this backend (confirmed by
// `test_c35_cuenta_corriente_cliente_integration.py::test_cliente_vacio_saldo_cero_listas_vacias`,
// `data["saldo"] == "0.00"`, same Decimal-typed field, same serialization
// pipeline) — never a float. The type was missing from `ClienteListItem`
// entirely, so this exercises the real runtime shape end to end, not just a
// compile-time guard: `npx tsc --noEmit` is the actual gate for the missing
// field, this pins that the value survives `listClientes` unmodified.
describe('listClientes — preserves saldo (review finding C)', () => {
  it('keeps the numeric saldo string the backend sent, unmodified', async () => {
    server.use(
      http.get('/api/clientes', () =>
        HttpResponse.json([{ ...mockPenia, saldo: '150.00' }, { ...mockPena, saldo: '0.00' }]),
      ),
    )
    const results = await listClientes()
    expect(results[0]?.saldo).toBe('150.00')
    expect(results[1]?.saldo).toBe('0.00')
  })

  it('keeps saldo=null unmodified (triangulation)', async () => {
    server.use(
      http.get('/api/clientes', () => HttpResponse.json([{ ...mockPenia, saldo: null }])),
    )
    const results = await listClientes()
    expect(results[0]?.saldo).toBeNull()
  })
})
