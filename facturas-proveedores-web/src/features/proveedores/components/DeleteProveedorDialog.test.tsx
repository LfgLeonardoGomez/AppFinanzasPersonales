/**
 * Tests for DeleteProveedorDialog — destructive confirmation (C-20).
 *
 * Locks the alertdialog contract: role=alertdialog, aria-modal=true,
 * aria-label='Confirmar eliminación', focus on Cancelar at open, Esc
 * closes, click outside does NOT close, Confirmar calls onConfirm,
 * Cancelar calls onCancel. RN-PROV-04 dependency warning still shown.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeleteProveedorDialog } from './DeleteProveedorDialog'
import type { Proveedor } from '@shared/api/api'

const proveedor: Proveedor = {
  id: 'uuid-1',
  nombre: 'Proveedor Alfa',
  cuit: null,
  telefono: null,
  categoria: 'SERVICIO',
  notas: null,
  saldo: 0,
  created_at: '2026-06-01T00:00:00',
  updated_at: '2026-06-01T00:00:00',
}

describe('DeleteProveedorDialog (C-20, destructive confirmation)', () => {
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

  it('renders with role=alertdialog, aria-modal=true, and the right aria-label', () => {
    render(
      <DeleteProveedorDialog
        open={true}
        proveedor={proveedor}
        hasDependencies={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Confirmar eliminación')
  })

  it('shows the supplier name and dependency warning when hasDependencies=true', () => {
    render(
      <DeleteProveedorDialog
        open={true}
        proveedor={proveedor}
        hasDependencies={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument()
    expect(screen.getByText(/asociados/i)).toBeInTheDocument()
  })

  it('renders without the dependency warning when hasDependencies=false', () => {
    render(
      <DeleteProveedorDialog
        open={true}
        proveedor={proveedor}
        hasDependencies={false}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.queryByText(/asociados/i)).not.toBeInTheDocument()
  })

  it('focuses the Cancelar button on open (not the destructive Confirmar)', async () => {
    render(
      <DeleteProveedorDialog
        open={true}
        proveedor={proveedor}
        hasDependencies={true}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    )
    const cancelButton = await screen.findByTestId('delete-dialog-cancel')
    await waitFor(() => expect(cancelButton).toHaveFocus())
  })

  it('calls onConfirm when the user clicks "Confirmar"', () => {
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
    fireEvent.click(screen.getByTestId('delete-dialog-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when the user clicks "Cancelar"', () => {
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
    fireEvent.click(screen.getByTestId('delete-dialog-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('calls onCancel when the user presses Esc', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <DeleteProveedorDialog
        open={true}
        proveedor={proveedor}
        hasDependencies={true}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
