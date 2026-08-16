/**
 * Tests for the customer cuenta-corriente API layer (C-36, design.md D1,
 * tasks 4.1-4.5). Mirrors `cuentaCorrienteApi.test.ts`'s MSW-only style —
 * no TanStack Query involved (that layer is `clientesHooks.test.tsx`).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { getCuentaCorrienteCliente } from './cuentaCorrienteClienteApi'

let capturedUrl = ''
let capturedMethod = ''

const RAW_RESPONSE = {
  cliente_id: 'cliente-1',
  saldo: '1500.00',
  ventas_con_estado: [
    {
      id: 'venta-1',
      negocio_id: 'negocio-1',
      cliente_id: 'cliente-1',
      fecha: '2026-08-01',
      monto: '1000.00',
      forma_pago: 'CUENTA_CORRIENTE',
      notas: null,
      estado: 'PENDIENTE',
      created_at: '2026-08-01T10:00:00',
      updated_at: '2026-08-01T10:00:00',
    },
  ],
  historial: [
    {
      id: 'h-1',
      tipo: 'VENTA',
      fecha: '2026-08-01',
      monto: '1000.00',
      saldo_acumulado: '1000.00',
      archivo_url: null,
    },
    {
      id: 'h-2',
      tipo: 'COBRO',
      fecha: '2026-08-05',
      monto: '500.00',
      saldo_acumulado: '500.00',
    },
  ],
}

const server = setupServer(
  http.get('/api/clientes/:id/cuenta-corriente', ({ request, params }) => {
    capturedUrl = request.url
    capturedMethod = request.method
    return HttpResponse.json({ ...RAW_RESPONSE, cliente_id: params.id as string })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  capturedUrl = ''
  capturedMethod = ''
})

describe('getCuentaCorrienteCliente (task 4.1)', () => {
  it('calls GET /api/clientes/{id}/cuenta-corriente with no body and no query params', async () => {
    await getCuentaCorrienteCliente('cliente-1')
    expect(capturedMethod).toBe('GET')
    expect(capturedUrl).toContain('/api/clientes/cliente-1/cuenta-corriente')
    expect(capturedUrl).not.toContain('?')
  })
})

describe('getCuentaCorrienteCliente — parse boundary (task 4.2)', () => {
  it('parses saldo, fiado monto, and history monto/saldo_acumulado to number', async () => {
    const result = await getCuentaCorrienteCliente('cliente-1')
    expect(result.saldo).toBe(1500)
    expect(result.ventas_con_estado[0]!.monto).toBe(1000)
    expect(result.historial[0]!.monto).toBe(1000)
    expect(result.historial[0]!.saldo_acumulado).toBe(1000)
    expect(result.historial[1]!.saldo_acumulado).toBe(500)
  })
})

describe('getCuentaCorrienteCliente — fails loudly on a malformed Decimal (task 4.3)', () => {
  it('throws a typed error naming the field when saldo is malformed', async () => {
    server.use(
      http.get('/api/clientes/:id/cuenta-corriente', () =>
        HttpResponse.json({ ...RAW_RESPONSE, saldo: 'not-a-number' }),
      ),
    )
    await expect(getCuentaCorrienteCliente('cliente-1')).rejects.toThrow(/saldo/)
  })

  it('throws naming the field for a malformed fiado monto (triangulation)', async () => {
    server.use(
      http.get('/api/clientes/:id/cuenta-corriente', () =>
        HttpResponse.json({
          ...RAW_RESPONSE,
          ventas_con_estado: [{ ...RAW_RESPONSE.ventas_con_estado[0], monto: 'garbage' }],
        }),
      ),
    )
    await expect(getCuentaCorrienteCliente('cliente-1')).rejects.toThrow(/monto/)
  })
})

describe('getCuentaCorrienteCliente — negative saldo is not clamped (task 4.4, D-58)', () => {
  it('a negative saldo on the wire parses to a negative number', async () => {
    server.use(
      http.get('/api/clientes/:id/cuenta-corriente', () =>
        HttpResponse.json({ ...RAW_RESPONSE, saldo: '-300.00' }),
      ),
    )
    const result = await getCuentaCorrienteCliente('cliente-1')
    expect(result.saldo).toBe(-300)
  })
})

describe('getCuentaCorrienteCliente — history order and archivo_url preserved (task 4.5)', () => {
  it('preserves the order received', async () => {
    const result = await getCuentaCorrienteCliente('cliente-1')
    expect(result.historial.map((h) => h.id)).toEqual(['h-1', 'h-2'])
  })

  it('preserves archivo_url, including null for rows with none', async () => {
    const result = await getCuentaCorrienteCliente('cliente-1')
    expect(result.historial[0]!.archivo_url).toBeNull()
    // h-2 omits archivo_url entirely on the wire — normalized to null.
    expect(result.historial[1]!.archivo_url).toBeNull()
  })
})
