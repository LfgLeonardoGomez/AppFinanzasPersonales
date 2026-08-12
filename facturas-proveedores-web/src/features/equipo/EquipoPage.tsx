/**
 * Equipo page — /equipo (C-30)
 *
 * Admin-only. The backend answers 403 to anyone else regardless of what this
 * renders: hiding the section is courtesy, not access control.
 *
 * Two details here are not cosmetic:
 *
 *  - The invitation code is shown once, in a dialog that will not close on a
 *    backdrop click. Only its hash is stored server-side, so this is the single
 *    chance to read it — losing it is recoverable but annoying, and an accidental
 *    dismiss is exactly how it gets lost.
 *  - Deactivated members stay in the list. An admin cannot reactivate someone
 *    they cannot see.
 */
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, Check, Copy, ShieldCheck, UserPlus } from 'lucide-react'
import { Button } from '@shared/components/Button/Button'
import { Card } from '@shared/components/Card/Card'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { useAuthStore } from '@features/auth/store/authStore'
import type { InvitacionResponse } from '@shared/api/api'
import {
  getDesactivarErrorMessage,
  useCrearInvitacion,
  useDesactivarMiembro,
  useMiembros,
  useReactivarMiembro,
} from './api/equipoHooks'

function CodigoDialog({
  invitacion,
  onClose,
}: {
  invitacion: InvitacionResponse
  onClose: () => void
}) {
  const [copiado, setCopiado] = useState(false)

  async function copiar() {
    try {
      await navigator.clipboard.writeText(invitacion.codigo)
      setCopiado(true)
    } catch {
      // Clipboard can be denied; the code is on screen either way.
      setCopiado(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm" />
        <Dialog.Content
          // Dismissing by backdrop or Esc would lose the code, and it cannot be
          // read again. Closing has to be deliberate — same reasoning as the
          // destructive supplier dialog (D-25).
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-card bg-surface p-6 shadow-xl"
        >
          <Dialog.Title className="text-lg font-semibold text-ink">
            Código de invitación
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-ink-muted">
            Pasáselo a la persona que querés sumar. Vence a las 48 horas.
          </Dialog.Description>

          <p
            data-testid="codigo-invitacion"
            className="mt-4 select-all rounded-xl bg-surface-muted px-4 py-3 text-center font-mono text-2xl tracking-[0.3em] text-ink"
          >
            {invitacion.codigo}
          </p>

          <div
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning ring-1 ring-warning/10"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            Anotalo ahora: por seguridad no vas a poder volver a verlo. Si lo
            perdés, generá uno nuevo.
          </div>

          <div className="mt-5 flex gap-2">
            <Button type="button" variant="secondary" fullWidth onClick={copiar}>
              {copiado ? (
                <>
                  <Check className="h-4 w-4" /> Copiado
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copiar código
                </>
              )}
            </Button>
            <Button type="button" fullWidth onClick={onClose}>
              Ya lo anoté
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default function EquipoPage() {
  const usuario = useAuthStore((s) => s.user)
  const esAdmin = usuario?.es_admin === true

  const { data: miembros, isLoading } = useMiembros(esAdmin)
  const crearInvitacion = useCrearInvitacion()
  const desactivar = useDesactivarMiembro()
  const reactivar = useReactivarMiembro()

  const [invitacion, setInvitacion] = useState<InvitacionResponse | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)

  if (!esAdmin) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <EmptyState
          title="No tenés permiso para ver el equipo"
          description="La gestión de miembros está reservada al administrador del negocio. Pedile a quien lo administra que haga el cambio."
        />
      </div>
    )
  }

  const errorDesactivar = desactivar.isError
    ? getDesactivarErrorMessage(desactivar.error)
    : null

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <PageHeader
          title="Equipo"
          description="Quién puede trabajar en este negocio."
        />
        <Button
          type="button"
          loading={crearInvitacion.isPending}
          onClick={() =>
            crearInvitacion.mutate(undefined, {
              onSuccess: (data) => setInvitacion(data),
            })
          }
        >
          <UserPlus className="h-4 w-4" /> Invitar
        </Button>
      </div>

      {errorDesactivar && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger ring-1 ring-danger/10"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {errorDesactivar}
        </div>
      )}

      {isLoading ? (
        <LoadingState />
      ) : !miembros || miembros.length === 0 ? (
        <EmptyState
          title="Todavía estás solo"
          description="Invitá a alguien para que pueda cargar facturas y pagos en este negocio."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {miembros.map((miembro) => (
            <li key={miembro.id}>
              <Card className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-medium text-ink">
                    {miembro.nombre}
                    {miembro.es_admin && (
                      <span
                        title="Administrador"
                        className="inline-flex items-center gap-1 rounded-pill bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700"
                      >
                        <ShieldCheck className="h-3 w-3" /> Admin
                      </span>
                    )}
                    {miembro.desactivado && (
                      <span className="inline-flex rounded-pill bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-muted">
                        Sin acceso
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-ink-muted">{miembro.email}</p>
                </div>

                {miembro.desactivado ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => reactivar.mutate(miembro.id)}
                  >
                    Reactivar
                  </Button>
                ) : confirmando === miembro.id ? (
                  <div className="flex shrink-0 gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setConfirmando(null)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => {
                        desactivar.mutate(miembro.id, {
                          onSettled: () => setConfirmando(null),
                        })
                      }}
                    >
                      Confirmar
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setConfirmando(miembro.id)}
                  >
                    Quitar acceso
                  </Button>
                )}
              </Card>

              {confirmando === miembro.id && (
                <p className="mt-1 px-4 text-sm text-ink-muted">
                  Pierde el acceso al instante, pero <strong>todo lo que cargó
                  se conserva</strong> y sigue visible para el resto del equipo.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {invitacion && (
        <CodigoDialog invitacion={invitacion} onClose={() => setInvitacion(null)} />
      )}
    </div>
  )
}
