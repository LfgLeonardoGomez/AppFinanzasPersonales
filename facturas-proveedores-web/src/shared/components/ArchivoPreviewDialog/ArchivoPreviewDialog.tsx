/**
 * ArchivoPreviewDialog — shared in-app preview for a factura or comprobante
 * URL (C-24, archivo-viewer capability).
 *
 * Consumed from TablaFacturasConEstado ("Ver archivo" on a factura row) and
 * PagosRegistrados ("Ver archivo" on a pago row, sourced from the payment's
 * comprobante) so the format-detection logic and the dialog viewport-fit
 * boilerplate live in exactly one place (design D1).
 *
 * Follows the same controlled Radix Dialog pattern as ProveedorDialog:
 * Dialog.Root/Portal/Overlay/Content, sr-only Title/Description, controlled
 * `open`/`onOpenChange`.
 *
 * Format detection (design D2) is a network-free extension check on the URL
 * (ignoring any query string): `.pdf` renders an embedded viewer, anything
 * else renders an `<img>`. Cloudinary's three upload presets (avatar,
 * factura, comprobante) all constrain `allowed_formats` to
 * `("pdf", "jpg", "png")`, so this is reliable without a network round-trip.
 *
 * The "Abrir en pestaña nueva" fallback link is ALWAYS rendered (design D3)
 * — embedded PDF rendering is unreliable inside mobile PWA "standalone"
 * webviews, which sometimes show a blank frame instead of the PDF.
 *
 * The dialog caps its height at `max-h-[90dvh]` with an internal scroll
 * container, matching the `modal-viewport-fit` pattern established in C-23
 * — no dialog in this codebase may clip its content off-screen.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useEffect, useState } from 'react'
import { ExternalLink, Minus, Plus, RotateCcw, X } from 'lucide-react'

interface ArchivoPreviewDialogProps {
  url: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string | undefined
}

function isPdf(url: string): boolean {
  const withoutQuery = url.split('?')[0] ?? ''
  return withoutQuery.toLowerCase().endsWith('.pdf')
}

/** Fit level. Below this the file shrinks to a thumbnail — never useful. */
const MIN_ZOOM = 1
/** Enough to read a CUIT or a handwritten amount on a phone photo. */
const MAX_ZOOM = 4
const ZOOM_STEP = 0.5

export function ArchivoPreviewDialog({
  url,
  open,
  onOpenChange,
  title = 'Vista previa del archivo',
}: ArchivoPreviewDialogProps) {
  const [zoom, setZoom] = useState(MIN_ZOOM)

  // A new file, or reopening, starts at fit level — inheriting the previous
  // file's zoom would open on an arbitrary corner of the image.
  useEffect(() => {
    setZoom(MIN_ZOOM)
  }, [url, open])

  if (!url) return null

  const pdf = isPdf(url)
  const clamp = (value: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm dark:bg-black/40" />
        <Dialog.Content
          aria-label={title}
          aria-modal="true"
          className="fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-card bg-surface p-6 shadow-card ring-1 ring-border-subtle focus:outline-none dark:bg-card-dark dark:ring-white/10"
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">
            Vista previa en la aplicación del archivo adjunto.
          </Dialog.Description>

          {/* Toolbar. Esc and backdrop-click already close the dialog, but both
              are invisible — and on touch there is no Esc key at all, so the
              explicit button is the only discoverable exit on mobile. */}
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              {!pdf && (
                <>
                  <button
                    type="button"
                    aria-label="Alejar"
                    onClick={() => setZoom((z) => clamp(z - ZOOM_STEP))}
                    disabled={zoom <= MIN_ZOOM}
                    className="rounded-full p-2 text-ink-soft-2 transition-colors hover:bg-page/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-ink-soft">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    aria-label="Acercar"
                    onClick={() => setZoom((z) => clamp(z + ZOOM_STEP))}
                    disabled={zoom >= MAX_ZOOM}
                    className="rounded-full p-2 text-ink-soft-2 transition-colors hover:bg-page/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Restablecer zoom"
                    onClick={() => setZoom(MIN_ZOOM)}
                    disabled={zoom === MIN_ZOOM}
                    className="rounded-full p-2 text-ink-soft-2 transition-colors hover:bg-page/60 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              aria-label="Cerrar"
              onClick={() => onOpenChange(false)}
              className="rounded-full p-2 text-ink-soft-2 transition-colors hover:bg-danger-bg hover:text-danger"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* overflow-auto on the frame + transform on the image: panning is
              plain scrolling, which works with a mouse, a trackpad and a
              finger without a custom gesture handler. */}
          <div className="flex-1 overflow-auto rounded-card-sm">
            {pdf ? (
              <iframe
                src={url}
                title="Vista previa del archivo (PDF)"
                className="h-[70vh] w-full rounded-card-sm border border-border-subtle"
              />
            ) : (
              <img
                src={url}
                alt={title}
                style={{ transform: `scale(${zoom})`, transformOrigin: 'top center' }}
                className="max-h-[70vh] w-full rounded-card-sm object-contain transition-transform duration-150"
              />
            )}
          </div>

          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 self-start text-sm font-medium text-violet-500 transition-colors hover:text-violet-600"
          >
            <ExternalLink className="h-4 w-4" />
            Abrir en pestaña nueva
          </a>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default ArchivoPreviewDialog
