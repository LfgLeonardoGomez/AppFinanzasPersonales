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
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { useAuthStore } from '@features/auth/store/authStore'
import { VENTA_CREATE_MUTATION_KEY } from '@features/ventas/api/ventasHooks'
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

// A component that mounts a mutation matching VENTA_CREATE_MUTATION_KEY and
// leaves it pending forever (the mutationFn never resolves) — simulating a
// hung "Nueva venta" submit alongside AppLayout, sharing the same
// QueryClient so `useIsMutating` in AppLayout can observe it.
function PendingVentaCreateMutation() {
  const mutation = useMutation({
    mutationKey: VENTA_CREATE_MUTATION_KEY,
    mutationFn: () => new Promise(() => {}),
  })
  if (!mutation.isPending) mutation.mutate()
  return null
}

// Reads the router's current pathname so tests can assert whether a click
// on a nav Link actually navigated, instead of relying on `preventDefault`
// (react-router's own Link already calls that on every click regardless —
// asserting on it would pass even with no gating at all).
function LocationProbe() {
  const location = useLocation()
  return <span data-testid="current-path">{location.pathname}</span>
}

function renderLayoutWithPendingVentaCreate() {
  useAuthStore.setState({ user: { ...USUARIO, es_admin: false } })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <PendingVentaCreateMutation />
        <LocationProbe />
        <AppLayout />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function renderLayoutWithLocationProbe() {
  useAuthStore.setState({ user: { ...USUARIO, es_admin: false } })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe />
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

describe('AppLayout — entrada de Ventas (C-34)', () => {
  // Unlike Equipo, Ventas is not a privileged action — any member of the
  // negocio records sales, so it must be offered regardless of es_admin.
  it('se le ofrece a un miembro común', () => {
    renderLayout(false)
    expect(screen.getAllByRole('link', { name: /ventas/i }).length).toBeGreaterThan(0)
  })

  it('se le ofrece también al admin', () => {
    renderLayout(true)
    expect(screen.getAllByRole('link', { name: /ventas/i }).length).toBeGreaterThan(0)
  })
})

// ── Review fix (finding 1, CRITICAL) — nav gated while a sale create is
// pending ───────────────────────────────────────────────────────────────
//
// Part of the cross-submission race this change closes: the failing
// sequence started with the user navigating AWAY from a hung "Nueva
// venta" submit and starting a DIFFERENT sale on return, which overwrote
// the shared idempotency slot. `idempotency.ts`'s identity-aware confirm
// stops that overwrite from corrupting data, but the shell should also
// stop the user from walking into the situation in the first place.
describe('AppLayout — navegación bloqueada durante una venta en curso (C-42 review fix)', () => {
  it('marks every main-nav link aria-disabled while a venta-create mutation is pending', () => {
    renderLayoutWithPendingVentaCreate()
    const homeLinks = screen.getAllByRole('link', { name: /home/i })
    expect(homeLinks.length).toBeGreaterThan(0)
    for (const link of homeLinks) {
      expect(link).toHaveAttribute('aria-disabled', 'true')
    }
  })

  it('clicking a nav link while pending does not navigate away', () => {
    renderLayoutWithPendingVentaCreate()
    const proveedoresLink = screen.getAllByRole('link', { name: /proveedores/i })[0] as HTMLElement
    fireEvent.click(proveedoresLink)
    expect(screen.getByTestId('current-path').textContent).toBe('/')
  })

  it('nav links are NOT disabled and DO navigate when no venta-create mutation is pending (triangulation)', () => {
    renderLayoutWithLocationProbe()
    const homeLinks = screen.getAllByRole('link', { name: /home/i })
    expect(homeLinks.length).toBeGreaterThan(0)
    for (const link of homeLinks) {
      expect(link).not.toHaveAttribute('aria-disabled', 'true')
    }
    const proveedoresLink = screen.getAllByRole('link', { name: /proveedores/i })[0] as HTMLElement
    fireEvent.click(proveedoresLink)
    expect(screen.getByTestId('current-path').textContent).toBe('/proveedores')
  })
})
