/**
 * AvatarUploader — uploads the user's avatar via a signed Cloudinary preset (C-05).
 *
 * Flow (D7):
 *  1. Client-side validation: type ∈ {pdf, jpg, png}, size ≤ 10 MB.
 *  2. GET /api/cloudinary/preset-firmado?tipo=avatar (signed preset).
 *  3. Direct upload to Cloudinary's upload endpoint (NOT through our Axios
 *     client — no withCredentials, no Authorization header).
 *  4. POST /api/me/avatar with the secure_url from Cloudinary.
 *  5. Refresh the /me query so the new avatar is shown.
 *
 * All three stages surface errors to the user; the file is rejected
 * client-side before any network call when type/size are wrong.
 */
import { type ChangeEvent, useState } from 'react'
import { useUpdateAvatar } from '../api/perfilHooks'
import { getSignedPreset } from '@shared/api/perfilApi'

const ACCEPTED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB

interface AvatarUploaderProps {
  currentUrl: string | null
  userId: string
}

export function AvatarUploader({ currentUrl }: AvatarUploaderProps) {
  const updateAvatar = useUpdateAvatar()
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const onChange = async (e: ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return

    // Client-side validation
    if (!ACCEPTED_MIME.has(file.type)) {
      setError('Formato no soportado. Usá PDF, JPG o PNG.')
      return
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('El archivo es demasiado grande (máx. 10 MB).')
      return
    }

    setUploading(true)
    try {
      // 1. Fetch the signed preset from the backend.
      const preset = await getSignedPreset('avatar')

      // 2. Direct upload to Cloudinary (NOT through our Axios client).
      const formData = new FormData()
      formData.append('file', file)
      formData.append('api_key', preset.api_key)
      formData.append('timestamp', String(preset.timestamp))
      formData.append('signature', preset.signature)
      formData.append('folder', preset.folder)

      const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${preset.cloud_name}/image/upload`
      const cloudRes = await fetch(cloudinaryUrl, {
        method: 'POST',
        body: formData,
      })
      if (!cloudRes.ok) {
        setError('No se pudo subir el archivo a Cloudinary.')
        return
      }
      const cloudData: { secure_url?: string } = await cloudRes.json()
      const secureUrl = cloudData.secure_url
      if (!secureUrl) {
        setError('No se pudo subir el archivo a Cloudinary.')
        return
      }

      // 3. Tell the backend to persist the URL.
      await updateAvatar.mutateAsync({ avatar_url: secureUrl })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al subir el avatar.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {currentUrl ? (
        <img
          src={currentUrl}
          alt="Avatar"
          className="h-16 w-16 rounded-full object-cover"
        />
      ) : (
        <div
          aria-label="Sin avatar"
          className="flex h-16 w-16 items-center justify-center rounded-full bg-gray-200 text-sm text-gray-500 dark:bg-gray-700 dark:text-gray-300"
        >
          —
        </div>
      )}

      <label
        htmlFor="avatar-input"
        className="cursor-pointer text-sm text-blue-600 hover:underline"
      >
        {uploading ? 'Subiendo…' : 'Subir avatar'}
      </label>
      <input
        id="avatar-input"
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
        onChange={onChange}
        disabled={uploading}
        className="sr-only"
        aria-label="Subir avatar"
      />

      {error && (
        <p role="alert" className="max-w-[12rem] text-center text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
