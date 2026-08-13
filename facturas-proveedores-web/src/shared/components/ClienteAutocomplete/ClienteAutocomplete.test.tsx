/**
 * Tests for ClienteAutocomplete — autocomplete + inline creation for the
 * conditional customer field on a `CUENTA_CORRIENTE` sale (C-34, tasks 4.1-4.7).
 *
 * Mirrors `SupplierSearch.test.tsx`'s MSW strategy, plus the `409` duplicate
 * branch that `SupplierSearch` has no equivalent of (design.md D8).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { ClienteAutocomplete, type ClienteRef } from './ClienteAutocomplete'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockResults: ClienteRef[] = [
  { id: 'cliente-1', nombre: 'Juan Pérez' },
  { id: 'cliente-2', nombre: 'Juana Pérez' },
]

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/clientes/buscar', ({ request }) => {
    const url = new URL(request.url)
    const nombre = url.searchParams.get('nombre') ?? ''
    if (nombre.length < 2) return HttpResponse.json([])
    if (nombre.toLowerCase().includes('perez') || nombre.toLowerCase().includes('pérez')) {
      // Server order deliberately reversed vs. alphabetical, to make a
      // wrongful client-side sort observable.
      return HttpResponse.json([mockResults[1], mockResults[0]])
    }
    if (nombre.toLowerCase().includes('existe')) return HttpResponse.json([])
    if (nombre.toLowerCase().includes('falla')) return HttpResponse.json([])
    return HttpResponse.json([])
  }),

  http.post('/api/clientes', async ({ request }) => {
    const body = (await request.json()) as { nombre: string }
    if (body.nombre.toLowerCase().includes('existe')) {
      return HttpResponse.json(
        {
          detail: {
            mensaje: 'Ya existe un cliente con ese nombre en este negocio.',
            cliente_existente: { id: 'cliente-existente', nombre: 'Cliente Existente' },
          },
        },
        { status: 409 },
      )
    }
    if (body.nombre.toLowerCase().includes('falla')) {
      return HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
    }
    return HttpResponse.json(
      { id: 'cliente-nuevo', nombre: body.nombre },
      { status: 201 },
    )
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Wrapper ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

/** A minimal host that surrounds the autocomplete with other form fields, so
 * "the surrounding form is unaffected" (no modal, no navigation, no reset)
 * is something a test can actually observe. */
function FormHost() {
  const [cliente, setCliente] = useState<ClienteRef | null>(null)
  const [monto, setMonto] = useState('1500')
  return (
    <div>
      <label htmlFor="monto-field">Monto</label>
      <input id="monto-field" value={monto} onChange={(e) => setMonto(e.target.value)} />
      <ClienteAutocomplete value={cliente} onChange={setCliente} />
      {cliente && <span data-testid="selected-name">{cliente.nombre}</span>}
    </div>
  )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ClienteAutocomplete — combobox semantics (task 4.1)', () => {
  it('exposes role="combobox" with aria-expanded and a role="listbox" of role="option" items', async () => {
    render(<ClienteAutocomplete value={null} onChange={() => {}} />, { wrapper: createWrapper() })
    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    fireEvent.change(input, { target: { value: 'perez' } })
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
  })
})

describe('ClienteAutocomplete — selection and clearing (task 4.2)', () => {
  it('reports the chosen customer via onChange and shows it as the current selection', async () => {
    const onChange = vi.fn()
    render(<ClienteAutocomplete value={null} onChange={onChange} />, { wrapper: createWrapper() })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'perez' } })
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Juan Pérez'))
    expect(onChange).toHaveBeenCalledWith({ id: 'cliente-1', nombre: 'Juan Pérez' })
  })

  it('reports null when the current selection is cleared', () => {
    const onChange = vi.fn()
    render(
      <ClienteAutocomplete value={{ id: 'cliente-1', nombre: 'Juan Pérez' }} onChange={onChange} />,
      { wrapper: createWrapper() },
    )
    fireEvent.click(screen.getByRole('button', { name: /limpiar|clear/i }))
    expect(onChange).toHaveBeenCalledWith(null)
  })
})

describe('ClienteAutocomplete — keyboard-only navigation (task 4.3)', () => {
  it('moves the active option with ArrowDown/ArrowUp and selects it with Enter', async () => {
    const onChange = vi.fn()
    render(<ClienteAutocomplete value={null} onChange={onChange} />, { wrapper: createWrapper() })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'perez' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith({ id: 'cliente-2', nombre: 'Juana Pérez' })
  })

  it('closes the list on Escape', async () => {
    render(<ClienteAutocomplete value={null} onChange={() => {}} />, { wrapper: createWrapper() })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'perez' } })
    await waitFor(() => expect(screen.getByRole('listbox')).toBeInTheDocument())
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('ClienteAutocomplete — inline creation (task 4.4, spec scenario)', () => {
  it('offers to create a customer that matches nothing, and selects it on success without a modal, navigation, or losing the rest of the form', async () => {
    render(<FormHost />, { wrapper: createWrapper() })
    const montoInput = screen.getByLabelText('Monto') as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '4500' } })

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Cliente Nuevo' } })
    await waitFor(() =>
      expect(screen.getByText(/crear.*cliente nuevo.*como nuevo cliente/i)).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText(/crear.*cliente nuevo.*como nuevo cliente/i))

    await waitFor(() => expect(screen.getByTestId('selected-name')).toHaveTextContent('Cliente Nuevo'))
    // No modal — the same document, no dialog role introduced.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The rest of the form is untouched.
    expect(montoInput.value).toBe('4500')
  })
})

