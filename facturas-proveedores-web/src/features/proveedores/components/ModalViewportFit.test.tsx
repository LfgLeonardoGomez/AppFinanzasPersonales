/**
 * Modal viewport-fit contract (c-23).
 *
 * A dialog taller than the screen used to overflow symmetrically: the heading
 * was clipped above and the submit button was cut off below, which made the
 * supplier form unusable at short viewport heights — on a PWA whose primary
 * target is mobile, with the on-screen keyboard eating half the screen.
 *
 * WHAT THESE TESTS CAN AND CANNOT PROVE (c-23 D5): JSDOM performs no layout,
 * so "nothing is clipped" is not observable here. These tests lock the
 * DECLARATION — a dynamic-viewport height cap plus an internal scroll
 * container — not the rendered result. A real viewport check belongs in a
 * Playwright run. Stated plainly so nobody mistakes this for a stronger
 * guarantee than it is.
 *
 * `dvh` rather than `vh` is deliberate: `100vh` ignores the mobile address bar
 * and the on-screen keyboard, which is exactly the state the user is in while
 * filling the form.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ProveedorDialog } from './ProveedorDialog'
import { DeleteProveedorDialog } from './DeleteProveedorDialog'

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

/**
 * The scroll container is whichever node in the dialog subtree declares both
 * the cap and the overflow. Asserting on the dialog node alone would break if
 * the structure later gains an inner wrapper that does the scrolling.
 */
function expectViewportFit(dialog: HTMLElement) {
  const candidates = [dialog, ...Array.from(dialog.querySelectorAll('*'))] as HTMLElement[]

  const capped = candidates.filter((el) => /max-h-\[\d+dvh\]/.test(el.className ?? ''))
  expect(
    capped.length,
    'no node declares a dvh-based max-height — content taller than the viewport will be clipped',
  ).toBeGreaterThan(0)

  const scrolls = capped.some((el) => /overflow-(y-)?auto|overflow-(y-)?scroll/.test(el.className))
  expect(
    scrolls,
    'the height-capped node has no scroll container — capping alone just hides the overflow',
  ).toBe(true)
}

describe('Modal viewport fit (c-23)', () => {
  it('ProveedorDialog caps its height and scrolls internally', () => {
    render(<ProveedorDialog mode="create" open onSuccess={vi.fn()} onCancel={vi.fn()} />, {
      wrapper: makeWrapper(),
    })

    expectViewportFit(screen.getByRole('dialog'))
  })

  it('ProveedorDialog in edit mode also fits — it is the taller variant', () => {
    // Edit mode adds the full-width "Eliminar proveedor" action, which is the
    // button the user reported as cut off.
    render(
      <ProveedorDialog
        mode="edit"
        open
        proveedor={{
          id: 'uuid-1',
          nombre: 'Proveedor Existente',
          cuit: '20-12345678-9',
          telefono: '1144556677',
          categoria: 'SERVICIO',
          notas: 'nota',
          saldo: 0,
          created_at: '2026-06-01T00:00:00',
          updated_at: '2026-06-01T00:00:00',
        }}
        onSuccess={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    expectViewportFit(screen.getByRole('dialog'))
  })

  it('DeleteProveedorDialog caps its height and scrolls internally', () => {
    // Short content today, so it does not overflow yet. Locked anyway: the
    // defect class is "no dialog constrains its height", and leaving a known
    // flaw in place because it has not been observed is how this one shipped.
    render(
      <DeleteProveedorDialog
        open
        proveedor={{
          id: 'uuid-1',
          nombre: 'Proveedor Existente',
          cuit: null,
          telefono: null,
          categoria: 'SERVICIO',
          notas: null,
          saldo: 0,
          created_at: '2026-06-01T00:00:00',
          updated_at: '2026-06-01T00:00:00',
        }}
        hasDependencies={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
      { wrapper: makeWrapper() },
    )

    // This one declares role="alertdialog", not "dialog".
    expectViewportFit(screen.getByRole('alertdialog'))
  })
})
