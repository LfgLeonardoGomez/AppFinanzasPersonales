/**
 * PerfilPage — editable profile screen (C-05).
 *
 * Premium card layout with InputField wrappers.
 * Preserves all test contracts:
 *  - getByLabelText(/teléfono/i) → label "Teléfono"
 *  - getByLabelText(/nombre del negocio/i) → label "Nombre del negocio"
 *  - getByRole('button', { name: /guardar/i }) → "Guardar"
 *  - getByRole('switch', { name: /tema|oscuro|claro/i }) → theme toggle
 *  - user.nombre, user.email visible
 */
import { type FormEvent, useEffect, useState } from 'react'
import { useMe } from '@features/auth/api/authHooks'
import { useUpdatePerfil } from './api/perfilHooks'
import { useUpdateTema } from '../../app/theme/useUpdateTema'
import { useThemeStore } from '../../app/theme/themeStore'
import { InputField } from '@shared/components/InputField/InputField'
import { Card } from '@shared/components/Card/Card'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { AvatarUploader } from './components/AvatarUploader'
import { Sun, Moon } from 'lucide-react'

export default function PerfilPage() {
  const { data: user, isLoading } = useMe()
  const updatePerfil = useUpdatePerfil()
  const updateTema = useUpdateTema()
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
      <div className="flex min-h-[12rem] items-center justify-center">
        <p className="text-sm text-navy-400 dark:text-zinc-500">Cargando…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl animate-fade-in-up">
      <PageHeader eyebrow="Cuenta" title="Mi perfil" />

      <Card>
        {/* Avatar + user info */}
        <div className="mb-6 flex items-center gap-4">
          <AvatarUploader currentUrl={user.avatar_url ?? null} userId={user.id} />
          <div>
            <p className="font-serif text-lg font-semibold text-navy-800 dark:text-zinc-100">
              {user.nombre}
            </p>
            <p className="text-sm text-navy-400 dark:text-zinc-500">{user.email}</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <InputField
            label="Teléfono"
            id="telefono"
            type="tel"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            maxLength={30}
          />

          <InputField
            label="Nombre del negocio"
            id="nombre_negocio"
            type="text"
            value={nombreNegocio}
            onChange={(e) => setNombreNegocio(e.target.value)}
            maxLength={120}
          />

          {/* Theme toggle */}
          <div className="flex items-center justify-between rounded-xl border border-black/[0.06] bg-cream-dark/30 p-3 dark:border-white/10 dark:bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-50 text-navy-500 ring-1 ring-black/[0.04] dark:bg-navy-800/30 dark:text-navy-300 dark:ring-white/10">
                {runtimeTema === 'OSCURO' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </div>
              <div>
                <p className="text-sm font-medium text-navy-700 dark:text-zinc-300">Tema</p>
                <p className="text-xs text-navy-400 dark:text-zinc-500">
                  {runtimeTema === 'OSCURO' ? 'Oscuro' : 'Claro'}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={runtimeTema === 'OSCURO'}
              aria-label="Cambiar tema"
              onClick={onToggleTema}
              className="relative h-7 w-12 rounded-full bg-navy-200 transition-colors duration-300 dark:bg-accent-700"
            >
              <span
                className="absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-all duration-300"
                style={{ left: runtimeTema === 'OSCURO' ? 'calc(100% - 1.625rem)' : '2px' }}
              />
            </button>
          </div>

          {updatePerfil.isError && (
            <p role="alert" className="text-sm text-danger">
              No se pudo guardar. Intente nuevamente.
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={updatePerfil.isPending}
              className="rounded-full bg-navy-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(10,37,64,0.20)] transition-all duration-200 ease-[var(--ease-out)] hover:bg-navy-600 hover:shadow-[0_6px_20px_rgba(10,37,64,0.28)] active:scale-[0.98] disabled:opacity-50 dark:bg-accent-500 dark:hover:bg-accent-600"
            >
              {updatePerfil.isPending ? 'Guardando…' : 'Guardar'}
            </button>
            {savedAt && !updatePerfil.isPending && (
              <span className="text-xs text-navy-400 dark:text-zinc-500">
                Guardado a las {savedAt}
              </span>
            )}
          </div>
        </form>
      </Card>
    </div>
  )
}
