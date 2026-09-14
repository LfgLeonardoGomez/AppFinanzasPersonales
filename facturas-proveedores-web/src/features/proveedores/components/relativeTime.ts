/**
 * Relative-time helper for the "Actividad reciente" panel (C-44).
 *
 * Migrated from the old `HomePage.tsx` local helper (design.md task 4.2) —
 * now a standalone module with its own tests, imported by `ActividadReciente`.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const diff = now - then
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`

  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`

  const d = Math.floor(h / 24)
  if (d < 30) return `hace ${d} d`

  const mo = Math.floor(d / 30)
  return `hace ${mo} mes${mo > 1 ? 'es' : ''}`
}
