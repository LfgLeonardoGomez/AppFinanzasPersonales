/**
 * Tests for the shared HistorialTable (C-36, design.md D2, tasks 3.2-3.5).
 *
 * This is the generalized extraction of the supplier's `HistorialCronologico`
 * (C-13/C-24), parameterized over the row's `tipo` vocabulary via a config
 * map. It carries forward the exact contracts the supplier suite pins —
 * `HistorialCronologico.test.tsx` is not edited; this file is the new
 * consumer-agnostic test surface.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { HistorialTable, type HistorialTableRow, type HistorialTipoConfig } from './HistorialTable'

const CONFIG: Record<string, HistorialTipoConfig> = {
  DEBE: { label: 'Debe', lado: 'debe', archivoTitulo: 'Archivo de debe' },
  HABER: { label: 'Haber', lado: 'haber', archivoTitulo: 'Archivo de haber' },
}

const r1: HistorialTableRow = {
  id: 'row-1',
  tipo: 'DEBE',
  fecha: '2026-06-01',
  monto: 1000,
  saldo_acumulado: 1000,
}
const r2: HistorialTableRow = {
  id: 'row-2',
  tipo: 'HABER',
  fecha: '2026-06-10',
  monto: 300,
  saldo_acumulado: 700,
}
const r3: HistorialTableRow = {
  id: 'row-3',
  tipo: 'DEBE',
  fecha: '2026-06-20',
  monto: 500,
  saldo_acumulado: 1200,
}

describe('HistorialTable — row rendering and order (task 3.2)', () => {
  it('renders one row per entry, in the order given, with the exact test-id contracts', () => {
    render(<HistorialTable historial={[r1, r2, r3]} tipoConfig={CONFIG} />)

    expect(screen.getByTestId('historial-row-row-1')).toBeInTheDocument()
    expect(screen.getByTestId('historial-row-row-2')).toBeInTheDocument()
    expect(screen.getByTestId('historial-row-row-3')).toBeInTheDocument()

    const rows = ['row-1', 'row-2', 'row-3'].map((id) => screen.getByTestId(`historial-row-${id}`))
    for (let i = 0; i < rows.length - 1; i++) {
      const pos = rows[i]!.compareDocumentPosition(rows[i + 1]!)
      expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('each row carries a chip with data-tipo and a saldo_acumulado test-id', () => {
    render(<HistorialTable historial={[r1]} tipoConfig={CONFIG} />)
    const row = screen.getByTestId('historial-row-row-1')
    expect(within(row).getByTestId('historial-chip').dataset.tipo).toBe('DEBE')
    expect(within(row).getByTestId('historial-saldo-acumulado')).toBeInTheDocument()
  })
})

describe('HistorialTable — config-driven vocabulary (task 3.3)', () => {
  it("the chip's label comes from the caller's config map, not a hard-coded vocabulary", () => {
    render(<HistorialTable historial={[r1, r2]} tipoConfig={CONFIG} />)
    const row1 = screen.getByTestId('historial-row-row-1')
    const row2 = screen.getByTestId('historial-row-row-2')
    expect(within(row1).getByTestId('historial-chip').textContent).toBe('Debe')
    expect(within(row2).getByTestId('historial-chip').textContent).toBe('Haber')
  })

  it('a different config map produces different chip labels for the same tipo key (triangulation)', () => {
    const otherConfig: Record<string, HistorialTipoConfig> = {
      DEBE: { label: 'Cargo', lado: 'debe', archivoTitulo: 'Comprobante' },
      HABER: { label: 'Abono', lado: 'haber', archivoTitulo: 'Recibo' },
    }
    render(<HistorialTable historial={[r1]} tipoConfig={otherConfig} />)
    expect(screen.getByTestId('historial-chip').textContent).toBe('Cargo')
  })

  it("the attachment dialog's title comes from the config map, keyed by the row's tipo", () => {
    const conArchivo: HistorialTableRow = { ...r2, archivo_url: 'https://res.cloudinary.com/demo/x.jpg' }
    render(<HistorialTable historial={[conArchivo]} tipoConfig={CONFIG} />)
    fireEvent.click(screen.getByRole('button', { name: /ver archivo/i }))
    expect(screen.getByText('Archivo de haber')).toBeInTheDocument()
  })
})

describe('HistorialTable — empty state (task 3.4)', () => {
  it('an empty array renders the empty message with role="status"', () => {
    render(<HistorialTable historial={[]} tipoConfig={CONFIG} />)
    const status = screen.getByRole('status')
    expect(status.textContent).toMatch(/sin movimientos registrados/i)
    expect(screen.queryByTestId(/^historial-row-/)).not.toBeInTheDocument()
  })
})

describe('HistorialTable — attachment affordance (task 3.5)', () => {
  it('a row with an attachment exposes a way to open it', () => {
    const conArchivo: HistorialTableRow = { ...r1, archivo_url: 'https://res.cloudinary.com/demo/x.jpg' }
    render(<HistorialTable historial={[conArchivo]} tipoConfig={CONFIG} />)
    const row = screen.getByTestId('historial-row-row-1')
    expect(within(row).getByRole('button', { name: /ver archivo/i })).toBeInTheDocument()
  })

  it('a row without an attachment does not', () => {
    const sinArchivo: HistorialTableRow = { ...r1, archivo_url: null }
    render(<HistorialTable historial={[sinArchivo]} tipoConfig={CONFIG} />)
    const row = screen.getByTestId('historial-row-row-1')
    expect(within(row).queryByRole('button', { name: /ver archivo/i })).not.toBeInTheDocument()
  })
})
