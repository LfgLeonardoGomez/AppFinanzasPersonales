/**
 * Button — the shared action primitive for the new design system.
 *
 * Previously there was no shared Button: buttons were inline everywhere,
 * each with slightly different padding/radius/hover behavior. This is the
 * single definition every screen migrates to.
 *
 * Variants (BRAND.md/DESIGN_SYSTEM.md — "jerarquía obvia: primario,
 * secundario, terciario/sutil"):
 *  - primary:   violet pill, the one protagonist action per view.
 *  - secondary: bordered support action.
 *  - ghost:     text-only / minor action (e.g. "Cargar manual").
 *  - danger:    destructive action (e.g. "Eliminar proveedor").
 *
 * States: hover, active (press scale), focus-visible ring, disabled,
 * and `loading` (disables the button, sets aria-busy, shows a spinner
 * without hiding the label).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  fullWidth?: boolean
  /** Optional leading icon (decorative — communicates, never decorates alone). */
  icon?: ReactNode
  children: ReactNode
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: `
    bg-violet-500 text-white
    hover:bg-violet-600
    active:scale-[0.97]
    disabled:hover:bg-violet-500
  `,
  secondary: `
    bg-surface text-ink
    ring-1 ring-border-subtle
    hover:bg-surface-alt
    active:scale-[0.97]
  `,
  ghost: `
    bg-transparent text-violet-900
    hover:bg-violet-50
    active:scale-[0.97]
  `,
  danger: `
    bg-transparent text-danger
    ring-1 ring-danger/30
    hover:bg-danger-bg
    active:scale-[0.97]
  `,
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'gap-1.5 px-4 py-2 text-xs',
  md: 'gap-2 px-6 py-2.5 text-sm',
  lg: 'gap-2.5 px-8 py-3.5 text-base',
}

function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  icon,
  disabled = false,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading

  return (
    <button
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={`
        inline-flex items-center justify-center
        rounded-pill font-inter font-semibold
        transition-all duration-160 ease-[var(--ease-out)]
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2
        disabled:cursor-not-allowed disabled:opacity-50
        ${fullWidth ? 'w-full' : ''}
        ${SIZE_CLASSES[size]}
        ${VARIANT_CLASSES[variant]}
      `}
      {...props}
    >
      {loading && <Spinner />}
      {!loading && icon}
      {children}
    </button>
  )
}

export default Button
