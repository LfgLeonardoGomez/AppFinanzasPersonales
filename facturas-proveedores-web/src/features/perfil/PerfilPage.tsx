/**
 * PerfilPage — account + preferences screen (C-05), rebuilt to the new
 * design system (specs/design + Perfil.dc.html handoff): identity card,
 * "Cuenta" card (editable fields), "Preferencias" card (theme toggle),
 * "Cerrar sesión" danger button.
 *
 * Preserves all test contracts:
 *  - getByLabelText(/teléfono/i) → label "Teléfono"
 *  - getByLabelText(/nombre del negocio/i) → label "Nombre del negocio"
 *  - getByRole('button', { name: /guardar/i }) → "Guardar"
 *  - getByRole('switch', { name: /tema|oscuro|claro/i }) → theme toggle
 *  - user.nombre, user.email visible
 *
 * The design also shows CUIT + "cambiar contraseña" rows in the "Cuenta"
 * card — there is no backend field/endpoint for either yet, so only the
 * fields the API actually supports (teléfono, nombre del negocio) are
 * rendered. See integration TODOs in the task report.
 */
import { type FormEvent, useEffect, useState } from 'react'
import { useMe, useLogout } from '@features/auth/api/authHooks'
import { useUpdatePerfil } from './api/perfilHooks'
import { useUpdateTema } from '../../app/theme/useUpdateTema'
import { useThemeStore } from '../../app/theme/themeStore'
import { InputField } from '@shared/components/InputField/InputField'
import { Card } from '@shared/components/Card/Card'
import { Button } from '@shared/components/Button/Button'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { AvatarUploader } from './components/AvatarUploader'

export default function PerfilPage() {
  const { data: user, isLoading } = useMe()
  const updatePerfil = useUpdatePerfil()
  const updateTema = useUpdateTema()
  const logoutMutation = useLogout()
  const runtimeTema = useThemeStore((s) => s.tema)

  const [telefono, setTelefono] = useState('')
  const [nombreNegocio, setNombreNegocio] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    if (user) {
      setTelefono(user.telefono ?? '')
      setNombreNegocio(user.nombre_negocio ?? '')
    }
  }, [user])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    updatePerfil.mutate(
      { telefono, nombre_negocio: nombreNegocio },
      {
        onSuccess: () => {
          setSavedAt(new Date().toLocaleTimeString())
        },
      },
    )
  }

  const onToggleTema = () => {
    const next = runtimeTema === 'OSCURO' ? 'CLARO' : 'OSCURO'
    updateTema.mutate(next)
  }

  if (isLoading || !user) {
    return (
      <div className="flex min-h-[12rem] items-center justify-center font-inter">
        <p className="text-sm text-ink-soft">Cargando…</p>
      </div>
    )
  }

  const isOscuro = runtimeTema === 'OSCURO'

  return (
    <div className="mx-auto max-w-2xl animate-fade-in-up font-inter">
      <PageHeader eyebrow="Cuenta" title="Mi perfil" />

      {/* Identity card */}
      <Card className="mb-5 flex items-center gap-5">
        <AvatarUploader currentUrl={user.avatar_url ?? null} userId={user.id} nombre={user.nombre} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-ink">{user.nombre}</p>
          <p className="truncate text-sm text-ink-soft">{user.email}</p>
        </div>
      </Card>

      {/* Cuenta card */}
      <Card className="mb-5">
        <p className="mb-4 text-sm font-bold text-ink">Cuenta</p>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <InputField
            label="Nombre del negocio"
            id="nombre_negocio"
            type="text"
            value={nombreNegocio}
            onChange={(e) => setNombreNegocio(e.target.value)}
            maxLength={120}
          />

          <InputField
            label="Teléfono"
            id="telefono"
            type="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            maxLength={30}
          />

          {updatePerfil.isError && (
            <p role="alert" className="text-sm text-danger">
              No se pudo guardar. Intente nuevamente.
            </p>
          )}

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" loading={updatePerfil.isPending}>
              Guardar
            </Button>
            {savedAt && !updatePerfil.isPending && (
              <span className="text-xs text-ink-soft">Guardado a las {savedAt}</span>
            )}
          </div>
        </form>
      </Card>

      {/* Preferencias card */}
      <Card className="mb-5">
        <p className="mb-1 text-sm font-bold text-ink">Preferencias</p>
        <div className="flex items-center justify-between border-t border-border-subtle-2 py-3.5">
          <div>
            <p className="text-[13.5px] font-semibold text-ink">Tema</p>
            <p className="text-xs text-ink-soft">{isOscuro ? 'Oscuro' : 'Claro'}</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isOscuro}
            aria-label="Cambiar tema"
            onClick={onToggleTema}
            className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-300 ${
              isOscuro ? 'bg-violet-500' : 'bg-border-subtle-2'
            }`}
          >
            <span
              className="absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-all duration-300"
              style={{ left: isOscuro ? '19px' : '3px' }}
            />
          </button>
        </div>
      </Card>

      <Button
        variant="danger"
        fullWidth
        onClick={() => logoutMutation.mutate()}
        loading={logoutMutation.isPending}
      >
        Cerrar sesión
      </Button>
    </div>
  )
}
