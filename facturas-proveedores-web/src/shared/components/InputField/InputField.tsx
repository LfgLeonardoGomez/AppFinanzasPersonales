/**
 * InputField — labelled input with error state and optional icon.
 *
 * Replaces the raw <label>+<input> combos across forms for a
 * consistent premium feel. Restyled to the new violet/beige/Inter tokens;
 * props, ids and aria wiring are unchanged (existing test contracts —
 * e.g. getByLabelText — keep working).
 */
import type { ReactNode, InputHTMLAttributes } from 'react'

interface InputFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> {
  label: string
  error?: string | undefined
  hint?: string | undefined
  icon?: ReactNode
}

export function InputField({
  label,
  error,
  hint,
  icon,
  id,
  ...props
}: InputFieldProps) {
  const inputId = id ?? props.name
  const errorId = error ? `${inputId}-error` : undefined
  const hintId = hint ? `${inputId}-hint` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className="flex flex-col gap-1.5 font-inter">
      <label htmlFor={inputId} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-soft">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          className={`
            w-full rounded-card-sm border bg-surface px-3 py-2.5 text-sm
            text-ink placeholder:text-ink-soft
            transition-all duration-200 ease-[var(--ease-out)]
            focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100
            dark:bg-card-dark-secondary dark:text-zinc-100 dark:placeholder:text-zinc-600
            dark:focus:border-violet-500 dark:focus:ring-violet-500/20
            ${error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-border-subtle dark:border-white/10'}
            ${icon ? 'pl-10' : ''}
          `}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...props}
        />
      </div>
      {error && (
        <span id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </span>
      )}
      {hint && !error && (
        <span id={hintId} className="text-xs text-ink-soft">
          {hint}
        </span>
      )}
    </div>
  )
}

export default InputField
