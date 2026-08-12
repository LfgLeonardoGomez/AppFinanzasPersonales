/**
 * New password — /reset?token=... (C-31)
 *
 * The token arrives in the query string, which is also why it stays in the
 * browser history after it stops working. That is accepted: single use, one
 * hour, and no session handed out on success.
 *
 * Deliberately does NOT log the user in afterwards (D7). Auto-logging-in would
 * turn the emailed link into a session anyone intercepting the mail could ride,
 * and it would contradict the reset having just revoked every open session.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import { getResetErrorMessage, useResetPassword } from './api/authHooks'
import { AuthShell } from './components/AuthShell'
import { InputField } from '@shared/components/InputField/InputField'
import { Button } from '@shared/components/Button/Button'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''

  const resetPassword = useResetPassword()
  const [password, setPassword] = useState('')
  const [repetida, setRepetida] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setClientError(null)

    if (password.length < 8) {
      setClientError('La contraseña debe tener mínimo 8 caracteres')
      return
    }
    if (password !== repetida) {
      setClientError('Las dos contraseñas no coinciden')
      return
    }

    resetPassword.mutate(
      { token, password },
      { onSuccess: () => { void navigate('/login') } },
    )
  }

  if (!token) {
    return (
      <AuthShell
        mode="login"
        title="Enlace incompleto"
        subtitle="Este enlace no trae el código de recuperación."
        footerText="¿Necesitás otro?"
        footerLinkTo="/recuperar"
        footerLinkLabel="Pedir un enlace nuevo"
      >
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger ring-1 ring-danger/10"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Abrí el enlace completo desde el correo, o pedí uno nuevo.
        </div>
      </AuthShell>
    )
  }

  const displayError =
    clientError ?? (resetPassword.isError ? getResetErrorMessage(resetPassword.error) : null)

  return (
    <AuthShell
      mode="login"
      title="Elegí una contraseña nueva"
      subtitle="Al guardarla se cierran todas las sesiones abiertas de tu cuenta."
      footerText="¿Ya la cambiaste?"
      footerLinkTo="/login"
      footerLinkLabel="Ingresar"
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <InputField
          label="Contraseña nueva"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Mín. ocho caracteres"
          required
        />

        <InputField
          label="Repetila"
          id="password_repetida"
          name="password_repetida"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={repetida}
          onChange={(e) => setRepetida(e.target.value)}
          required
        />

        {displayError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger ring-1 ring-danger/10"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {displayError}
          </div>
        )}

        <Button type="submit" fullWidth loading={resetPassword.isPending}>
          Guardar y volver al ingreso
        </Button>
      </form>
    </AuthShell>
  )
}
