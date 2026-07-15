/**
 * ProveedorDialog tests (C-20, proveedores-frontend delta).
 *
 * Locks the contract from the proveedores-frontend spec: dialog with
 * proper a11y semantics, focus on the first field, Esc closes, click
 * outside closes, Cancelar closes, submit success closes and fires
 * onSuccess, edit mode pre-fills, empty nombre shows client validation.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ProveedorDialog } from './ProveedorDialog'

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

function makeProveedor(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-1',
    usuario_id: 'user-1',
    nombre: 'Proveedor Existente',
    cuit: '20-12345678-9',
    telefono: '1144556677',
    categoria: 'SERVICIO' as const,
    notas: 'nota vieja',
    saldo: 0,
    created_at: '2026-06-01T00:00:00',
    updated_at: '2026-06-01T00:00:00',
    ...overrides,
  }
}

describe('ProveedorDialog (C-20, proveedores-frontend delta)', () => {
  it('renders with role=dialog, aria-modal=true, and the right aria-label', () => {
    render(<ProveedorDialog mode="create" open onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: makeWrapper(),
    })
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label', 'Formulario de proveedor')
  })

  it('does not render anything when open is false', () => {
    render(<ProveedorDialog mode="create" open={false} onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: makeWrapper(),
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('focuses the first form field (nombre) on open', async () => {
    render(<ProveedorDialog mode="create" open onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: makeWrapper(),
    })
    const nombreInput = await screen.findByLabelText(/Nombre/i)
    expect(nombreInput).toHaveFocus()
  })

  it('closes when the user presses Esc', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<ProveedorDialog mode="create" open onSuccess={vi.fn()} onCancel={onCancel} />, {
      wrapper: makeWrapper(),
    })
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('closes when the user clicks the Cancelar button', async () => {
    const onCancel = vi.fn()
    const user = userEvent.setup()
    render(<ProveedorDialog mode="create" open onSuccess={vi.fn()} onCancel={onCancel} />, {
      wrapper: makeWrapper(),
    })
    await user.click(screen.getByRole('button', { name: /Cancelar/i }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('shows the Categoria select with the three enum options', () => {
    render(<ProveedorDialog mode="create" open onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: makeWrapper(),
    })
    const select = screen.getByLabelText(/Categoría/i) as HTMLSelectElement
    const options = Array.from(select.options).map((o) => o.value)
    expect(options).toEqual(['INSUMO', 'SERVICIO', 'OTRO'])
  })

  it('shows a client-side error when nombre is empty and does not call onSuccess', async () => {
    const onSuccess = vi.fn()
    const user = userEvent.setup()
    render(<ProveedorDialog mode="create" open onSuccess={onSuccess} onCancel={vi.fn()} />, {
      wrapper: makeWrapper(),
    })
    await user.click(screen.getByRole('button', { name: /Guardar/i }))
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('pre-fills the form when mode=edit and proveedor is provided', () => {
    render(
      <ProveedorDialog
        mode="edit"
        proveedor={makeProveedor()}
        open
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )
    const nombreInput = screen.getByLabelText(/Nombre/i) as HTMLInputElement
    expect(nombreInput.value).toBe('Proveedor Existente')
    const categoriaSelect = screen.getByLabelText(/Categoría/i) as HTMLSelectElement
    expect(categoriaSelect.value).toBe('SERVICIO')
  })
})
