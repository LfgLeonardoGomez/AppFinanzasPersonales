/**
 * InputField — labelled input with error state and optional icon.
 *
 * Replaces the raw <label>+<input> combos across forms for a
 * consistent premium feel.
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
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className="text-sm font-medium text-navy-700 dark:text-zinc-300"
      >
        {label}
      </label>
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300 dark:text-zinc-600">
            {icon}
          </div>
        )}
        <input
          id={inputId}
          className={`
            w-full rounded-xl border bg-card px-3 py-2.5 text-sm
            text-navy-800 placeholder:text-navy-300
            transition-all duration-200 ease-[var(--ease-out)]
            focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100
            dark:bg-card-dark-secondary dark:text-zinc-100 dark:placeholder:text-zinc-600
            dark:focus:border-accent-500 dark:focus:ring-accent-500/20
            ${error ? 'border-danger focus:border-danger focus:ring-danger/20' : 'border-black/[0.06] dark:border-white/10'}
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
        <span id={hintId} className="text-xs text-navy-400 dark:text-zinc-500">
          {hint}
        </span>
      )}
    </div>
  )
}

export default InputField
