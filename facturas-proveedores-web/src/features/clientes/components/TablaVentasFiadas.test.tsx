/**
 * Tests for TablaVentasFiadas (C-36, design.md D3, tasks 7.5-7.7).
 *
 * A fiado is a `Venta` with `forma_pago = CUENTA_CORRIENTE` — it has no
 * `numero`, no `fecha_vencimiento`, no `origen` (unlike `FacturaConEstado`),
 * so this is a purpose-built table, not a generalization of
 * `TablaFacturasConEstado`.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TablaVentasFiadas } from './TablaVentasFiadas'
import type { VentaConEstado } from '@shared/api/api'

function fiado(overrides: Partial<VentaConEstado> = {}): VentaConEstado {
  return {
    id: 'venta-1',
    negocio_id: 'negocio-1',
    cliente_id: 'cliente-1',
    fecha: '2026-08-01',
    monto: 1000,
    forma_pago: 'CUENTA_CORRIENTE',
    notas: null,
    estado: 'PENDIENTE',
    created_at: '2026-08-01T10:00:00',
    updated_at: '2026-08-01T10:00:00',
    ...overrides,
  }
}

describe('TablaVentasFiadas — one row per fiado (task 7.5)', () => {
  it('renders date, amount and estado for each fiado', () => {
    const rows = [
      fiado({ id: 'v-1', estado: 'PENDIENTE' }),
      fiado({ id: 'v-2', estado: 'PARCIAL', monto: 500 }),
      fiado({ id: 'v-3', estado: 'COBRADA', monto: 200 }),
    ]
    render(<TablaVentasFiadas fiados={rows} />)

    const row1 = screen.getByTestId('venta-fiada-row-v-1')
    expect(within(row1).getByText(/2026-08-01/)).toBeInTheDocument()
    expect(within(row1).getByText('PENDIENTE')).toBeInTheDocument()

    expect(within(screen.getByTestId('venta-fiada-row-v-2')).getByText('PARCIAL')).toBeInTheDocument()
    expect(within(screen.getByTestId('venta-fiada-row-v-3')).getByText('COBRADA')).toBeInTheDocument()
  })

  it('each estado renders distinctly from the others (triangulation)', () => {
    const rows = [
      fiado({ id: 'v-1', estado: 'PENDIENTE' }),
      fiado({ id: 'v-2', estado: 'PARCIAL' }),
      fiado({ id: 'v-3', estado: 'COBRADA' }),
    ]
    render(<TablaVentasFiadas fiados={rows} />)
    const classes = ['v-1', 'v-2', 'v-3'].map(
      (id) => within(screen.getByTestId(`venta-fiada-row-${id}`)).getByTestId('venta-fiada-estado')
        .className,
    )
    expect(new Set(classes).size).toBe(3)
  })
})

describe('TablaVentasFiadas — no invoice columns (task 7.6)', () => {
  it('renders no invoice number, due date, or origin column', () => {
    render(<TablaVentasFiadas fiados={[fiado()]} />)
    expect(screen.queryByText(/número/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/vencimiento/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/origen/i)).not.toBeInTheDocument()
  })
})

describe('TablaVentasFiadas — empty state (task 7.7)', () => {
  it('an empty array renders an empty state, not an empty table', () => {
    render(<TablaVentasFiadas fiados={[]} />)
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
