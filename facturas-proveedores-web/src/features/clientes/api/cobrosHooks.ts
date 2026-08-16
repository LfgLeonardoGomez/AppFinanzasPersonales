/**
 * TanStack Query hook for cobros (C-36, design.md D4/D7).
 *
 * `useCrearCobro`'s mutation resolves `{ cobro, replay }` — the same result
 * object `crearCobro` returns — passed through UNWRAPPED. The form needs
 * the `replay` flag to distinguish "already recorded" from "just created"
 * (design.md D7); unwrapping it here to a bare `CobroCliente` is exactly the
 * change C-43 would then be forced to undo.
 *
 * Invalidates `CLIENTE_KEYS.all` on success — a prefix of both the account
 * being viewed (`CLIENTE_KEYS.cuentaCorriente(id)`) and the customer list's
 * balance column (design.md D4), so one invalidation covers both.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { crearCobro } from './cobrosApi'
import { CLIENTE_KEYS } from './clientesHooks'
import type { CobroClienteCreate } from '@shared/api/api'

export function useCrearCobro() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: CobroClienteCreate) => crearCobro(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLIENTE_KEYS.all })
    },
  })
}
