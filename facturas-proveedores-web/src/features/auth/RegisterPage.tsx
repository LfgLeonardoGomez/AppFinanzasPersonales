/**
 * Registration page — /registro
 *
 * Rebuilt to the new design system, consistent with LoginPage (shared
 * AuthShell). Keeps all original functional behaviour: client-side
 * validation, server error mapping, redirect on success.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useRegister } from './api/authHooks'
import { AuthShell } from './components/AuthShell'
import { InputField } from '@shared/components/InputField/InputField'
import { Button } from '@shared/components/Button/Button'
import { AlertCircle } from 'lucide-react'

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
    <AuthShell
      mode="register"
      title="Creá tu cuenta"
      subtitle="Empezá a cargar facturas en minutos."
      footerText="¿Ya tenés cuenta?"
      footerLinkTo="/login"
      footerLinkLabel="Ingresá"
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <InputField
          label="Nombre"
          id="nombre"
          name="nombre"
          type="text"
          autoComplete="name"
          placeholder="Leonardo Gómez"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />

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
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="Mín. ocho caracteres"
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

        <Button type="submit" fullWidth loading={registerMutation.isPending}>
          Registrar
        </Button>
      </form>
    </AuthShell>
  )
}
