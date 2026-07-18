/**
 * uploadToCloudinary — shared raw upload helper (C-21, D3).
 *
 * Extracted from `FileUploadField.tsx` (C-08/C-09) so both the manual
 * file-upload field AND the `PropuestaIAModal` (C-21) share ONE upload
 * implementation instead of two copies drifting apart. The signed
 * preset (`api_key`, `signature`, `timestamp`, `cloud_name`, `folder`,
 * `allowed_formats`, `max_file_size`) is obtained via
 * `getCloudinaryPreset` / `useCloudinaryPreset` — this helper only
 * performs the direct-to-Cloudinary POST.
 *
 * This is a SIGNED upload (not an unsigned `upload_preset` upload): the
 * backend signs `timestamp + folder + allowed_formats + max_file_size`,
 * so the request MUST send back exactly those signed params (plus
 * `api_key` and `signature`) and must NOT send `upload_preset`.
 * Cloudinary recomputes the signature over the received params; any
 * missing or extra signed param yields a 400 "Invalid Signature".
 *
 * Unlike `FileUploadField`'s original inline version (which swallowed
 * errors into local state), this helper THROWS on failure so callers
 * can `try/catch` — the modal needs to stop before firing the create
 * mutation on an upload failure (D3: "upload failure keeps the modal
 * open and fires no create").
 *
 * Cloudinary is ALWAYS mocked in tests via MSW (hard rule #9) — this
 * helper is never exercised against the real Cloudinary API in CI.
 */

export interface CloudinaryPreset {
  cloud_name: string
  signature: string
  api_key: string
  timestamp: number
  folder: string
  allowed_formats: string[]
  max_file_size: number
}

const UPLOAD_ERROR_FALLBACK = 'Error al subir el archivo.'
const UPLOAD_ERROR_NETWORK = 'Error de conexión al subir el archivo.'

/**
 * Upload a `File` to Cloudinary using a signed preset. Resolves with the
 * `secure_url` on success. Throws an `Error` (with a user-facing Spanish
 * message) on any failure: HTTP error status, an `error` field in the
 * JSON body, a missing `secure_url`, or a network/parsing failure.
 */
export async function uploadToCloudinary(file: File, preset: CloudinaryPreset): Promise<string> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('api_key', preset.api_key)
  formData.append('timestamp', String(preset.timestamp))
  formData.append('signature', preset.signature)
  // Signed params — must match EXACTLY what the backend signed, or
  // Cloudinary rejects with 400 "Invalid Signature". Lists are sent
  // comma-joined (the same serialization the signer uses). `max_file_size`
  // is deliberately NOT sent: it is not a Cloudinary upload parameter and
  // is not part of the signed set (Cloudinary would drop it anyway).
  formData.append('folder', preset.folder)
  formData.append('allowed_formats', preset.allowed_formats.join(','))

  let res: Response
  let data: { secure_url?: string; error?: { message: string } }
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${preset.cloud_name}/auto/upload`, {
      method: 'POST',
      body: formData,
    })
    data = (await res.json()) as { secure_url?: string; error?: { message: string } }
  } catch {
    throw new Error(UPLOAD_ERROR_NETWORK)
  }

  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? UPLOAD_ERROR_FALLBACK)
  }

  if (!data.secure_url) {
    throw new Error(UPLOAD_ERROR_FALLBACK)
  }

  return data.secure_url
}
