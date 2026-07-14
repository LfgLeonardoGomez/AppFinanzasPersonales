/**
 * Login page — /login
 *
 * Premium centered card with double-bezel nesting and subtle backdrop blur.
 * Keeps all original functional behaviour: labels, error messages, routing.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useLogin, getLoginErrorMessage } from './api/authHooks'
import { InputField } from '@shared/components/InputField/InputField'
import { Mail, Lock, AlertCircle } from 'lucide-react'

function getDisplayError(error: unknown): string {
  if (!isAxiosError(error)) {
    if (error instanceof Error && error.message === 'Network Error') {
      return 'Sin conexión. Verificá tu red e intentá de nuevo.'
    }
    return getLoginErrorMessage(error)
  }
  return getLoginErrorMessage(error)
}

export default function LoginPage() {
  const navigate = useNavigate()
  const loginMutation = useLogin()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    loginMutation.mutate(
      { email, password, remember_me: rememberMe },
      { onSuccess: () => { void navigate('/') } },
    )
  }

  const displayError = loginMutation.isError ? getDisplayError(loginMutation.error) : null

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-cream px-4 py-12 dark:bg-espresso">
      <div className="w-full max-w-md animate-fade-in-up">
        {/* Double-bezel card */}
        <div className="rounded-[2rem] bg-card/70 p-1.5 shadow-[0_8px_32px_rgba(10,37,64,0.08)] ring-1 ring-black/[0.04] backdrop-blur-md dark:bg-card-dark/70 dark:ring-white/10">
          <div className="rounded-[calc(2rem-0.375rem)] bg-card p-8 dark:bg-card-dark">
            <h1 className="mb-1 text-center font-serif text-2xl font-semibold text-navy-800 dark:text-zinc-100">
              Iniciar sesión
            </h1>
            <p className="mb-6 text-center text-sm text-navy-400 dark:text-zinc-500">
              Accedé a tu panel de gestión
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
                label="Contraseña"
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                icon={<Lock className="h-4 w-4" />}
                required
              />

              <div className="flex items-center gap-2">
                <input
                  id="rememberMe"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="h-4 w-4 rounded border-black/[0.08] text-accent-500 focus:ring-accent-500/30 dark:border-white/10"
                />
                <label htmlFor="rememberMe" className="text-sm text-navy-600 dark:text-zinc-400">
                  Recordarme
                </label>
              </div>

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
                disabled={loginMutation.isPending}
                className="mt-1 w-full rounded-full bg-navy-500 px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(10,37,64,0.20)] transition-all duration-200 ease-[var(--ease-out)] hover:bg-navy-600 hover:shadow-[0_6px_20px_rgba(10,37,64,0.28)] active:scale-[0.98] disabled:opacity-50 dark:bg-accent-500 dark:hover:bg-accent-600"
              >
                {loginMutation.isPending ? 'Ingresando…' : 'Iniciar sesión'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-navy-500 dark:text-zinc-400">
              ¿No tenés cuenta?{' '}
              <Link
                to="/registro"
                className="font-semibold text-accent-500 transition-colors hover:text-accent-600 dark:text-accent-400"
              >
                Registrate
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
