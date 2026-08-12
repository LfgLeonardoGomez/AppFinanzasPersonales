/**
 * TanStack Query hooks for team management (C-29 backend, C-30 screens).
 *
 * Every endpoint here is admin-only on the server (403 otherwise). The UI hides
 * the section for non-admins, but that is courtesy, not access control — the
 * backend remains the authority.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@shared/api/client'
import type { InvitacionResponse, MiembroResponse } from '@shared/api/api'

export const EQUIPO_QUERY_KEYS = {
  miembros: ['equipo', 'miembros'] as const,
}

/**
 * The negocio's members, deactivated ones included.
 *
 * The deactivated have to be here: an admin cannot reactivate someone they
 * cannot see.
 */
export function useMiembros(enabled = true) {
  return useQuery<MiembroResponse[]>({
    queryKey: EQUIPO_QUERY_KEYS.miembros,
    queryFn: async () => {
      const res = await apiClient.get<MiembroResponse[]>('/equipo')
      return res.data
    },
    enabled,
  })
}

/**
 * Issue a single-use join code.
 *
 * The readable code comes back in this response and nowhere else — only its
 * hash is stored server-side, so it cannot be fetched again afterwards.
 */
export function useCrearInvitacion() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<InvitacionResponse>('/equipo/invitaciones')
      return res.data
    },
  })
}

export function useDesactivarMiembro() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (miembroId: string) => {
      const res = await apiClient.post<MiembroResponse>(
        `/equipo/${miembroId}/desactivar`,
      )
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPO_QUERY_KEYS.miembros })
    },
  })
}

export function useReactivarMiembro() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (miembroId: string) => {
      const res = await apiClient.post<MiembroResponse>(
        `/equipo/${miembroId}/reactivar`,
      )
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPO_QUERY_KEYS.miembros })
    },
  })
}

/**
 * Turn a failed deactivation into something the admin can act on.
 *
 * The 409 is the last-admin guard: the negocio would be left with nobody able
 * to invite or reactivate, and with no admin promotion in this version there
 * is no way back. A generic "something went wrong" would leave them retrying.
 */
export function getDesactivarErrorMessage(error: unknown): string {
  const status = (error as { response?: { status?: number } })?.response?.status

  if (status === 409) {
    return (
      'No podés desactivar al único administrador activo: el negocio quedaría ' +
      'sin nadie que pueda invitar ni reactivar miembros.'
    )
  }
  return 'No se pudo completar la operación. Intentá de nuevo.'
}
