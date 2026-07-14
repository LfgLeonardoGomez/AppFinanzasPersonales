/**
 * Tests for the home page quick-access actions (F-HOME-01).
 * TDD: Task 8.4 (RED → GREEN) — adds the "Cargar pago" entry to the
 * existing quick-access nav.
 *
 * The "Cargar factura" and "Cargar pago" quick-access actions must be
 * visible on the home screen and navigate to the respective create forms.
 *
 * C-18 (FE-004): the quick-access nav uses plain <a href> tags. Clicking
 * them triggers a full-page reload, which destroys the SPA (same root
 * cause as FE-001). The fix swaps them for <Link to> from react-router-dom.
 * The test below asserts that the SPA-style routing is used (the
 * placeholder route is matched on click, which only works if React Router
 * handled the click — a plain <a href> would full-reload and lose the
 * test's router state).
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { HomePage } from './HomePage'

describe('HomePage — quick access (F-HOME-01)', () => {
  it('shows a "Cargar pago" action that links to /pagos/nuevo', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /cargar pago/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/pagos/nuevo')
  })

  it('shows a "Cargar factura" action that links to /facturas/nueva', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /cargar factura/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/facturas/nueva')
  })

  it('shows a "Ver pagos" action that links to /pagos', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /ver pagos/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/pagos')
  })

  it('shows a "Ver facturas" action', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /ver facturas/i })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/facturas')
  })

  it('shows a "Ver proveedores" action', () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /ver proveedores/i })
    expect(link).toBeInTheDocument()
  })
})

// ── C-18 (FE-004): the home quick-access actions must navigate via
// react-router-dom (no full-page reload). The test renders HomePage inside
// a MemoryRouter with the destination routes declared; clicking a link
// matches the placeholder route, which only works if React Router handled
// the click (a plain <a href> would full-reload and the test wrapper would
// lose its location, breaking the match).

describe('HomePage — FE-004 SPA navigation (Link to)', () => {
  it('"Cargar pago" navigates to /pagos/nuevo via the SPA router', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/pagos/nuevo" element={<div>PAGOS_NUEVO</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: /cargar pago/i }))
    expect(screen.getByText('PAGOS_NUEVO')).toBeInTheDocument()
  })

  it('"Cargar factura" navigates to /facturas/nueva via the SPA router', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/facturas/nueva" element={<div>FACTURAS_NUEVA</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: /cargar factura/i }))
    expect(screen.getByText('FACTURAS_NUEVA')).toBeInTheDocument()
  })

  it('"Ver pagos" navigates to /pagos via the SPA router', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/pagos" element={<div>PAGOS_LIST</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: /ver pagos/i }))
    expect(screen.getByText('PAGOS_LIST')).toBeInTheDocument()
  })
})

// ── C-18 (FE-004): the home quick-access actions must navigate via
// react-router-dom (no full-page reload). The test renders HomePage inside
// a MemoryRouter with the destination routes declared; clicking a link
// matches the placeholder route, which only works if React Router handled
// the click (a plain <a href> would full-reload and the test wrapper
// would lose its location, breaking the match).

describe('HomePage — FE-004 SPA navigation (Link to)', () => {
  it('"Cargar pago" navigates to /pagos/nuevo via the SPA router', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/pagos/nuevo" element={<div>PAGOS_NUEVO</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: /cargar pago/i }))
    expect(screen.getByText('PAGOS_NUEVO')).toBeInTheDocument()
  })

  it('"Cargar factura" navigates to /facturas/nueva via the SPA router', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/facturas/nueva" element={<div>FACTURAS_NUEVA</div>} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('link', { name: /cargar factura/i }))
    expect(screen.getByText('FACTURAS_NUEVA')).toBeInTheDocument()
  })
})
