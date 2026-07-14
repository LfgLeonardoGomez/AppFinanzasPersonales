/**
 * LoadingState — consistent spinner / skeleton for async boundaries.
 */
export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex min-h-[12rem] flex-col items-center justify-center gap-3"
    >
      <div className="relative h-8 w-8">
        <div className="absolute inset-0 rounded-full border-2 border-navy-100 dark:border-zinc-700" />
        <div className="absolute inset-0 rounded-full border-2 border-t-accent-500 animate-spin" />
      </div>
      <span className="sr-only">{label}</span>
      <span className="text-xs font-medium uppercase tracking-[0.15em] text-navy-300 dark:text-zinc-600">
        {label}
      </span>
    </div>
  )
}

export default LoadingState
