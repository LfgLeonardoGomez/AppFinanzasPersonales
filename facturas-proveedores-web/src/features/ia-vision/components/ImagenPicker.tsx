/**
 * ImagenPicker — image-only file input with drag-and-drop (C-15, section 3).
 *
 * The picker is a presentational component used inside the IA vision
 * modal's idle state. It accepts a file via two paths:
 *   1. a native `<input type="file">` (click → OS file dialog)
 *   2. a drag-and-drop drop zone (drag a file over the picker and drop)
 *
 * Client-side validation is for UX only — the C-14 backend is the
 * authority (RN-IA-01) and will return 422 if a non-image or
 * oversize file is uploaded. The picker is intentionally defensive:
 * the user gets an immediate inline error message and the modal
 * never fires the extraction request. A rejected file clears the
 * input value so the same file can be re-selected (the native
 * `<input type="file">` does not fire `change` for the same value
 * otherwise).
 *
 * Visual design (D12 / high-end-visual-design):
 *   - Double-bezel: an outer `bg-white/60` ring with a soft inner
 *     `bg-white` card. A subtle `ring-1 ring-black/5` keeps the
 *     bezel visible without being heavy.
 *   - Drag-over state: a `--accent` background tint + a thicker
 *     ring. The transition uses the project's standard
 *     `cubic-bezier(0.23, 1, 0.32, 1)` ease-out (200ms) so the
 *     state change feels instant, not sluggish (Emil Kowalski's
 *     "perceived performance" rule).
 *   - The error message is a separate, role="alert" region so
 *     screen readers announce the rejection.
 */
import { useState, useRef, type DragEvent, type ChangeEvent } from 'react'

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_SIZE_BYTES = 10 * 1024 * 1024

const FORMAT_ERROR =
  'Formato no soportado. Solo se aceptan imágenes JPG, PNG o WebP.'
const SIZE_ERROR = 'La imagen supera el tamaño máximo de 10 MB.'

export interface ImagenPickerProps {
  onPick: (file: File) => void
  disabled?: boolean
}

function validate(file: File): string | null {
  if (!ACCEPTED_TYPES.has(file.type)) return FORMAT_ERROR
  if (file.size > MAX_SIZE_BYTES) return SIZE_ERROR
  return null
}

export function ImagenPicker({ onPick, disabled = false }: ImagenPickerProps) {
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function tryPick(file: File | undefined | null): void {
    if (!file) return
    const err = validate(file)
    if (err) {
      setError(err)
      // Clear the input so the same file can be re-selected after the
      // user fixes the issue (otherwise the change event won't fire).
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setError(null)
    onPick(file)
  }

  function handleInputChange(e: ChangeEvent<HTMLInputElement>): void {
    tryPick(e.target.files?.[0])
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    if (disabled) return
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave(_e: DragEvent<HTMLDivElement>): void {
    setIsDragOver(false)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>): void {
    if (disabled) return
    e.preventDefault()
    setIsDragOver(false)
    tryPick(e.dataTransfer.files?.[0])
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        data-testid="imagen-picker-dropzone"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={[
          'flex flex-col items-center justify-center gap-2',
          'rounded-2xl p-8 text-center',
          'ring-1 transition-all duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]',
          isDragOver
            ? 'bg-slate-900/5 ring-2 ring-slate-900/20'
            : 'bg-white/60 ring-black/5',
          disabled ? 'opacity-50 pointer-events-none' : 'cursor-pointer',
        ].join(' ')}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="Elegir imagen para extraer datos con IA"
          disabled={disabled}
          onChange={handleInputChange}
          className="sr-only"
        />
        <span className="text-sm font-medium text-slate-900">
          Arrastrá una imagen o hacé click para elegir un archivo
        </span>
        <span className="text-xs text-slate-500">
          JPG, PNG o WebP · máximo 10 MB
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      ) : null}
    </div>
  )
}
