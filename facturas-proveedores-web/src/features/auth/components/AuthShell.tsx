/**
 * AuthShell — shared visual shell for LoginPage/RegisterPage/RecuperarPage/
 * ResetPasswordPage (design handoff: `Auth.dc.html`, specs/design/BRAND.md +
 * LAYOUT.md).
 *
 * Desktop (lg+): split screen — violet→magenta brand panel with the product
 * pitch on the left, form on the right. Mobile: the brand panel is dropped
 * entirely (`hidden lg:flex`) so the form is the protagonist above the
 * fold — it survives only as a small, discreet phrase that flows after the
 * form (never fixed, so it can't sit above the keyboard). Both pages are
 * still separate ROUTES (/login, /registro) — this only unifies the chrome;
 * the mode pills navigate between routes instead of toggling local state,
 * since each page keeps its own hooks/tests.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type AuthMode = 'login' | 'register'

interface AuthShellProps {
  mode: AuthMode
  title: string
  subtitle: string
  footerText: string
  footerLinkTo: string
  footerLinkLabel: string
  children: ReactNode
}

function ModePill({ to, active, children }: { to: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={`
        flex-1 rounded-[9px] py-2 text-center text-xs font-semibold
        transition-colors duration-160 ease-[var(--ease-out)]
        ${active ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(24,21,31,0.06)]' : 'text-ink-soft hover:text-ink'}
      `}
    >
      {children}
    </Link>
  )
}

export function AuthShell({
  mode,
  title,
  subtitle,
  footerText,
  footerLinkTo,
  footerLinkLabel,
  children,
}: AuthShellProps) {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-page font-inter lg:flex-row">
      {/* ── Brand panel — desktop only ──────────────────────────────────────
          Decorative marketing surface, not essential information: the mode
          pills, title and form below carry everything the user needs, so
          this whole panel is aria-hidden and dropped on mobile instead of
          shrinking into a mobile banner. */}
      <div
        aria-hidden="true"
        className="relative hidden shrink-0 items-end p-12 lg:flex lg:flex-1"
        style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#9333ea 55%,#d6409f 100%)' }}
      >
        <div>
          <span className="mb-5 block h-10 w-10 rounded-full bg-white/20" />
          <p className="mb-2 max-w-xs text-2xl font-extrabold leading-snug tracking-tight text-white">
            Ventas, clientes y proveedores: tu negocio, en un solo lugar.
          </p>
          <p className="max-w-[300px] text-[13.5px] text-white/80">
            Cargá facturas sacando una foto — el resto lo hace la IA.
          </p>
        </div>
      </div>

      {/* ── Form panel ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-8 sm:px-10 lg:p-10">
        <div className="w-full max-w-sm animate-fade-in-up">
          <div className="mb-6 flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-[30px] w-[30px] shrink-0 rounded-full"
              style={{ background: 'linear-gradient(135deg,#7c3aed,#e0459b)' }}
            />
            <span className="text-base font-bold tracking-tight text-ink">Finanzas</span>
          </div>

          <div className="mb-6">
            <h1 className="mb-1 text-[22px] font-bold tracking-tight text-ink">{title}</h1>
            <p className="text-[13px] text-ink-soft">{subtitle}</p>
          </div>

          <div className="mb-6 flex rounded-xl bg-page p-[3px]">
            <ModePill to="/login" active={mode === 'login'}>
              Ingresar
            </ModePill>
            <ModePill to="/registro" active={mode === 'register'}>
              Crear cuenta
            </ModePill>
          </div>

          {children}

          <p className="mt-6 text-center text-[12.5px] text-ink-soft">
            {footerText}{' '}
            <Link to={footerLinkTo} className="font-semibold text-violet-500 hover:text-violet-600">
              {footerLinkLabel}
            </Link>
          </p>

          {/* Mobile-only echo of the brand panel's secondary line — flows
              after the form (never fixed), so an open keyboard can't push
              the form under it. Discreet on purpose: the form is the
              protagonist here, this is just a small trailing hint. */}
          <p className="mt-4 text-center text-[11.5px] text-ink-soft lg:hidden">
            Cargá facturas sacando una foto — el resto lo hace la IA.
          </p>
        </div>
      </div>
    </div>
  )
}

export default AuthShell
