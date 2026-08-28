/**
 * Tests for the SVG bar series (C-38, tasks 7.1-7.5).
 *
 * The reason this component renders SVG rather than canvas is testability:
 * these assertions read real DOM nodes. Under `jsdom` with no `canvas`
 * package a canvas chart produces nothing to assert on, and the only
 * "test" available would be checking what got handed to a mock — which
 * proves the data prep ran, not that anything reached the screen
 * (design.md D1).
 */
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { SerieBarras } from './SerieBarras'

const serieTresMeses = [
  { etiqueta: 'Ene 2026', valor: 1000 },
  { etiqueta: 'Feb 2026', valor: 0 },
  { etiqueta: 'Mar 2026', valor: 2500 },
]

describe('SerieBarras — rendering', () => {
  it('exposes an accessible name describing the series', () => {
    render(<SerieBarras titulo="Compras por mes" datos={serieTresMeses} />)

    expect(screen.getByRole('img', { name: /compras por mes/i })).toBeInTheDocument()
  })

  it('renders one bar per period', () => {
    const { container } = render(
      <SerieBarras titulo="Compras por mes" datos={serieTresMeses} />,
    )

    expect(container.querySelectorAll('rect[data-bar]')).toHaveLength(3)
  })

  it('makes every value readable as text, not only as a drawn shape', () => {
    render(<SerieBarras titulo="Compras por mes" datos={serieTresMeses} />)

    const valores = screen.getByRole('list', { name: /valores/i })
    expect(within(valores).getByText('Ene 2026')).toBeInTheDocument()
    expect(within(valores).getByText(/1\.000/)).toBeInTheDocument()
    expect(within(valores).getByText(/2\.500/)).toBeInTheDocument()
  })

  it('KEEPS a zero period — it does not filter it out', () => {
    render(<SerieBarras titulo="Compras por mes" datos={serieTresMeses} />)

    const valores = screen.getByRole('list', { name: /valores/i })
    expect(within(valores).getByText('Feb 2026')).toBeInTheDocument()
    expect(within(valores).getAllByRole('listitem')).toHaveLength(3)
  })

  it('renders as many entries as the backend sent, no more and no fewer', () => {
    const cinco = [
      { etiqueta: 'A', valor: 5 },
      { etiqueta: 'B', valor: 0 },
      { etiqueta: 'C', valor: 0 },
      { etiqueta: 'D', valor: 1 },
      { etiqueta: 'E', valor: 0 },
    ]
    const { container } = render(<SerieBarras titulo="Serie" datos={cinco} />)

    expect(container.querySelectorAll('rect[data-bar]')).toHaveLength(5)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
  })

  it('scales bars against the largest value in the series', () => {
    const { container } = render(
      <SerieBarras titulo="Serie" datos={[{ etiqueta: 'A', valor: 50 }, { etiqueta: 'B', valor: 100 }]} />,
    )

    const bars = Array.from(container.querySelectorAll('rect[data-bar]'))
    expect(bars).toHaveLength(2)

    const [barA, barB] = bars as [Element, Element]
    const alturaA = Number(barA.getAttribute('height'))
    const alturaB = Number(barB.getAttribute('height'))

    expect(alturaB).toBeGreaterThan(alturaA)
    expect(alturaA).toBeCloseTo(alturaB / 2, 0)
  })
})

describe('SerieBarras — loading', () => {
  it('shows a loading affordance and NO zero while loading', () => {
    render(<SerieBarras titulo="Compras por mes" datos={undefined} isLoading />)

    expect(screen.getByRole('status')).toBeInTheDocument()
    // A zero shown during loading is indistinguishable from a real "no
    // movement" zero, and only the second one is true (design.md D7).
    expect(screen.queryByText(/\$\s?0(,00)?$/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

describe('SerieBarras — empty range', () => {
  it('says there was no movement when every period is zero', () => {
    render(
      <SerieBarras
        titulo="Compras por mes"
        datos={[
          { etiqueta: 'Ene', valor: 0 },
          { etiqueta: 'Feb', valor: 0 },
        ]}
      />,
    )

    // All-zero bars are visually indistinguishable from a broken chart, so
    // the text is what disambiguates (design.md D6).
    expect(screen.getByText(/sin movimiento/i)).toBeInTheDocument()
  })

  it('still lists the zero periods alongside the message', () => {
    render(
      <SerieBarras
        titulo="Compras por mes"
        datos={[
          { etiqueta: 'Ene', valor: 0 },
          { etiqueta: 'Feb', valor: 0 },
        ]}
      />,
    )

    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('says so when the backend returned no periods at all', () => {
    render(<SerieBarras titulo="Compras por mes" datos={[]} />)

    expect(screen.getByText(/sin movimiento/i)).toBeInTheDocument()
  })
})
