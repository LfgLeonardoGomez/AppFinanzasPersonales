/**
 * C-39, task group 9 — ExportarCuentaCorriente (design.md D7, frontend spec).
 *
 * `exportFn` and `onDescargar` are injected so these tests never touch the
 * real Axios client or the browser download machinery (`URL.createObjectURL`
 * is not implemented in this project's jsdom test environment — verified
 * empirically while building `exportacionApi.ts`).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExportarCuentaCorriente } from './ExportarCuentaCorriente'
import type { ArchivoExportado } from '../api/exportacionApi'

function abrirFormulario() {
  fireEvent.click(screen.getByRole('button', { name: 'Exportar' }))
}

describe('ExportarCuentaCorriente — rango solo con historial (task 9.2)', () => {
  it('sin historial incluido, los controles de rango no están disponibles', () => {
    render(<ExportarCuentaCorriente exportFn={vi.fn()} />)
    abrirFormulario()

    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Hasta')).not.toBeInTheDocument()
  })

  it('al marcar incluir historial, los controles de rango aparecen vacíos', () => {
    render(<ExportarCuentaCorriente exportFn={vi.fn()} />)
    abrirFormulario()

    fireEvent.click(screen.getByLabelText('Incluir historial de movimientos'))

    expect(screen.getByLabelText('Desde')).toHaveValue('')
    expect(screen.getByLabelText('Hasta')).toHaveValue('')
  })
})

describe('ExportarCuentaCorriente — rango invertido no se envía (task 9.3)', () => {
  it('con desde posterior a hasta, señala el error y no llama a exportFn', () => {
    const exportFn = vi.fn()
    render(<ExportarCuentaCorriente exportFn={exportFn} />)
    abrirFormulario()
    fireEvent.click(screen.getByLabelText('Incluir historial de movimientos'))

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-02-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/no puede ser posterior/i)
    expect(exportFn).not.toHaveBeenCalled()
  })

  it('triangulación: un rango en orden correcto sí llama a exportFn', async () => {
    const archivo: ArchivoExportado = { blob: new Blob(['x']), filename: 'x.pdf' }
    const exportFn = vi.fn().mockResolvedValue(archivo)
    const onDescargar = vi.fn()
    render(<ExportarCuentaCorriente exportFn={exportFn} onDescargar={onDescargar} />)
    abrirFormulario()
    fireEvent.click(screen.getByLabelText('Incluir historial de movimientos'))

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-01' } })
    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-02-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))

    await waitFor(() => expect(exportFn).toHaveBeenCalledTimes(1))
    expect(exportFn).toHaveBeenCalledWith({
      formato: 'pdf',
      incluirHistorial: true,
      desde: '2026-01-01',
      hasta: '2026-02-01',
    })
  })
})

describe('ExportarCuentaCorriente — mientras genera, avisa (task 9.4)', () => {
  it('indica que está en curso y no se puede disparar de nuevo', async () => {
    let resolver: (archivo: ArchivoExportado) => void = () => {}
    const exportFn = vi.fn(
      () => new Promise<ArchivoExportado>((resolve) => { resolver = resolve }),
    )
    render(<ExportarCuentaCorriente exportFn={exportFn} onDescargar={vi.fn()} />)
    abrirFormulario()

    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))

    expect(await screen.findByRole('status')).toHaveTextContent(/generando/i)
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Generando/ })).toBeDisabled()

    resolver({ blob: new Blob(['x']), filename: 'x.pdf' })
    await waitFor(() => expect(exportFn).toHaveBeenCalledTimes(1))
  })
})

describe('ExportarCuentaCorriente — el 422 explica cómo seguir (task 9.5)', () => {
  it('muestra el motivo informado por el backend, no un error genérico', async () => {
    const axiosLikeError = {
      isAxiosError: true,
      response: {
        status: 422,
        data: new Blob(
          [
            JSON.stringify({
              detail: {
                mensaje: 'La cuenta tiene 900 movimientos, que supera el tope de 500. Acotá el rango.',
                cantidad_movimientos: 900,
                sugerencia: 'Acotá el rango de fechas.',
              },
            }),
          ],
          { type: 'application/json' },
        ),
      },
    }
    const exportFn = vi.fn().mockRejectedValue(axiosLikeError)
    render(<ExportarCuentaCorriente exportFn={exportFn} />)
    abrirFormulario()

    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent('900 movimientos')
    expect(alerta).toHaveTextContent(/acot/i)
  })
})

describe('ExportarCuentaCorriente — tras una falla, la acción vuelve a estar disponible (task 9.6)', () => {
  it('reactiva el disparador y conserva las opciones elegidas', async () => {
    const exportFn = vi.fn().mockRejectedValue(new Error('network down'))
    render(<ExportarCuentaCorriente exportFn={exportFn} />)
    abrirFormulario()
    fireEvent.click(screen.getByLabelText('Incluir historial de movimientos'))
    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-01-01' } })

    fireEvent.click(screen.getByRole('button', { name: 'Descargar' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Exportar' })).not.toBeDisabled())
    expect(screen.getByRole('button', { name: 'Descargar' })).not.toBeDisabled()
    // Las opciones elegidas siguen intactas.
    expect(screen.getByLabelText('Incluir historial de movimientos')).toBeChecked()
    expect(screen.getByLabelText('Desde')).toHaveValue('2026-01-01')
  })
})
