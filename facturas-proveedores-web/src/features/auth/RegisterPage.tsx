/**
 * Registration page — /registro
 *
 * Premium centered card, consistent with LoginPage.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useRegister } from './api/authHooks'
import { InputField } from '@shared/components/InputField/InputField'
import { Mail, Lock, User, AlertCircle } from 'lucide-react'

function validateForm(email: string, nombre: string, password: string): string | null {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Ingresá un email válido'
  }
  if (!nombre.trim()) {
    return 'El nombre es requerido'
  }
  if (password.length < 8) {
    return 'La contraseña debe tener mínimo 8 caracteres'
  }
  return null
}

function getServerErrorMessage(error: unknown): string {
  if (!isAxiosError(error)) return 'Error al registrar. Intentá de nuevo.'
  const status = error.response?.status
  const detail = error.response?.data?.detail as string | undefined
  if (status === 400 && typeof detail === 'string' && detail.includes('email')) {
    return 'Este email ya está registrado'
  }
  if (status === 422) {
    const details = error.response?.data?.detail as Array<{ msg: string }> | undefined
    if (Array.isArray(details) && details.length > 0) {
      return details[0]?.msg ?? 'Error de validación'
    }
    return 'Error de validación'
  }
  return 'Error al registrar. Intentá de nuevo.'
}

export default function RegisterPage() {
  const navigate = useNavigate()
  const registerMutation = useRegister()

  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [password, setPassword] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setClientError(null)
    const validationError = validateForm(email, nombre, password)
    if (validationError) {
      setClientError(validationError)
      return
    }
    registerMutation.mutate(
      { email, nombre, password },
      { onSuccess: () => { void navigate('/login') } },
    )
  }

  const serverError = registerMutation.isError ? getServerErrorMessage(registerMutation.error) : null
  const displayError = clientError ?? serverError

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-cream px-4 py-12 dark:bg-espresso">
      <div className="w-full max-w-md animate-fade-in-up">
        <div className="rounded-[2rem] bg-card/70 p-1.5 shadow-[0_8px_32px_rgba(10,37,64,0.08)] ring-1 ring-black/[0.04] backdrop-blur-md dark:bg-card-dark/70 dark:ring-white/10">
          <div className="rounded-[calc(2rem-0.375rem)] bg-card p-8 dark:bg-card-dark">
            <h1 className="mb-1 text-center font-serif text-2xl font-semibold text-navy-800 dark:text-zinc-100">
              Crear cuenta
            </h1>
            <p className="mb-6 text-center text-sm text-navy-400 dark:text-zinc-500">
              Empezá a gestionar tus facturas
            </p>

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <InputField
                label="Email"
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                icon={<Mail className="h-4 w-4" />}
                required
              />

              <InputField
                label="Nombre"
                id="nombre"
                name="nombre"
                type="text"
                autoComplete="name"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                icon={<User className="h-4 w-4" />}
                required
              />

              <InputField
                label="Contraseña"
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                icon={<Lock className="h-4 w-4" />}
                hint="Mín. ocho caracteres"
                required
              />

              {displayError && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger ring-1 ring-danger/10 dark:bg-danger/10"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  {displayError}
                </div>
              )}

              <button
                type="submit"
                disabled={registerMutation.isPending}
                className="mt-1 w-full rounded-full bg-navy-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(10,37,64,0.20)] transition-all duration-200 ease-[var(--ease-out)] hover:bg-navy-600 hover:shadow-[0_6px_20px_rgba(10,37,64,0.28)] active:scale-[0.98] disabled:opacity-50 dark:bg-accent-500 dark:hover:bg-accent-600"
              >
                {registerMutation.isPending ? 'Registrando…' : 'Registrar'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-navy-500 dark:text-zinc-400">
              ¿Ya tenés cuenta?{' '}
              <Link
                to="/login"
                className="font-semibold text-accent-500 transition-colors hover:text-accent-600 dark:text-accent-400"
              >
                Iniciar sesión
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
