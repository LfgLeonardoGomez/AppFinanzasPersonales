/**
 * Tests for AuthShell — the shared visual shell for Login/Register/Recuperar/
 * ResetPassword (C-45 auth copy refresh).
 *
 * jsdom cannot evaluate media queries, so these tests do not assert on
 * viewport-dependent rendering (that responsive check is visual, done by the
 * product owner). Instead they assert the STRUCTURE that encodes the intent:
 *  - the brand panel is marked `aria-hidden` and `hidden lg:flex` — the
 *    decorative desktop-only surface.
 *  - the mobile footer phrase is a SEPARATE node, outside the brand panel,
 *    living alongside the form content in the form column — not a second
 *    copy stuck inside the hidden desktop panel.
 *
 * Note: `getByText` matches plain DOM text and does NOT respect
 * `aria-hidden` (only `getByRole` does accessibility-tree filtering), so
 * these tests locate the brand panel/footer explicitly via `aria-hidden`
 * and DOM containment instead of relying on query-level a11y filtering.
 */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthShell } from './AuthShell'

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthShell
        mode="login"
        title="Título"
        subtitle="Subtítulo"
        footerText="¿Ya tenés cuenta?"
        footerLinkTo="/registro"
        footerLinkLabel="Creá una"
      >
        <div data-testid="form-content">form</div>
      </AuthShell>
    </MemoryRouter>,
  )
}

describe('AuthShell — brand panel is desktop-only and decorative', () => {
  it('marks the brand panel as aria-hidden and lg-only', () => {
    const { container } = renderShell()
    const brandPanel = container.querySelector('[aria-hidden="true"].hidden')
    expect(brandPanel).not.toBeNull()
    expect(brandPanel).toHaveClass('hidden')
    expect(brandPanel).toHaveClass('lg:flex')
  })

  it('the brand headline talks about the broader business (ventas/clientes/proveedores), not only facturas', () => {
    const { container } = renderShell()
    const brandPanel = container.querySelector('[aria-hidden="true"].hidden')
    expect(brandPanel?.textContent).toMatch(/ventas.*clientes.*proveedores/i)
  })
})

describe('AuthShell — mobile footer phrase', () => {
  it('renders a discreet product phrase as a node separate from the brand panel', () => {
    const { container } = renderShell()
    const brandPanel = container.querySelector('[aria-hidden="true"].hidden')
    const matches = screen.getAllByText(/cargá facturas sacando una foto/i)

    // The phrase appears once in the (decorative, desktop-only) brand panel
    // and once as the mobile footer echo — two distinct nodes, not one
    // shared element.
    expect(matches).toHaveLength(2)
    const outsideBrandPanel = matches.filter((el) => !brandPanel?.contains(el))
    expect(outsideBrandPanel).toHaveLength(1)
  })

  it('the footer phrase is a sibling of the form content, inside the form column — not inside the brand panel', () => {
    const { container, getByTestId } = renderShell()
    const brandPanel = container.querySelector('[aria-hidden="true"].hidden')
    const formContent = getByTestId('form-content')
    const outsideBrandPanel = screen
      .getAllByText(/cargá facturas sacando una foto/i)
      .filter((el) => !brandPanel?.contains(el))

    expect(outsideBrandPanel).toHaveLength(1)
    const footerPhrase = outsideBrandPanel[0] as HTMLElement
    // Same ancestor column as the form — proves the phrase flows after the
    // form instead of living in the separate, aria-hidden brand panel.
    expect(formContent.closest('.animate-fade-in-up')?.contains(footerPhrase)).toBe(true)
  })
})

describe('AuthShell — old invoice-only copy is gone', () => {
  it('does not use the old facturas-only headline or the old standalone tagline', () => {
    const { container } = renderShell()
    expect(container.textContent).not.toMatch(
      /Cargá facturas sacando una foto\. El resto lo hace la IA\./,
    )
    expect(container.textContent).not.toMatch(/Finanzas para tu negocio, sin planillas\./)
  })
})
