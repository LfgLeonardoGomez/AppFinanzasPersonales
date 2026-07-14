/**
 * Tests for DeleteProveedorDialog — confirmation modal for supplier deletion.
 * Covers RN-PROV-04: show confirmation when tiene_dependencias=true.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { DeleteProveedorDialog } from './DeleteProveedorDialog'
import type { Proveedor } from '@shared/api/api'

const proveedor: Proveedor = {
  id: 'uuid-1',
  usuario_id: 'user-1',
  nombre: 'Proveedor Alfa',
  cuit: null,
  telefono: null,
  categoria: 'SERVICIO',
  notas: null,
  saldo: 0,
  created_at: '2026-06-01T00:00:00',
  updated_at: '2026-06-01T00:00:00',
}

describe('DeleteProveedorDialog', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <DeleteProveedorDialog
        open={false}
        proveedor={proveedor}
        hasDependencies={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows supplier name and dependency warning when open=true and hasDependencies=true', () => {
    render(
      <DeleteProveedorDialog
        open={true}
        proveedor={proveedor}
        hasDependencies={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument()
    expect(screen.getByText(/asociados/i)).toBeInTheDocument()
  })

  it('renders without dependency warning when hasDependencies=false', () => {
    render(
      <DeleteProveedorDialog
        open={true}
        proveedor={proveedor}
        hasDependencies={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText(/asociados/i)).not.toBeInTheDocument()
  })

  it('calls onConfirm when user clicks "Confirmar"', () => {
    const onConfirm = vi.fn()
    render(
      <DeleteProveedorDialog
        open={true}
        proveedor={proveedor}
        hasDependencies={true}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onCancel when user clicks "Cancelar"', () => {
    const onCancel = vi.fn()
    render(
      <DeleteProveedorDialog
        open={true}
        proveedor={proveedor}
        hasDependencies={true}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
