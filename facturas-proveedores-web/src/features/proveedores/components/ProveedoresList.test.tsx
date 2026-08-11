/**
 * Tests for ProveedoresList component.
 * MSW intercepts all /api/proveedores calls — no real backend.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import ProveedoresList from './ProveedoresList'
import type { ProveedorListItem, ProveedorDeleteResponse } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockPage1: ProveedorListItem[] = [
  {
    id: 'uuid-1',
    nombre: 'Proveedor Alfa',
    cuit: null,
    telefono: null,
    categoria: 'SERVICIO',
    notas: null,
    saldo: 2500.0,
    created_at: '2026-06-01T00:00:00',
    updated_at: '2026-06-01T00:00:00',
  },
  {
    id: 'uuid-2',
    nombre: 'Proveedor Beta',
    cuit: '20-99887766-5',
    telefono: null,
    categoria: 'OTRO',
    notas: null,
    saldo: 0,
    created_at: '2026-06-02T00:00:00',
    updated_at: '2026-06-02T00:00:00',
  },
]

const noDependenciesResponse: ProveedorDeleteResponse = {
  id: 'uuid-2',
  tiene_dependencias: false,
}

const hasDependenciesResponse: ProveedorDeleteResponse = {
  id: 'uuid-1',
  tiene_dependencias: true,
}

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/proveedores', () => HttpResponse.json(mockPage1)),
  http.delete('/api/proveedores/uuid-2', () =>
    HttpResponse.json(noDependenciesResponse),
  ),
  http.delete('/api/proveedores/uuid-1', () =>
    HttpResponse.json(hasDependenciesResponse),
  ),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Wrapper ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProveedoresList', () => {
  it('renders supplier names and formatted saldo', async () => {
    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())
    expect(screen.getByText('Proveedor Beta')).toBeInTheDocument()
    // Saldo displayed — formatted as ARS currency or at minimum as a number
    expect(screen.getByText(/2\.500|2,500/)).toBeInTheDocument()
  })

  it('shows "Nuevo proveedor" button', async () => {
    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /nuevo proveedor/i })).toBeInTheDocument()
  })

  it('calls onNewProveedor when "Nuevo proveedor" is clicked', async () => {
    const onNew = vi.fn()
    render(<ProveedoresList onNewProveedor={onNew} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /nuevo proveedor/i }))
    expect(onNew).toHaveBeenCalledOnce()
  })

  it('shows sort controls', async () => {
    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())
    // Sort controls — buttons or select for nombre/saldo
    expect(screen.getByRole('button', { name: /nombre/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /saldo/i })).toBeInTheDocument()
  })

  it('renders empty state when no suppliers', async () => {
    server.use(
      http.get('/api/proveedores', () => HttpResponse.json([])),
    )
    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() =>
      expect(screen.getByText(/no hay proveedores/i)).toBeInTheDocument(),
    )
  })

  it('clicking Eliminar on any supplier opens the confirmation dialog (c-18 FE-008)', async () => {
    // C-18 (FE-008): the dialog opens for ALL deletes, not just
    // suppliers with dependencies. The previous behavior (delete
    // proceeds silently for suppliers without dependencias) was
    // replaced with the safer always-confirm flow.
    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Beta')).toBeInTheDocument())
    // Click eliminar for Beta (uuid-2, no dependencies)
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar/i })
    const betaDeleteBtn = deleteButtons[1]
    if (!betaDeleteBtn) throw new Error('Beta delete button not found')
    fireEvent.click(betaDeleteBtn)
    // Dialog now opens for ALL deletes (regression-guard for the
    // pre-fix code that only opened it for suppliers with dependencies).
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
  })

  it('clicking Eliminar on supplier with dependencies opens the confirmation dialog (c-18 FE-008)', async () => {
    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())
    // Click eliminar for Alfa (uuid-1, has dependencies)
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar/i })
    const alfaDeleteBtn = deleteButtons[0]
    if (!alfaDeleteBtn) throw new Error('Alfa delete button not found')
    fireEvent.click(alfaDeleteBtn)
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
  })

  // ── C-13: "Ver cuenta corriente" link per row ─────────────────────────────
  it('renders a "Ver cuenta corriente" link on each row whose href is /proveedores/{id}', async () => {
    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())
    const allLinks = screen.getAllByRole('link', { name: /ver cuenta corriente/i })
    expect(allLinks).toHaveLength(2)
    expect(allLinks[0]).toHaveAttribute('href', '/proveedores/uuid-1')
    expect(allLinks[1]).toHaveAttribute('href', '/proveedores/uuid-2')
  })

  it('the "Ver cuenta corriente" link does not replace the Editar / Eliminar controls', async () => {
    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())
    // Both Editar and Eliminar buttons are still present (2 rows × 2 buttons = 4)
    expect(screen.getAllByRole('button', { name: /editar/i })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: /eliminar/i }).length).toBeGreaterThanOrEqual(2)
  })
})

// ── C-18 (FE-008): the delete confirmation dialog MUST appear BEFORE the
// DELETE mutation fires. The pre-fix code called the mutation on click and
// only opened the dialog when the response said tiene_dependencias=true.
// The expected flow is: click delete → see dialog → confirm → DELETE.

describe('ProveedoresList — FE-008 delete confirmation before mutation', () => {
  it('opens the confirmation dialog on Eliminar click and does NOT call the mutation yet', async () => {
    // Spy on the fetch calls — if the mutation fires, we'll see a DELETE
    // request to /api/proveedores/uuid-1. With the fix, NO DELETE
    // request should be made before the user confirms.
    const deleteRequests: string[] = []
    server.use(
      http.delete('/api/proveedores/uuid-1', () => {
        deleteRequests.push('uuid-1')
        return HttpResponse.json(noDependenciesResponse)
      }),
      http.delete('/api/proveedores/uuid-2', () => {
        deleteRequests.push('uuid-2')
        return HttpResponse.json(hasDependenciesResponse)
      }),
    )

    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())

    // Click Eliminar on Alfa
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar/i })
    const alfaDeleteBtn = deleteButtons[0]
    if (!alfaDeleteBtn) throw new Error('Alfa delete button not found')
    fireEvent.click(alfaDeleteBtn)

    // Dialog opens
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    // No DELETE fired yet
    expect(deleteRequests).toEqual([])
  })

  it('fires the mutation only after the user confirms in the dialog', async () => {
    const deleteRequests: string[] = []
    server.use(
      http.delete('/api/proveedores/uuid-1', () => {
        deleteRequests.push('uuid-1')
        return HttpResponse.json(noDependenciesResponse)
      }),
    )

    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())

    // Click Eliminar on Alfa
    const deleteButtons = screen.getAllByRole('button', { name: /eliminar/i })
    const alfaDeleteBtn = deleteButtons[0]
    if (!alfaDeleteBtn) throw new Error('Alfa delete button not found')
    fireEvent.click(alfaDeleteBtn)

    // Dialog opens, no DELETE yet
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    expect(deleteRequests).toEqual([])

    // Click Confirmar
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }))
    await waitFor(() => expect(deleteRequests).toEqual(['uuid-1']))
  })

  it('does NOT fire the mutation if the user cancels in the dialog', async () => {
    const deleteRequests: string[] = []
    server.use(
      http.delete('/api/proveedores/uuid-1', () => {
        deleteRequests.push('uuid-1')
        return HttpResponse.json(noDependenciesResponse)
      }),
    )

    render(<ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />, {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument())

    const deleteButtons = screen.getAllByRole('button', { name: /eliminar/i })
    const alfaDeleteBtn = deleteButtons[0]
    if (!alfaDeleteBtn) throw new Error('Alfa delete button not found')
    fireEvent.click(alfaDeleteBtn)

    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
    // Click Cancelar
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))

    // Dialog dismissed, no DELETE fired
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteRequests).toEqual([])
  })
})
