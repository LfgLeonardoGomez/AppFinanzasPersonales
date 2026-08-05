/**
 * FileUploadField — single file upload via signed Cloudinary preset.
 *
 * Premium redesign: card-like drop zone with iconography and refined buttons.
 * Test contracts preserved: aria-label="Archivo adjunto", aria-label="Subir archivo",
 * alert roles, id="file-upload-input", id="file-upload-error".
 */
import { useState, useRef, type ChangeEvent } from 'react'
import { useCloudinaryPreset } from '../api/facturasHooks'
import { uploadToCloudinary } from '@shared/utils/uploadToCloudinary'
import { Upload, File, X, Eye } from 'lucide-react'
import { ArchivoPreviewDialog } from '@shared/components/ArchivoPreviewDialog/ArchivoPreviewDialog'

const MAX_SIZE_BYTES = 10 * 1024 * 1024
const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png']
const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png']

interface FileUploadFieldProps {
  tipo: string
  onUrlChange: (url: string | null) => void
  currentUrl?: string | null
}

function isValidType(file: File): boolean {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'))
  return ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTENSIONS.includes(ext)
}

function isValidSize(file: File): boolean {
  return file.size <= MAX_SIZE_BYTES
}

export function FileUploadField({ tipo, onUrlChange, currentUrl }: FileUploadFieldProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: preset, isLoading: isPresetLoading } = useCloudinaryPreset(
    selectedFile ? tipo : '',
  )

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    setValidationError(null)
    setUploadError(null)
    setSelectedFile(null)

    if (!file) return

    if (!isValidType(file)) {
      setValidationError('Tipo de archivo no permitido. Solo se aceptan PDF, JPG y PNG.')
      return
    }

    if (!isValidSize(file)) {
      setValidationError('El tamaño del archivo supera el límite de 10 MB.')
      return
    }

    setSelectedFile(file)
  }

  async function handleUpload() {
    if (!selectedFile || !preset) return

    setIsUploading(true)
    setUploadError(null)

    try {
      const url = await uploadToCloudinary(selectedFile, preset)
      onUrlChange(url)
      setSelectedFile(null)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Error de conexión al subir el archivo.')
    } finally {
      setIsUploading(false)
    }
  }

  const error = validationError ?? uploadError

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="file-upload-input" className="text-sm font-medium text-navy-700 dark:text-zinc-300">
        Archivo adjunto (PDF, JPG, PNG — máx. 10 MB)
      </label>

      <div className="rounded-xl border border-dashed border-black/[0.10] bg-cream-dark/30 p-4 transition-colors hover:bg-cream-dark/50 dark:border-white/10 dark:bg-white/[0.02] dark:hover:bg-white/[0.04]">
        <input
          id="file-upload-input"
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          onChange={handleFileChange}
          aria-label="Archivo adjunto"
          aria-describedby={error ? 'file-upload-error' : undefined}
          aria-invalid={Boolean(error)}
          className="sr-only"
        />

        {!selectedFile && !currentUrl && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-2 rounded-lg py-4 text-sm text-navy-500 transition-colors hover:text-navy-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-black/[0.04] dark:bg-card-dark dark:ring-white/10">
              <Upload className="h-5 w-5" />
            </div>
            <span className="font-medium">Seleccionar archivo</span>
          </button>
        )}

        {currentUrl && !selectedFile && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-success-bg text-success ring-1 ring-success/15 dark:bg-success/10 dark:ring-success/20">
                <File className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-navy-700 dark:text-zinc-200">Archivo cargado</p>
                {/* c-26: opens the shared in-app viewer. It used to be an
                    <a target="_blank">, so the same "ver archivo" action left
                    the app here while staying inside it in the cuenta-corriente
                    tables (C-24). One action, one behaviour. */}
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1 text-xs text-accent-500 hover:text-accent-600 dark:text-accent-400"
                >
                  <Eye className="h-3 w-3" />
                  Ver adjunto
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onUrlChange(null)
                setSelectedFile(null)
              }}
              className="rounded-lg p-2 text-navy-400 transition-colors hover:bg-danger-bg hover:text-danger dark:text-zinc-500 dark:hover:bg-danger/10"
              aria-label="Quitar archivo"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {selectedFile && !validationError && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-navy-50 text-navy-500 ring-1 ring-black/[0.04] dark:bg-navy-800/30 dark:text-navy-300 dark:ring-white/10">
                  <File className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-navy-700 dark:text-zinc-200">
                  {selectedFile.name}
                </p>
              </div>
            <button
              type="button"
              onClick={() => {
                setSelectedFile(null)
                if (inputRef.current) inputRef.current.value = ''
              }}
              className="rounded-lg p-2 text-navy-400 transition-colors hover:bg-danger-bg hover:text-danger dark:text-zinc-500 dark:hover:bg-danger/10"
              aria-label="Cancelar"
            >
              <X className="h-4 w-4" />
            </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleUpload()}
                disabled={isUploading || isPresetLoading || !preset}
                aria-label="Subir archivo"
                className="inline-flex items-center gap-1.5 rounded-full bg-accent-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(99,91,255,0.25)] transition-all hover:bg-accent-600 active:scale-[0.98] disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                {isUploading ? 'Subiendo…' : 'Subir'}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p id="file-upload-error" role="alert" aria-live="assertive" className="text-sm text-danger">
          {error}
        </p>
      )}

      <ArchivoPreviewDialog
        url={currentUrl ?? null}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Archivo adjunto"
      />
    </div>
  )
}

export default FileUploadField
