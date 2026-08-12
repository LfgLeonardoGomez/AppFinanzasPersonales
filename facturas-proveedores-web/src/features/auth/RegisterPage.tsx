/**
 * Registration page — /registro
 *
 * Two paths, one route (C-30, D2): create a new negocio, or join an existing
 * one with an invitation code.
 *
 * The selector is visible before the form because the failure mode here is
 * silent. An employee who takes the wrong path gets no error — they end up
 * with their own empty business, convinced they joined their boss's. Two
 * separate URLs would be worse: nobody hands them the right link, they only
 * have a code.
 */
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { getCodigoErrorMessage, useRegister, useRegisterEmpleado } from './api/authHooks'
import { AuthShell } from './components/AuthShell'
import { InputField } from '@shared/components/InputField/InputField'
import { Button } from '@shared/components/Button/Button'
import { AlertCircle } from 'lucide-react'

type Camino = 'negocio' | 'invitacion'

function validateForm(
  email: string,
  nombre: string,
  password: string,
  camino: Camino,
  codigo: string,
): string | null {
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return 'Ingresá un email válido'
  }
  if (!nombre.trim()) {
    return 'El nombre es requerido'
  }
  if (password.length < 8) {
    return 'La contraseña debe tener mínimo 8 caracteres'
  }
  if (camino === 'invitacion' && !codigo.trim()) {
    return 'Ingresá el código que te dio tu administrador'
  }
  return null
}

function getServerErrorMessage(error: unknown): string {
  if (!isAxiosError(error)) return 'Error al registrar. Intentá de nuevo.'
  const status = error.response?.status
  const detail = error.response?.data?.detail as string | undefined
  if (status === 409 || (status === 400 && typeof detail === 'string' && detail.includes('email'))) {
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
  const registerEmpleadoMutation = useRegisterEmpleado()

  const [camino, setCamino] = useState<Camino>('negocio')
  const [email, setEmail] = useState('')
  const [nombre, setNombre] = useState('')
  const [password, setPassword] = useState('')
  const [nombreNegocio, setNombreNegocio] = useState('')
  const [codigo, setCodigo] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)

  const esInvitacion = camino === 'invitacion'
  const mutacion = esInvitacion ? registerEmpleadoMutation : registerMutation

  function elegirCamino(siguiente: Camino) {
    setCamino(siguiente)
    setClientError(null)
    registerMutation.reset()
    registerEmpleadoMutation.reset()
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setClientError(null)

    const validationError = validateForm(email, nombre, password, camino, codigo)
    if (validationError) {
      setClientError(validationError)
      return
    }

    const alLograrlo = { onSuccess: () => { void navigate('/login') } }

    if (esInvitacion) {
      registerEmpleadoMutation.mutate(
        { email, nombre, password, codigo: codigo.trim().toUpperCase() },
        alLograrlo,
      )
      return
    }

    registerMutation.mutate(
      {
        email,
        nombre,
        password,
        ...(nombreNegocio.trim() ? { nombre_negocio: nombreNegocio.trim() } : {}),
      },
      alLograrlo,
    )
  }

  // A rejected code says the same thing whatever the reason (D-41): unknown,
  // expired and already-used are indistinguishable on purpose, so the copy
  // points at the fix instead of guessing at the cause.
  const serverError = mutacion.isError
    ? esInvitacion && (mutacion.error as { response?: { status?: number } })?.response?.status === 400
      ? getCodigoErrorMessage(mutacion.error)
      : getServerErrorMessage(mutacion.error)
    : null
  const displayError = clientError ?? serverError

  return (
    <AuthShell
      mode="register"
      title={esInvitacion ? 'Sumate a un negocio' : 'Creá tu cuenta'}
      subtitle={
        esInvitacion
          ? 'Usá el código que te dio el administrador de tu local.'
          : 'Empezá a cargar facturas en minutos.'
      }
      footerText="¿Ya tenés cuenta?"
      footerLinkTo="/login"
      footerLinkLabel="Ingresá"
    >
      <div
        role="radiogroup"
        aria-label="Tipo de registro"
        className="mb-5 grid grid-cols-2 gap-2 rounded-xl bg-surface-muted p-1"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!esInvitacion}
          onClick={() => elegirCamino('negocio')}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
            !esInvitacion ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'
          }`}
        >
          Crear mi negocio
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={esInvitacion}
          onClick={() => elegirCamino('invitacion')}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
            esInvitacion ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted'
          }`}
        >
          Sumarme a uno
        </button>
      </div>

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

        {esInvitacion ? (
          <InputField
            label="Código de invitación"
            id="codigo"
            name="codigo"
            type="text"
            autoComplete="off"
            placeholder="A3F7K2QB"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            hint="Te lo da el administrador de tu negocio. Vence a las 48 horas."
            required
          />
        ) : (
          <InputField
            label="Nombre del negocio"
            id="nombre_negocio"
            name="nombre_negocio"
            type="text"
            autoComplete="organization"
            placeholder="Kiosco Don Pepe"
            value={nombreNegocio}
            onChange={(e) => setNombreNegocio(e.target.value)}
            hint="Opcional. Si lo dejás vacío usamos tu nombre."
          />
        )}

        {displayError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger ring-1 ring-danger/10"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {displayError}
          </div>
        )}

        <Button type="submit" fullWidth loading={mutacion.isPending}>
          {esInvitacion ? 'Sumarme al negocio' : 'Crear mi negocio'}
        </Button>
      </form>
    </AuthShell>
  )
}
