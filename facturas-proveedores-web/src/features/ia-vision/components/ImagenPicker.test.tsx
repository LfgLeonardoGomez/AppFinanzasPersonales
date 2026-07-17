/**
 * Tests for the ImagenPicker component (C-15, section 3).
 *
 * TDD: Task 3.1 (RED) → 3.2 (GREEN) → 3.3 (TRIANGULATE).
 *
 * The ImagenPicker is a presentational component with two ways to pick a
 * file: a native `<input type="file">` (click → OS file dialog) and a
 * drag-and-drop drop zone. Client-side validation is for UX only (the
 * C-14 backend is the validation authority, RN-IA-01). The picker:
 *   - accepts only image/jpeg, image/png, image/webp
 *   - rejects files larger than 10 MB
 *   - shows an inline error message on rejection (does NOT call onPick)
 *   - is inert when `disabled` is true
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImagenPicker } from './ImagenPicker'

function makeFile(name: string, type: string, sizeBytes: number): File {
  const bytes = new Uint8Array(sizeBytes)
  return new File([bytes], name, { type })
}

describe('ImagenPicker — file input (Task 3.1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a file input whose accept includes the image MIME types and extensions', () => {
    render(<ImagenPicker onPick={vi.fn()} />)
    const input = screen.getByLabelText(/imagen/i) as HTMLInputElement
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(input.type).toBe('file')
    // Extensions (.jfif etc.) are included so WhatsApp images show up in the
    // OS file dialog, which filters by the accept attribute.
    expect(input.accept).toBe(
      'image/jpeg,image/png,image/webp,.jpg,.jpeg,.jfif,.png,.webp',
    )
  })

  it('calls onPick with a valid JPEG file', async () => {
    const onPick = vi.fn()
    render(<ImagenPicker onPick={onPick} />)
    const input = screen.getByLabelText(/imagen/i) as HTMLInputElement
    const file = makeFile('factura.jpg', 'image/jpeg', 1024)
    await userEvent.upload(input, file)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(file)
  })

  it('accepts a JPEG whose type is empty (WhatsApp/OS quirk) via its extension', () => {
    const onPick = vi.fn()
    render(<ImagenPicker onPick={onPick} />)
    const input = screen.getByLabelText(/imagen/i) as HTMLInputElement
    // WhatsApp / some OSes report an empty MIME type for a valid JPEG.
    const file = makeFile('IMG-20260101-WA0001.jpg', '', 1024)
    fireEvent.change(input, { target: { files: [file] } })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(file)
  })

  it('accepts a .jfif file (common WhatsApp/Windows JPEG variant)', () => {
    const onPick = vi.fn()
    render(<ImagenPicker onPick={onPick} />)
    const input = screen.getByLabelText(/imagen/i) as HTMLInputElement
    const file = makeFile('IMG-20260101-WA0001.jfif', '', 1024)
    fireEvent.change(input, { target: { files: [file] } })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(file)
  })

  it('shows the format error and does NOT call onPick when a PDF is selected', () => {
    const onPick = vi.fn()
    render(<ImagenPicker onPick={onPick} />)
    const input = screen.getByLabelText(/imagen/i) as HTMLInputElement
    const file = makeFile('doc.pdf', 'application/pdf', 1024)
    fireEvent.change(input, { target: { files: [file] } })
    expect(onPick).not.toHaveBeenCalled()
    expect(
      screen.getByText(/Formato no soportado\. Solo se aceptan imágenes JPG, PNG o WebP\./),
    ).toBeInTheDocument()
  })

  it('shows the size error and does NOT call onPick when a 11 MB file is selected', () => {
    const onPick = vi.fn()
    render(<ImagenPicker onPick={onPick} />)
    const input = screen.getByLabelText(/imagen/i) as HTMLInputElement
    const file = makeFile('big.jpg', 'image/jpeg', 11 * 1024 * 1024)
    fireEvent.change(input, { target: { files: [file] } })
    expect(onPick).not.toHaveBeenCalled()
    expect(
      screen.getByText(/La imagen supera el tamaño máximo de 10 MB\./),
    ).toBeInTheDocument()
  })
})

describe('ImagenPicker — drag-and-drop (Task 3.1)', () => {
  it('calls onPick when a valid image is dropped on the drop zone', () => {
    const onPick = vi.fn()
    render(<ImagenPicker onPick={onPick} />)
    const dropZone = screen.getByTestId('imagen-picker-dropzone')
    const file = makeFile('dropped.png', 'image/png', 2048)
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(file)
  })

  it('does NOT call onPick when an invalid file is dropped', () => {
    const onPick = vi.fn()
    render(<ImagenPicker onPick={onPick} />)
    const dropZone = screen.getByTestId('imagen-picker-dropzone')
    const file = makeFile('notes.pdf', 'application/pdf', 1024)
    fireEvent.drop(dropZone, { dataTransfer: { files: [file] } })
    expect(onPick).not.toHaveBeenCalled()
  })
})

describe('ImagenPicker — disabled state and edge cases (Task 3.3, TRIANGULATE)', () => {
  it('disables the file input when disabled is true', () => {
    render(<ImagenPicker onPick={vi.fn()} disabled />)
    const input = screen.getByLabelText(/imagen/i) as HTMLInputElement
    expect(input).toBeDisabled()
  })

  it('rejects a .heic file with the format error (defense in depth)', () => {
    const onPick = vi.fn()
    render(<ImagenPicker onPick={onPick} />)
    const input = screen.getByLabelText(/imagen/i) as HTMLInputElement
    const file = makeFile('photo.heic', 'image/heic', 1024)
    fireEvent.change(input, { target: { files: [file] } })
    expect(onPick).not.toHaveBeenCalled()
    expect(
      screen.getByText(/Formato no soportado\. Solo se aceptan imágenes JPG, PNG o WebP\./),
    ).toBeInTheDocument()
  })

  it('accepts a 9.99 MB image (just under the limit)', async () => {
    const onPick = vi.fn()
    render(<ImagenPicker onPick={onPick} />)
    const input = screen.getByLabelText(/imagen/i) as HTMLInputElement
    const file = makeFile('almost-10mb.jpg', 'image/jpeg', 9.99 * 1024 * 1024)
    await userEvent.upload(input, file)
    expect(onPick).toHaveBeenCalledTimes(1)
  })
})
