/**
 * Tests for SupplierMatchControl — the supplier picker used by the IA
 * confirm flow for BOTH facturas and pagos (c-21 D4/D5).
 *
 * The behaviour under test is RN-IA-06: the IA proposes, the human confirms.
 * A confirmation in which only "accept" is reachable is not a confirmation,
 * so the auto-matched supplier MUST be dismissible.
 *
 * Why these tests assert AFTER effects flush (c-23 D4): the original defect
 * was that the auto-match effect re-applied the supplier on the render that
 * followed the clear. A test that asserts at click time — as
 * `SupplierSearch.test.tsx` does — passes against the broken code. The
 * assertion has to survive the next effect pass or it reproduces the same
 * blind spot that let the bug ship.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { SupplierMatchControl } from './SupplierMatchControl'
import type { ProveedorListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeProveedor(id: string, nombre: string): ProveedorListItem {
  return {
    id,
    usuario_id: 'user-1',
    nombre,
    cuit: null,
    telefono: null,
    categoria: 'OTRO',
    notas: null,
    saldo: 0,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
  } as ProveedorListItem
}

const ACME = makeProveedor('uuid-acme', 'Acme')
const BETA = makeProveedor('uuid-beta', 'Beta')

/** Exact-match directory: only a UNIQUE normalized-exact hit auto-matches. */
const DIRECTORY: Record<string, ProveedorListItem[]> = {
  acme: [ACME],
  beta: [BETA],
  ambiguo: [makeProveedor('a', 'Ambiguo'), makeProveedor('b', 'Ambiguo')],
}

const server = setupServer(
  http.get('/api/proveedores/buscar', ({ request }) => {
    const nombre = new URL(request.url).searchParams.get('nombre') ?? ''
    if (nombre.trim().length < 2) return HttpResponse.json([])
    return HttpResponse.json(DIRECTORY[nombre.toLowerCase().trim()] ?? [])
  }),
  http.post('/api/proveedores', async ({ request }) => {
    const body = (await request.json()) as { nombre: string }
    return HttpResponse.json(makeProveedor('uuid-created', body.nombre), { status: 201 })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Harness ───────────────────────────────────────────────────────────────────

/**
 * SupplierMatchControl is fully controlled, so the selection has to live in a
 * parent — exactly as CargaModal owns it in production. Testing it against a
 * `vi.fn()` instead would never surface the re-apply, because the bug needs a
 * real state round-trip to manifest.
 */
function Harness({ proveedorNombre }: { proveedorNombre: string | null }) {
  const [selected, setSelected] = useState<ProveedorListItem | null>(null)
  return (
    <SupplierMatchControl
      proveedorNombre={proveedorNombre}
      selectedProveedor={selected}
      onProveedorChange={setSelected}
    />
  )
}

function renderHarness(proveedorNombre: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
  return render(<Harness proveedorNombre={proveedorNombre} />, { wrapper: Wrapper })
}

/** The clear button renders only while a supplier is selected — so its
 *  presence is an unambiguous proxy for "something is selected". */
const clearButton = () => screen.queryByRole('button', { name: /limpiar/i })

async function waitForAutoMatch(nombre: string) {
  await waitFor(() => expect(screen.getByText(nombre)).toBeInTheDocument())
  await waitFor(() => expect(clearButton()).toBeInTheDocument())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SupplierMatchControl — auto-match', () => {
  it('pre-selects a unique normalized-exact match', async () => {
    renderHarness('Acme')

    await waitForAutoMatch('Acme')
  })

  it('does not pre-select when the detected name is ambiguous', async () => {
    renderHarness('Ambiguo')

    // Two exact hits → no-match → inline create offered instead.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /crear «Ambiguo»/i })).toBeInTheDocument(),
    )
    expect(clearButton()).not.toBeInTheDocument()
  })
})

describe('SupplierMatchControl — dismissing the AI match (RN-IA-06)', () => {
  it('keeps the supplier cleared after the user clicks the clear control', async () => {
    renderHarness('Acme')
    await waitForAutoMatch('Acme')

    fireEvent.click(clearButton() as HTMLElement)

    // The assertion that matters: it must STILL be cleared once effects have
    // run again. Asserting only synchronously here would pass against the
    // buggy implementation, which re-applied the match on the next render.
    await waitFor(() => expect(clearButton()).not.toBeInTheDocument())
    await new Promise((r) => setTimeout(r, 50))
    expect(clearButton()).not.toBeInTheDocument()
  })

  it('leaves the supplier search usable after dismissing', async () => {
    renderHarness('Acme')
    await waitForAutoMatch('Acme')

    fireEvent.click(clearButton() as HTMLElement)
    await waitFor(() => expect(clearButton()).not.toBeInTheDocument())

    // The user's whole reason for clearing: type a different supplier.
    expect(screen.getByRole('combobox')).toBeEnabled()
  })

  it('auto-matches again when a NEW proposal brings a different name', async () => {
    const { rerender } = renderHarness('Acme')
    await waitForAutoMatch('Acme')

    fireEvent.click(clearButton() as HTMLElement)
    await waitFor(() => expect(clearButton()).not.toBeInTheDocument())

    // A new AI reading — the dismissal applied to the rejected proposal,
    // not to the control for the rest of its life.
    rerender(<Harness proveedorNombre="Beta" />)

    await waitForAutoMatch('Beta')
  })
})
