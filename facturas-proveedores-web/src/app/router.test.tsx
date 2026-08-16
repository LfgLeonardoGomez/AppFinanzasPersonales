/**
 * Tests for the app router's route registration (C-36, task 11.6).
 *
 * `/clientes` and `/clientes/:id` must render their respective pages and
 * sit inside the SAME authenticated parent route as every other private
 * route (e.g. `/proveedores`) — the same guard, not a new one.
 */
import { describe, it, expect } from 'vitest'
import { router } from './router'

function findRoute(path: string) {
  // The private routes are nested one level under the AuthenticatedLayout
  // parent route (no `path` of its own, just `children`).
  for (const route of router.routes) {
    if (route.path === path) return route
    for (const child of route.children ?? []) {
      if (child.path === path) return { route: child, parent: route }
    }
  }
  return undefined
}

describe('router — /clientes and /clientes/:id (task 11.6)', () => {
  it('registers /clientes under the same parent as /proveedores', () => {
    const clientesEntry = findRoute('/clientes') as { route: unknown; parent: unknown } | undefined
    const proveedoresEntry = findRoute('/proveedores') as { route: unknown; parent: unknown } | undefined
    expect(clientesEntry).toBeDefined()
    expect(proveedoresEntry).toBeDefined()
    expect(clientesEntry?.parent).toBe(proveedoresEntry?.parent)
  })

  it('registers /clientes/:id under the same parent as /proveedores (triangulation)', () => {
    const clienteDetailEntry = findRoute('/clientes/:id') as { route: unknown; parent: unknown } | undefined
    const proveedoresEntry = findRoute('/proveedores') as { route: unknown; parent: unknown } | undefined
    expect(clienteDetailEntry).toBeDefined()
    expect(clienteDetailEntry?.parent).toBe(proveedoresEntry?.parent)
  })
})
