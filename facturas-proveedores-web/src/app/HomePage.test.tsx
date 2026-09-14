/**
 * Tests for the redesigned HomePage (C-44, spec `home-y-navegacion`).
 *
 * The home is now a surface of ACTION, not a dashboard (D1): "Vender ahora"
 * (primary, → /ventas/nueva) and "Cargar con IA" (secondary, unchanged
 * destination), and NOTHING ELSE — no money text, no charts, no HTTP
 * requests, no proveedores-frecuentes or actividad-reciente sections (those
 * moved to `/proveedores`, task groups 4-5).
 *
 * The MSW server below has ZERO handlers and `onUnhandledRequest: 'error'`
 * — any request the home issues fails the test immediately. This is the
 * mechanism behind "the home does not consult the API" (spec scenario).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { HomePage } from './HomePage'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/ventas/nueva" element={<div>VENTA_FORM</div>} />
          <Route path="/facturas/nueva" element={<div>FACTURAS_NUEVA</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

/** Every interactive element (button/link) in DOM order — used to prove the
 *  sale action is FIRST, without relying on visual prominence (unaffirmable
 *  in a test — design.md D1). */
function interactiveElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('a, button'))
}

describe('HomePage — surface of action (D1)', () => {
  it('the sale action is the first action of the main content, in DOM order', () => {
    const { container } = renderHome()
    const elements = interactiveElements(container)
    expect(elements.length).toBeGreaterThan(0)
    expect(elements[0]).toHaveTextContent(/vender ahora/i)
  })

  it('activating the sale action navigates to /ventas/nueva', () => {
    renderHome()
    fireEvent.click(screen.getByRole('link', { name: /vender ahora/i }))
    expect(screen.getByText('VENTA_FORM')).toBeInTheDocument()
  })

  it('the IA-carga entry is still present', () => {
    renderHome()
    expect(screen.getByRole('heading', { name: /cargar con ia/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /subir imagen/i })).toBeInTheDocument()
  })

  it('activating the IA-carga entry opens the same flow as before (→ /facturas/nueva)', () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: /subir imagen/i }))
    expect(screen.getByText('FACTURAS_NUEVA')).toBeInTheDocument()
  })
})

describe('HomePage — does not show business data (D1)', () => {
  it('renders no currency-formatted text', () => {
    const { container } = renderHome()
    // es-AR currency formatting always includes a "$" sign — the simplest,
    // most direct way to assert "no money text anywhere on the screen".
    expect(container.textContent).not.toMatch(/\$/)
  })

  it('renders no chart (no element exposed as role="img")', () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <HomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('does not consult the API — zero HTTP requests', () => {
    // The `server` above has NO handlers and `onUnhandledRequest: 'error'`.
    // If the home issued any request, MSW would throw and fail this test.
    expect(() => renderHome()).not.toThrow()
  })

  it('no longer shows the "Proveedores frecuentes" section', () => {
    renderHome()
    expect(screen.queryByText('Proveedores frecuentes')).not.toBeInTheDocument()
  })

  it('no longer shows the "Actividad reciente" section', () => {
    renderHome()
    expect(screen.queryByText('Actividad reciente')).not.toBeInTheDocument()
  })
})
