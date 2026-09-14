/**
 * Tests for the estadísticas error message (C-38, task 5.3).
 *
 * The cap 422 is the case that matters. It is not a failure — it is the
 * backend explaining how to ask correctly — so the copy has to name the
 * problem AND the correction. Rendering it as "something went wrong" would
 * turn an actionable instruction into a dead end.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AxiosError, AxiosHeaders } from 'axios'
import { EstadisticasError } from './EstadisticasError'

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

const topeExcedido = axiosErrorWith(422, {
  mensaje: 'El rango pedido produciría 732 períodos, por encima del tope de 400.',
  periodos_estimados: 732,
  tope: 400,
  sugerencia: 'Usá una granularidad más gruesa o un rango más corto.',
})

describe('EstadisticasError — tope excedido', () => {
  it('explains that the range is too large for the chosen granularity', () => {
    render(<EstadisticasError error={topeExcedido} />)

    expect(screen.getByRole('alert')).toHaveTextContent(/rango.*(grande|amplio)/i)
  })

  it('states the corrective action: shrink the range or use a coarser granularity', () => {
    render(<EstadisticasError error={topeExcedido} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/granularidad/i)
    expect(alert.textContent).toMatch(/acort|reduc|achic|más corto|más grueso|mayor/i)
  })

  it('shows the numbers the backend sent, so "too big" is quantified', () => {
    render(<EstadisticasError error={topeExcedido} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/732/)
    expect(alert).toHaveTextContent(/400/)
  })

  it('does NOT present it as an unexpected failure', () => {
    render(<EstadisticasError error={topeExcedido} />)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).not.toMatch(/inesperad|salió mal|error del servidor|intentá de nuevo/i)
  })
})

describe('EstadisticasError — other cases', () => {
  it('reports an inverted range as invalid, not as an unexpected failure', () => {
    render(
      <EstadisticasError error={axiosErrorWith(422, '`desde` no puede ser posterior a `hasta`.')} />,
    )

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(/rango/i)
    expect(alert.textContent).not.toMatch(/inesperad/i)
  })

  it('falls back to a generic message on an unknown failure', () => {
    render(<EstadisticasError error={axiosErrorWith(500, 'boom')} />)

    expect(screen.getByRole('alert')).toBeInTheDocument()
  })

  it('a 404 falls back to the generic message and offers NO supplier diagnostic (C-44)', () => {
    // `proveedor-inexistente` retired alongside `PanelComprasProveedor` — the
    // two endpoints still consumed here (`/ventas`, `/resumen`) never
    // receive `proveedor_id`, so a "this supplier does not exist" message
    // would be a claim about something the request never asked for.
    render(<EstadisticasError error={axiosErrorWith(404, 'Not Found')} />)

    const alert = screen.getByRole('alert')
    expect(alert).toBeInTheDocument()
    expect(alert.textContent).not.toMatch(/proveedor/i)
  })
})
