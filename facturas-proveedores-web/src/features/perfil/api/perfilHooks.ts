/**
 * TanStack Query hooks for the perfil/profile feature (C-05).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { patchMe, postMeAvatar } from '@shared/api/perfilApi'
import type { AvatarUpdate, PerfilUpdate, Usuario } from '@shared/api/api'

export const PERFIL_KEYS = {
  me: ['me'] as const,
}

/** PATCH /api/me — update optional profile fields. */
export function useUpdatePerfil() {
  const qc = useQueryClient()
  return useMutation<Usuario, Error, PerfilUpdate>({
    mutationFn: (data) => patchMe(data),
    onSuccess: (user) => {
      // Refresh /me so the rest of the app sees the new values.
      qc.setQueryData(PERFIL_KEYS.me, user)
      void qc.invalidateQueries({ queryKey: PERFIL_KEYS.me })
    },
  })
}

/** POST /api/me/avatar — store the avatar URL after Cloudinary upload. */
export function useUpdateAvatar() {
  const qc = useQueryClient()
  return useMutation<Usuario, Error, AvatarUpdate>({
    mutationFn: (data) => postMeAvatar(data),
    onSuccess: (user) => {
      qc.setQueryData(PERFIL_KEYS.me, user)
      void qc.invalidateQueries({ queryKey: PERFIL_KEYS.me })
    },
  })
}
