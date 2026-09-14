/**
 * Tests for the estadísticas error classifier (C-38, tasks 5.1-5.2).
 *
 * The backend emits the distinction natively: the period-cap 422 carries a
 * structured OBJECT detail, the inverted-range 422 carries a plain STRING.
 * Classifying on that shape difference — rather than on the Spanish prose —
 * is what keeps this from breaking the day someone fixes an accent in the
 * backend's message.
 */
import { describe, it, expect } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import { clasificarErrorEstadisticas } from './clasificarError'

function axiosErrorWith(status: number, detail: unknown): AxiosError {
  const err = new AxiosError('request failed')
  err.response = {
    status,
    statusText: '',
    data: { detail },
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  }
  return err
}

describe('clasificarErrorEstadisticas', () => {
  it('classifies a 422 with an OBJECT detail as tope-excedido, keeping its numbers', () => {
    const result = clasificarErrorEstadisticas(
      axiosErrorWith(422, {
        mensaje: 'El rango pedido produciría 732 períodos, por encima del tope de 400.',
        periodos_estimados: 732,
        tope: 400,
        sugerencia: 'Usá una granularidad más gruesa o un rango más corto.',
      }),
    )

    expect(result.tipo).toBe('tope-excedido')
    if (result.tipo === 'tope-excedido') {
      expect(result.periodosEstimados).toBe(732)
      expect(result.tope).toBe(400)
    }
  })

  it('classifies a 422 with a STRING detail as rango-invertido', () => {
    const result = clasificarErrorEstadisticas(
      axiosErrorWith(422, '`desde` no puede ser posterior a `hasta`.'),
    )

    expect(result.tipo).toBe('rango-invertido')
  })

  it('classifies a 404 as desconocido (C-44)', () => {
    // The `proveedor-inexistente` classification retired with
    // `PanelComprasProveedor` — the only caller that ever sent
    // `proveedor_id`. The two endpoints still consumed (`/ventas`,
    // `/resumen`) never receive one, so a 404 here is not a case the
    // classifier specifically recognizes.
    const result = clasificarErrorEstadisticas(axiosErrorWith(404, 'Not Found'))

    expect(result.tipo).toBe('desconocido')
  })

  it('classifies a 500 as desconocido', () => {
    const result = clasificarErrorEstadisticas(axiosErrorWith(500, 'boom'))

    expect(result.tipo).toBe('desconocido')
  })

  it('classifies a non-Axios error as desconocido', () => {
    const result = clasificarErrorEstadisticas(new Error('parseEstadisticas: malformed Decimal'))

    expect(result.tipo).toBe('desconocido')
  })

  it('classifies null as desconocido', () => {
    expect(clasificarErrorEstadisticas(null).tipo).toBe('desconocido')
  })

  it('does NOT read the Spanish prose to decide — a 422 object detail wins on shape alone', () => {
    // Same status, same structural shape, completely different wording (and
    // no accents at all). If the classifier were matching text, this would
    // fall through to `desconocido`.
    const result = clasificarErrorEstadisticas(
      axiosErrorWith(422, {
        mensaje: 'anything at all',
        periodos_estimados: 401,
        tope: 400,
        sugerencia: '',
      }),
    )

    expect(result.tipo).toBe('tope-excedido')
  })

  it('falls back to desconocido on a 422 whose object detail is not the tope shape', () => {
    // FastAPI's own validation errors are 422 with an ARRAY detail. An array
    // is an object to `typeof`, so shape-checking has to be more specific
    // than "not a string" or a plain validation error would be reported to
    // the user as "your range is too big".
    const result = clasificarErrorEstadisticas(
      axiosErrorWith(422, [{ loc: ['query', 'desde'], msg: 'invalid date', type: 'date_parsing' }]),
    )

    expect(result.tipo).toBe('desconocido')
  })
})
