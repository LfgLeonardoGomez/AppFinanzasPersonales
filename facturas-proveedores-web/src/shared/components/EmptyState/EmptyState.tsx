/**
 * EmptyState — premium empty-state with iconography and CTA slot.
 */
import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'
import { Card } from '../Card/Card'

interface EmptyStateProps {
  title?: string
  description?: string
  icon?: ReactNode
  children?: ReactNode
}

export function EmptyState({
  title = 'Sin datos',
  description = 'Todavía no hay registros para mostrar en esta sección.',
  icon,
  children,
}: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center justify-center py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-navy-50 text-navy-400 ring-1 ring-black/[0.04] dark:bg-navy-800/40 dark:text-zinc-500 dark:ring-white/10">
        {icon ?? <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="font-serif text-lg font-semibold text-navy-800 dark:text-zinc-100">
        {title}
      </h3>
      <p className="mt-1 max-w-xs text-sm leading-relaxed text-navy-400 dark:text-zinc-500">
        {description}
      </p>
      {children && <div className="mt-5">{children}</div>}
    </Card>
  )
}

export default EmptyState
