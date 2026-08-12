/**
 * Recovery request — /recuperar (C-31)
 *
 * The one rule this screen has to respect: it shows the SAME confirmation
 * whether or not the email has an account. The backend deliberately refuses to
 * say (D2), and a UI that said "no encontramos esa cuenta" would hand back the
 * exact information the endpoint was built to withhold.
 *
 * That costs the honest user something — someone who mistypes their address
 * waits for a mail that will never come. The copy compensates by telling them
 * to check, instead of implying the mail is definitely on its way.
 */
import { useState, type FormEvent } from 'react'
import { MailCheck, AlertCircle } from 'lucide-react'
import { useRecuperar } from './api/authHooks'
import { AuthShell } from './components/AuthShell'
import { InputField } from '@shared/components/InputField/InputField'
import { Button } from '@shared/components/Button/Button'

export default function RecuperarPage() {
  const recuperar = useRecuperar()
  const [email, setEmail] = useState('')
  const [clientError, setClientError] = useState<string | null>(null)

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setClientError(null)

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setClientError('Ingresá un email válido')
      return
    }
    recuperar.mutate({ email })
  }

  // Success and "that email has no account" are the same state on purpose:
  // the client cannot tell them apart, and must not appear to.
  if (recuperar.isSuccess) {
    return (
      <AuthShell
        mode="login"
        title="Revisá tu correo"
        subtitle="Si ese email tiene una cuenta, te llegó un enlace para elegir una contraseña nueva."
        footerText="¿Te acordaste?"
        footerLinkTo="/login"
        footerLinkLabel="Volver al ingreso"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink-muted">
            <MailCheck className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              El enlace sirve <strong>una sola vez</strong> y vence en una hora.
              Si no te llega, fijate en spam o probá de nuevo: puede que hayas
              tipeado otra dirección.
            </span>
          </div>
        </div>
      </AuthShell>
    )
  }

  const displayError =
    clientError ??
    (recuperar.isError ? 'No se pudo procesar el pedido. Intentá de nuevo.' : null)

  return (
    <AuthShell
      mode="login"
      title="Olvidé mi contraseña"
      subtitle="Te mandamos un enlace para elegir una nueva."
      footerText="¿Te acordaste?"
      footerLinkTo="/login"
      footerLinkLabel="Volver al ingreso"
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

        {displayError && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger-bg px-4 py-3 text-sm text-danger ring-1 ring-danger/10"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            {displayError}
          </div>
        )}

        <Button type="submit" fullWidth loading={recuperar.isPending}>
          Enviarme el enlace
        </Button>
      </form>
    </AuthShell>
  )
}
