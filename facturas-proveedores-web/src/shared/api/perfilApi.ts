/**
 * Raw Axios calls for the perfil/profile API (C-05).
 *
 * All calls go through the shared client (withCredentials + 401 interceptor).
 * Tokens are never read or stored; cookies only.
 *
 * Endpoints:
 *   - PATCH /api/me                        — partial profile update
 *   - POST  /api/me/avatar                 — set the avatar URL after upload
 *   - GET   /api/cloudinary/preset-firmado — signed Cloudinary upload preset
 */
import { apiClient } from './client'
import type {
  AvatarUpdate,
  PerfilUpdate,
  PresetFirmadoResponse,
  TipoUpload,
  Usuario,
} from './api'

export async function patchMe(data: PerfilUpdate): Promise<Usuario> {
  const res = await apiClient.patch<Usuario>('/me', data)
  return res.data
}

export async function postMeAvatar(data: AvatarUpdate): Promise<Usuario> {
  const res = await apiClient.post<Usuario>('/me/avatar', data)
  return res.data
}

export async function getSignedPreset(tipo: TipoUpload): Promise<PresetFirmadoResponse> {
  const res = await apiClient.get<PresetFirmadoResponse>('/cloudinary/preset-firmado', {
    params: { tipo },
  })
  return res.data
}
