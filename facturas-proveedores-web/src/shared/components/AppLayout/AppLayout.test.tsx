/**
 * Tests for AppLayout's navigation (C-30).
 *
 * Only one thing here needs proving, and it is narrow on purpose: the Equipo
 * entry is offered to admins and to nobody else.
 *
 * This is NOT access control and the test should not be read as such — the API
 * answers 403 whatever the shell renders. What it prevents is offering a member
 * a path that dead-ends in a permission error they cannot resolve.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from '@features/auth/store/authStore'
import { AppLayout } from './AppLayout'

const USUARIO = {
  id: 'u-1',
  negocio_id: 'neg-1',
  es_admin: false,
  email: 'alguien@test.com',
  nombre: 'Alguien',
  created_at: '2026-01-01',
}

afterEach(() => useAuthStore.setState({ user: null }))

function renderLayout(esAdmin: boolean) {
  useAuthStore.setState({ user: { ...USUARIO, es_admin: esAdmin } })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AppLayout — entrada de Equipo', () => {
  it('se le ofrece al admin', () => {
    renderLayout(true)
    expect(screen.getAllByRole('link', { name: /equipo/i }).length).toBeGreaterThan(0)
  })

  it('no se le ofrece a un miembro común', () => {
    renderLayout(false)
    expect(screen.queryByRole('link', { name: /equipo/i })).not.toBeInTheDocument()
  })

  it('el resto de la navegación es la misma para ambos', () => {
    renderLayout(false)
    for (const destino of [/home/i, /proveedores/i, /facturas/i, /pagos/i, /perfil/i]) {
      expect(screen.getAllByRole('link', { name: destino }).length).toBeGreaterThan(0)
    }
  })
})
