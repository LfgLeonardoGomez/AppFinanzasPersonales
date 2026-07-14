/**
 * useUpdateTema — TanStack Query mutation to persist the theme
 * to the backend (PATCH /api/me with tema_preferido).
 *
 * The runtime theme is applied optimistically via the store; this
 * hook is the durable side of the change (D6).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { patchMe } from '@shared/api/perfilApi'
import type { PerfilUpdate, TemaPreferido, Usuario } from '@shared/api/api'
import { useThemeStore } from './themeStore'

export function useUpdateTema() {
  const queryClient = useQueryClient()
  const setTema = useThemeStore((s) => s.setTema)

  return useMutation<Usuario, Error, TemaPreferido>({
    mutationFn: async (tema: TemaPreferido) => {
      const body: PerfilUpdate = { tema_preferido: tema }
      return patchMe(body)
    },
    onSuccess: (user, tema) => {
      // Update the runtime store (in case it wasn't already)
      setTema(tema)
      // Refresh the /me cache so subsequent reads see the new theme.
      void queryClient.invalidateQueries({ queryKey: ['me'] })
      // Use the fresh user object as the new cache value if provided.
      if (user) {
        queryClient.setQueryData(['me'], user)
      }
    },
  })
}
