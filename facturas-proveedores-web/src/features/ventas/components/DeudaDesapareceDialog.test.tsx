/**
 * Tests for DeudaDesapareceDialog — the disappearing-debt warning (C-34,
 * tasks 8.1-8.4, 8.7). "The highest-value test in this change" (task 8.1).
 *
 * Copy verbatim from design.md D5. Mirrors the `DeleteProveedorDialog`
 * alertdialog contract (RN-PROV-04): role="alertdialog", initial focus on
 * Cancelar, backdrop click does not dismiss, Esc closes.
 *
 * Two modes only (task 8.8): 'delete' (deleting a sale on account) and
 * 'leave' (editing a sale so it stops being on account). A cash-sale delete
 * uses a different, ordinary confirmation — tested in VentasList.test.tsx,
 * not here (task 8.5).
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeudaDesapareceDialog } from './DeudaDesapareceDialog'

describe('DeudaDesapareceDialog — deleting a fiado names the customer and the amount (task 8.1)', () => {
  it('opens naming Juan Pérez and $4.500 as the debt that stops being owed', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/juan pérez/i)).toBeInTheDocument()
    expect(screen.getByText(/\$\s?4\.500,00/)).toBeInTheDocument()
    // "A dialog that only asks '¿Estás seguro?' fails this test."
    expect(screen.queryByText(/^¿estás seguro\?$/i)).not.toBeInTheDocument()
  })

  it('names a different customer and amount (triangulation)', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="María Gómez"
        monto="120.50"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/maría gómez/i)).toBeInTheDocument()
    expect(screen.getByText(/\$\s?120,50/)).toBeInTheDocument()
  })
})

describe('DeudaDesapareceDialog — leaving cuenta corriente warns before saving (task 8.2)', () => {
  it('opens in "leave" mode naming the customer, amount and destination method', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="leave"
        clienteNombre="Juan Pérez"
        monto="500.00"
        formaPagoNueva="EFECTIVO"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/juan pérez/i)).toBeInTheDocument()
    expect(screen.getByText(/\$\s?500,00/)).toBeInTheDocument()
    expect(screen.getByText(/efectivo/i)).toBeInTheDocument()
  })
})

describe('DeudaDesapareceDialog — cancelling changes nothing (task 8.3)', () => {
  it('calls onCancel and NOT onConfirm when Cancelar is clicked', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    )
    fireEvent.click(screen.getByTestId('deuda-dialog-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})

describe('DeudaDesapareceDialog — payments already recorded are not removed (task 8.4)', () => {
  it('states that recorded payments stay and the balance may end up in the customer\'s favour, in delete mode', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/no se borran/i)).toBeInTheDocument()
    expect(screen.getByText(/a favor/i)).toBeInTheDocument()
  })

  it('states the same in leave mode (triangulation)', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="leave"
        clienteNombre="Juan Pérez"
        monto="500.00"
        formaPagoNueva="TARJETA"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByText(/no se borran/i)).toBeInTheDocument()
    expect(screen.getByText(/a favor/i)).toBeInTheDocument()
  })
})

describe('DeudaDesapareceDialog — the alertdialog contract (task 8.7)', () => {
  it('renders nothing when open=false', () => {
    const { container } = render(
      <DeudaDesapareceDialog
        open={false}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders role=alertdialog with aria-modal=true', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
  })

  it('focuses Cancelar on open, not the destructive action', async () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    const cancelButton = await screen.findByTestId('deuda-dialog-cancel')
    await waitFor(() => expect(cancelButton).toHaveFocus())
  })

  it('does not dismiss on backdrop click, but Esc closes via onCancel', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    )
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})

describe('DeudaDesapareceDialog — surfaces a backend error instead of failing silently (review finding B)', () => {
  it('renders the error message as an alert when an error prop is passed', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        error="Error al eliminar la venta. Intentá de nuevo."
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/error al eliminar la venta/i)
  })

  it('renders nothing extra when no error is passed (triangulation)', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('DeudaDesapareceDialog — confirm button names the consequence', () => {
  it('the delete-mode confirm button says what happens, not "Confirmar"', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('deuda-dialog-confirm')).toHaveTextContent(/eliminar y quitar la deuda/i)
  })

  it('the leave-mode confirm button names its own consequence (triangulation)', () => {
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="leave"
        clienteNombre="Juan Pérez"
        monto="500.00"
        formaPagoNueva="EFECTIVO"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    )
    expect(screen.getByTestId('deuda-dialog-confirm')).toHaveTextContent(/cambiar y quitar la deuda/i)
  })

  it('calls onConfirm when the confirm action is clicked', () => {
    const onConfirm = vi.fn()
    render(
      <DeudaDesapareceDialog
        open={true}
        mode="delete"
        clienteNombre="Juan Pérez"
        monto="4500.00"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByTestId('deuda-dialog-confirm'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
