/**
 * Tests for ArchivoPreviewDialog (C-24, archivo-viewer capability).
 *
 * In-app preview for a factura/comprobante URL — image or PDF — with an
 * always-visible "Abrir en pestaña nueva" fallback link (mobile PWA
 * webviews sometimes refuse to render embedded PDFs). Radix Dialog,
 * controlled open/onOpenChange, matching the ProveedorDialog pattern.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ArchivoPreviewDialog } from './ArchivoPreviewDialog'

describe('ArchivoPreviewDialog', () => {
  it('renders an <img> for an image URL, plus the fallback link', () => {
    render(
      <ArchivoPreviewDialog
        url="https://res.cloudinary.com/demo/facturas/abc.jpg"
        open
        onOpenChange={vi.fn()}
      />,
    )
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'https://res.cloudinary.com/demo/facturas/abc.jpg')

    const link = screen.getByRole('link', { name: /abrir en pestaña nueva/i })
    expect(link).toHaveAttribute('href', 'https://res.cloudinary.com/demo/facturas/abc.jpg')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders an embedded PDF viewer for a .pdf URL, plus the fallback link', () => {
    render(
      <ArchivoPreviewDialog
        url="https://res.cloudinary.com/demo/facturas/abc.pdf"
        open
        onOpenChange={vi.fn()}
      />,
    )
    // No <img> rendered for the PDF branch
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    // An embedded viewer referencing the URL is present (iframe)
    const frame = screen.getByTitle(/vista previa/i)
    expect(frame.tagName.toLowerCase()).toBe('iframe')
    expect(frame).toHaveAttribute('src', 'https://res.cloudinary.com/demo/facturas/abc.pdf')

    const link = screen.getByRole('link', { name: /abrir en pestaña nueva/i })
    expect(link).toHaveAttribute('href', 'https://res.cloudinary.com/demo/facturas/abc.pdf')
  })

  it('classifies a .pdf URL with a query string as PDF (query string does not defeat detection)', () => {
    render(
      <ArchivoPreviewDialog
        url="https://res.cloudinary.com/demo/facturas/abc.pdf?v=2"
        open
        onOpenChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTitle(/vista previa/i)).toBeInTheDocument()
  })

  it('renders nothing when url is null', () => {
    render(<ArchivoPreviewDialog url={null} open onOpenChange={vi.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('calls onOpenChange(false) when the user presses Escape', async () => {
    const onOpenChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ArchivoPreviewDialog
        url="https://res.cloudinary.com/demo/facturas/abc.jpg"
        open
        onOpenChange={onOpenChange}
      />,
    )
    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('caps the dialog height with a dvh max-height and an internal scroll container', () => {
    render(
      <ArchivoPreviewDialog
        url="https://res.cloudinary.com/demo/facturas/abc.jpg"
        open
        onOpenChange={vi.fn()}
      />,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toMatch(/max-h-\[90dvh\]/)
    expect(dialog.className).toMatch(/overflow-y-auto/)
  })
})