describe('ClienteAutocomplete — duplicate suggestion (task 4.5, spec scenario)', () => {
  it('offers the existing customer instead of an error when creation answers 409', async () => {
    render(<ClienteAutocomplete value={null} onChange={() => {}} />, { wrapper: createWrapper() })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Ya Existe' } })
    await waitFor(() =>
      expect(screen.getByText(/crear.*ya existe.*como nuevo cliente/i)).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText(/crear.*ya existe.*como nuevo cliente/i))

    await waitFor(() => expect(screen.getByText('Cliente Existente')).toBeInTheDocument())
    // Not surfaced as a primary error.
    expect(screen.queryByText(/error al crear/i)).not.toBeInTheDocument()
  })

  it('accepting the offered customer selects it and sends no second creation request', async () => {
    let postCount = 0
    server.use(
      http.post('/api/clientes', () => {
        postCount += 1
        return HttpResponse.json(
          {
            detail: {
              mensaje: 'Ya existe un cliente con ese nombre en este negocio.',
              cliente_existente: { id: 'cliente-existente', nombre: 'Cliente Existente' },
            },
          },
          { status: 409 },
        )
      }),
    )
    const onChange = vi.fn()
    render(<ClienteAutocomplete value={null} onChange={onChange} />, { wrapper: createWrapper() })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Ya Existe' } })
    await waitFor(() =>
      expect(screen.getByText(/crear.*ya existe.*como nuevo cliente/i)).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText(/crear.*ya existe.*como nuevo cliente/i))
    await waitFor(() => expect(screen.getByText('Cliente Existente')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Cliente Existente'))
    expect(onChange).toHaveBeenCalledWith({ id: 'cliente-existente', nombre: 'Cliente Existente' })
    expect(postCount).toBe(1)
  })
})

describe('ClienteAutocomplete — no double POST on a fast double-tap (review finding E)', () => {
  it('sends only one POST when the "crear como nuevo cliente" option is activated twice in a row', async () => {
    let postCount = 0
    server.use(
      http.post('/api/clientes', async ({ request }) => {
        postCount += 1
        const body = (await request.json()) as { nombre: string }
        return HttpResponse.json({ id: 'cliente-nuevo', nombre: body.nombre }, { status: 201 })
      }),
    )
    const onChange = vi.fn()
    render(<ClienteAutocomplete value={null} onChange={onChange} />, { wrapper: createWrapper() })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Cliente Doble' } })
    await waitFor(() =>
      expect(screen.getByText(/crear.*cliente doble.*como nuevo cliente/i)).toBeInTheDocument(),
    )

    const createOption = screen.getByText(/crear.*cliente doble.*como nuevo cliente/i)
    fireEvent.click(createOption)
    fireEvent.click(createOption)

    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ id: 'cliente-nuevo', nombre: 'Cliente Doble' }))
    expect(postCount).toBe(1)
  })

  it('sends only one POST on a fast double Enter (triangulation)', async () => {
    let postCount = 0
    server.use(
      http.post('/api/clientes', async ({ request }) => {
        postCount += 1
        const body = (await request.json()) as { nombre: string }
        return HttpResponse.json({ id: 'cliente-nuevo-2', nombre: body.nombre }, { status: 201 })
      }),
    )
    const onChange = vi.fn()
    render(<ClienteAutocomplete value={null} onChange={onChange} />, { wrapper: createWrapper() })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Cliente Enter' } })
    await waitFor(() =>
      expect(screen.getByText(/crear.*cliente enter.*como nuevo cliente/i)).toBeInTheDocument(),
    )
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ id: 'cliente-nuevo-2', nombre: 'Cliente Enter' }),
    )
    expect(postCount).toBe(1)
  })
})

describe('ClienteAutocomplete — non-409 creation failure (task 4.6)', () => {
  it('shows an error and leaves the surrounding form intact', async () => {
    render(<FormHost />, { wrapper: createWrapper() })
    const montoInput = screen.getByLabelText('Monto') as HTMLInputElement
    fireEvent.change(montoInput, { target: { value: '999' } })

    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Cliente Falla' } })
    await waitFor(() =>
      expect(screen.getByText(/crear.*cliente falla.*como nuevo cliente/i)).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText(/crear.*cliente falla.*como nuevo cliente/i))

    await waitFor(() => expect(screen.getByText(/error al crear/i)).toBeInTheDocument())
    expect(montoInput.value).toBe('999')
    expect(screen.queryByTestId('selected-name')).not.toBeInTheDocument()
  })
})

describe('ClienteAutocomplete — no client-side normalization (task 4.7)', () => {
  it('sends an accented fragment as typed (apart from trimming) and respects the server order', async () => {
    let capturedUrl = ''
    server.use(
      http.get('/api/clientes/buscar', ({ request }) => {
        capturedUrl = request.url
        return HttpResponse.json([mockResults[1], mockResults[0]])
      }),
    )
    render(<ClienteAutocomplete value={null} onChange={() => {}} />, { wrapper: createWrapper() })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'Pérez' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(2))

    expect(decodeURIComponent(capturedUrl)).toContain('nombre=Pérez')
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Juana Pérez')
    expect(options[1]).toHaveTextContent('Juan Pérez')
  })
})
