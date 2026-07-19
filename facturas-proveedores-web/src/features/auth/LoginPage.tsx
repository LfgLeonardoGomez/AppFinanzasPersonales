/**
 * Login page — /login
 *
 * Rebuilt to the new design system (specs/design + Auth.dc.html handoff):
 * split-screen AuthShell (brand gradient + form), pill toggle to /registro.
 * Keeps all original functional behaviour: labels, error messages, routing,
 * remember_me.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useLogin, getLoginErrorMessage } from './api/authHooks'
import { AuthShell } from './components/AuthShell'
import { InputField } from '@shared/components/InputField/InputField'
import { Button } from '@shared/components/Button/Button'
import { AlertCircle } from 'lucide-react'

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
    <AuthShell
      mode="login"
      title="Bienvenido de nuevo"
      subtitle="Ingresá para ver tus proveedores y facturas."
      footerText="¿No tenés cuenta?"
      footerLinkTo="/registro"
      footerLinkLabel="Creá una"
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <InputField
          label="Email"
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="vos@empresa.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <InputField
          label="Contraseña"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <label className="flex items-center gap-2 text-xs font-medium text-ink-soft">
          <input
            id="rememberMe"
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border-subtle text-violet-500 focus:ring-2 focus:ring-violet-100"
          />
          Recordarme
        </label>

        {displayError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger ring-1 ring-danger/10"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {displayError}
          </div>
        )}

        <Button type="submit" fullWidth loading={loginMutation.isPending}>
          Iniciar sesión
        </Button>
      </form>
    </AuthShell>
  )
}
