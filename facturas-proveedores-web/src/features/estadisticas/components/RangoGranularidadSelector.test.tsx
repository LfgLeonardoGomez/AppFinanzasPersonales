/**
 * Tests for the shared range + granularity selector (C-38, tasks 6.1-6.4).
 *
 * "Shared" here means the same PIECE OF UI, not the same value synced across
 * screens (design.md D3). State lives in the search params of whichever
 * route the selector is mounted on, so the supplier's ficha and the
 * estadísticas screen keep independent ranges — and each view stays
 * linkable and survives a refresh.
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom'
import { RangoGranularidadSelector } from './RangoGranularidadSelector'
import { useRangoGranularidad } from '../utils/useRangoGranularidad'

/** Mounts the selector on a route and echoes the resulting search params. */
function Harness({
  vista = 'compras',
  hoy = '2026-08-26',
}: {
  vista?: 'compras' | 'ventas'
  hoy?: string
}) {
  const { rango, setRango } = useRangoGranularidad(vista, hoy)
  const [searchParams] = useSearchParams()

  return (
    <div>
      <RangoGranularidadSelector rango={rango} onChange={setRango} />
      <output data-testid="params">{searchParams.toString()}</output>
      <output data-testid="rango">{`${rango.desde}|${rango.hasta}|${rango.granularidad}`}</output>
    </div>
  )
}

function renderAt(initialEntry: string, vista: 'compras' | 'ventas' = 'compras') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/x" element={<Harness vista={vista} />} />
        <Route path="/y" element={<Harness vista={vista} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('useRangoGranularidad — defaults', () => {
  it('initialises from the default range when there are no search params', () => {
    renderAt('/x')

    expect(screen.getByTestId('rango')).toHaveTextContent('2025-08-26|2026-08-26|mes')
  })

  it('uses the ventas default on the ventas view', () => {
    renderAt('/x', 'ventas')

    expect(screen.getByTestId('rango')).toHaveTextContent('2026-07-28|2026-08-26|dia')
  })

  it('respects the search params when they are present', () => {
    renderAt('/x?desde=2026-01-01&hasta=2026-03-31&granularidad=semana')

    expect(screen.getByTestId('rango')).toHaveTextContent('2026-01-01|2026-03-31|semana')
  })

  it('ignores a granularidad the backend does not accept and falls back to the default', () => {
    // A hand-edited URL must not send `granularidad=trimestre` to the API and
    // collect an opaque 422 — the closed enum is validated on the way in.
    renderAt('/x?desde=2026-01-01&hasta=2026-03-31&granularidad=trimestre')

    expect(screen.getByTestId('rango')).toHaveTextContent('2026-01-01|2026-03-31|mes')
  })
})

describe('RangoGranularidadSelector — writing back to the URL', () => {
  it('writes the granularity into the search params when changed', async () => {
    const user = userEvent.setup()
    renderAt('/x?desde=2026-01-01&hasta=2026-03-31&granularidad=mes')

    const grupo = screen.getByRole('group', { name: /granularidad/i })
    await user.click(within(grupo).getByRole('button', { name: /semana/i }))

    expect(screen.getByTestId('params').textContent).toContain('granularidad=semana')
    expect(screen.getByTestId('rango')).toHaveTextContent('2026-01-01|2026-03-31|semana')
  })

  it('writes desde and hasta into the search params when changed', async () => {
    const user = userEvent.setup()
    renderAt('/x?desde=2026-01-01&hasta=2026-03-31&granularidad=mes')

    const desde = screen.getByLabelText(/desde/i)
    await user.clear(desde)
    await user.type(desde, '2026-02-01')

    expect(screen.getByTestId('params').textContent).toContain('desde=2026-02-01')
  })

  it('marks the active granularity as pressed', () => {
    renderAt('/x?desde=2026-01-01&hasta=2026-03-31&granularidad=semana')

    const grupo = screen.getByRole('group', { name: /granularidad/i })
    expect(within(grupo).getByRole('button', { name: /semana/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(grupo).getByRole('button', { name: /^mes$/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('offers exactly the three granularities the backend accepts', () => {
    renderAt('/x')

    const grupo = screen.getByRole('group', { name: /granularidad/i })
    const labels = within(grupo)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim().toLowerCase())

    expect(labels).toEqual(['día', 'semana', 'mes'])
  })
})

describe('per-route isolation (design.md D3)', () => {
  it('does NOT share the range between two routes', () => {
    // Route /y is mounted with no params at all: if the selector kept its
    // state in a global store, it would inherit /x's range. It must not —
    // opening a supplier's ficha should never move the estadísticas screen's
    // range, or vice versa.
    const { unmount } = renderAt('/x?desde=2026-01-01&hasta=2026-03-31&granularidad=semana')
    expect(screen.getByTestId('rango')).toHaveTextContent('2026-01-01|2026-03-31|semana')
    unmount()

    renderAt('/y')
    expect(screen.getByTestId('rango')).toHaveTextContent('2025-08-26|2026-08-26|mes')
  })
})
