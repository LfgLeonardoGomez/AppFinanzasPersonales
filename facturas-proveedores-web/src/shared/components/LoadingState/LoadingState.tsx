/**
 * LoadingState — consistent shimmer skeleton for async boundaries (C-20).
 *
 * Three stacked placeholder blocks with the `animate-shimmer` keyframe
 * (defined in src/app/index.css) replace the previous spinner. The container
 * exposes role=status with aria-busy=true and an aria-label for screen
 * readers; sighted users see only the skeleton shimmer.
 */
export function LoadingState({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="flex min-h-[12rem] w-full max-w-md flex-col gap-3"
    >
      <div className="h-4 w-3/4 animate-shimmer rounded-md bg-navy-100 dark:bg-zinc-800" />
      <div className="h-4 w-2/3 animate-shimmer rounded-md bg-navy-100 dark:bg-zinc-800" />
      <div className="h-4 w-1/2 animate-shimmer rounded-md bg-navy-100 dark:bg-zinc-800" />
    </div>
  )
}

export default LoadingState
