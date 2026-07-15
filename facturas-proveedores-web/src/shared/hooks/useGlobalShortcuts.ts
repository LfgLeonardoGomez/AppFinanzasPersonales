/**
 * useGlobalShortcuts (C-20, frontend-ui-polish).
 *
 * Global keyboard shortcut hook. Mounted in AuthenticatedLayout.
 * - Single-key shortcuts (e.g. 'n') fire on keydown when no form field has focus
 *   and no modifier is held.
 * - Sequence shortcuts (e.g. ['g', 'p']) fire when the keys are pressed within
 *   a 1000ms window. The first key (the 'prefix') sets a timestamp; the second
 *   key completes the sequence.
 * - The hook is form-field aware: it does not intercept keys when the focus is
 *   inside an <input>, <textarea>, <select>, or [contenteditable] element.
 * - The hook is modifier-aware: it ignores keydown events that carry Ctrl, Meta,
 *   or Alt (so browser shortcuts like Ctrl+L for the address bar are not
 *   intercepted).
 * - Case-insensitive: capital N triggers the same binding as lowercase n.
 *
 * The hook knows nothing about react-router or navigation. Callers pass the
 * action callback; in AuthenticatedLayout those callbacks wrap useNavigate().
 */
import { useEffect } from 'react'

const SEQUENCE_WINDOW_MS = 1000

export interface ShortcutBinding {
  keys: string[]
  description?: string
  action: () => void
  when?: () => boolean
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  const ce = target.getAttribute('contenteditable')
  if (ce && ce.toLowerCase() === 'true') return true
  return false
}

export function useGlobalShortcuts(bindings: ShortcutBinding[]): void {
  useEffect(() => {
    let prefix: { key: string; timestamp: number } | null = null

    function handleKeydown(event: KeyboardEvent): void {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (isTypingTarget(event.target)) return

      const key = event.key.toLowerCase()
      const now = Date.now()

      if (prefix && now - prefix.timestamp > SEQUENCE_WINDOW_MS) {
        prefix = null
      }

      if (prefix) {
        const seqBinding = bindings.find(
          (b) => b.keys.length === 2 && b.keys[0] === prefix!.key && b.keys[1] === key,
        )
        prefix = null
        if (seqBinding) {
          if (!seqBinding.when || seqBinding.when()) {
            event.preventDefault()
            seqBinding.action()
          }
        }
        return
      }

      const hasSequenceWithPrefix = bindings.some(
        (b) => b.keys.length === 2 && b.keys[0] === key,
      )
      if (hasSequenceWithPrefix) {
        prefix = { key, timestamp: now }
        return
      }

      const singleBinding = bindings.find((b) => b.keys.length === 1 && b.keys[0] === key)
      if (!singleBinding) return

      if (!singleBinding.when || singleBinding.when()) {
        event.preventDefault()
        singleBinding.action()
      }
    }

    window.addEventListener('keydown', handleKeydown)
    return () => {
      window.removeEventListener('keydown', handleKeydown)
    }
  }, [bindings])
}
