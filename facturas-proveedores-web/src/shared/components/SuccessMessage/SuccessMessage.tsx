/**
 * SuccessMessage — transient confirmation banner for form submissions.
 *
 * @deprecated Use `toast.success(message)` from
 * `@shared/components/Toaster/toast` instead. This component is kept
 * for backward compatibility during the C-20 migration window and will
 * be removed in a subsequent change once all call sites have been
 * migrated. New code MUST use the toast API.
 *
 * Auto-dismisses after 4 seconds so it does not clutter the UI.
 */
import { useEffect } from 'react'
import { CheckCircle } from 'lucide-react'

interface SuccessMessageProps {
  message: string
  onDismiss?: () => void
}

export function SuccessMessage({ message, onDismiss }: SuccessMessageProps) {
  useEffect(() => {
    const t = setTimeout(() => {
      onDismiss?.()
    }, 4000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700 ring-1 ring-green-200 animate-fade-in-up dark:bg-green-500/10 dark:text-green-300 dark:ring-green-500/20"
    >
      <CheckCircle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  )
}

export default SuccessMessage
