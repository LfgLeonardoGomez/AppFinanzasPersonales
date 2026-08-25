/**
 * C-39, task group 8 — the export API layer (design.md D7).
 *
 * Pure transport tests: request shape (params, responseType), the returned
 * blob/filename are exactly what the backend sent, and the 422 "too many
 * movements" detail can be recovered even though it arrives as a Blob
 * (responseType: 'blob' applies to error responses too).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { apiClient } from '@shared/api/client'
import {
  exportarCuentaCorrienteProveedor,
  exportarCuentaCorrienteCliente,
  extraerDetalleErrorExport,
} from './exportacionApi'

afterEach(() => {
  vi.restoreAllMocks()
})

function fakeBlob(content = 'fake-bytes'): Blob {
  return new Blob([content], { type: 'application/pdf' })
}

function mockGet(data: Blob, headers: Record<string, string> = {}) {
  return vi.spyOn(apiClient, 'get').mockResolvedValue({
    data,
    headers,
    status: 200,
    statusText: 'OK',
    config: {},
  })
}

describe('exportarCuentaCorrienteProveedor — transporte, sin transformar contenido', () => {
  it('pide el archivo como blob y no transforma su contenido', async () => {
    const blob = fakeBlob()
    const spy = mockGet(blob, {
      'content-disposition': 'attachment; filename="cuenta-corriente-x-2026-08-25.pdf"',
    })

    const resultado = await exportarCuentaCorrienteProveedor('prov-1', { formato: 'pdf' })

    expect(spy).toHaveBeenCalledWith(
      '/proveedores/prov-1/cuenta-corriente/export',
      expect.objectContaining({ responseType: 'blob' }),
    )
    // Mismo objeto Blob devuelto — no se reconstruye ni se reformatea.
    expect(resultado.blob).toBe(blob)
  })

  it('usa el nombre de archivo que indica el backend, no uno compuesto en el cliente', async () => {
    mockGet(fakeBlob(), {
      'content-disposition': 'attachment; filename="cuenta-corriente-ferreteria-2026-08-25.xlsx"',
    })

    const resultado = await exportarCuentaCorrienteProveedor('prov-1', { formato: 'xlsx' })

    expect(resultado.filename).toBe('cuenta-corriente-ferreteria-2026-08-25.xlsx')
  })

  it('sin rango no manda desde/hasta', async () => {
    const spy = mockGet(fakeBlob())

    await exportarCuentaCorrienteProveedor('prov-1', { formato: 'pdf' })

    const config = spy.mock.calls[0]?.[1] as { params: Record<string, unknown> }
    expect(config.params).not.toHaveProperty('desde')
    expect(config.params).not.toHaveProperty('hasta')
  })

  it('triangulación: con rango completo, manda desde/hasta e incluir_historial', async () => {
    const spy = mockGet(fakeBlob())

    await exportarCuentaCorrienteProveedor('prov-1', {
      formato: 'pdf',
      incluirHistorial: true,
      desde: '2026-01-01',
      hasta: '2026-01-31',
    })

    const config = spy.mock.calls[0]?.[1] as { params: Record<string, unknown> }
    expect(config.params).toMatchObject({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      incluir_historial: true,
    })
  })
})

describe('exportarCuentaCorrienteCliente — misma transporte, endpoint de cliente', () => {
  it('pega al endpoint de clientes, no al de proveedores', async () => {
    const spy = mockGet(fakeBlob(), { 'content-disposition': 'attachment; filename="x.pdf"' })

    await exportarCuentaCorrienteCliente('cli-1', { formato: 'pdf' })

    expect(spy).toHaveBeenCalledWith(
      '/clientes/cli-1/cuenta-corriente/export',
      expect.objectContaining({ responseType: 'blob' }),
    )
  })
})

describe('extraerDetalleErrorExport — recupera el detail de un error con blob (422)', () => {
  it('extrae mensaje, cantidad_movimientos y sugerencia', async () => {
    const blobBody = new Blob(
      [
        JSON.stringify({
          detail: {
            mensaje: 'La cuenta tiene 900 movimientos, que supera el tope de 500.',
            cantidad_movimientos: 900,
            sugerencia: 'Acotá el rango de fechas.',
          },
        }),
      ],
      { type: 'application/json' },
    )
    const error = { isAxiosError: true, response: { status: 422, data: blobBody } }

    const detalle = await extraerDetalleErrorExport(error)

    expect(detalle?.cantidad_movimientos).toBe(900)
    expect(detalle?.sugerencia).toContain('Acotá')
  })

  it('triangulación: un error sin response (network error) devuelve null', async () => {
    const error = { isAxiosError: true, response: undefined }
    const detalle = await extraerDetalleErrorExport(error)
    expect(detalle).toBeNull()
  })

  it('un error que no es de axios devuelve null', async () => {
    const detalle = await extraerDetalleErrorExport(new Error('boom'))
    expect(detalle).toBeNull()
  })
})
