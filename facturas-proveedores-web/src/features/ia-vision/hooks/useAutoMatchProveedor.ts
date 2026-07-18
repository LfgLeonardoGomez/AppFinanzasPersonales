/**
 * useAutoMatchProveedor — frontend supplier auto-match for the IA
 * confirm flow (C-21, D4).
 *
 * Reuses the existing `useBuscarProveedores` search (RN-VINC) and
 * applies a normalized-exact UNIQUE match rule: lowercase, strip
 * accents, trim (mirrors RN-VINC's normalization). Partial ("contains")
 * matches, multiple exact matches, and zero matches all resolve to
 * `no-match` — auto-selecting on anything less than a unique exact
 * match risks silently picking the wrong supplier (Risk in design.md).
 *
 * The match is a FRONTEND responsibility (RN-IA-06): the IA never
 * assigns a supplier server-side. This hook only computes a
 * *suggestion* — the caller (the field components) still requires an
 * explicit user confirm before the resource is created.
 */
import { useBuscarProveedores } from '@features/proveedores/api/proveedoresHooks'
import type { ProveedorListItem } from '@shared/api/api'

export type AutoMatchResult =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'matched'; proveedor: ProveedorListItem }
  | { status: 'no-match' }

/**
 * Normalize a supplier name for comparison: lowercase, strip diacritics
 * (accents), trim surrounding whitespace. Mirrors RN-VINC's
 * normalization so "Ferretería Nueva" matches "ferreteria nueva".
 */
export function normalizeNombre(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

const MIN_SEARCH_LENGTH = 2

export function useAutoMatchProveedor(proveedorNombre: string | null): AutoMatchResult {
  const nombre = proveedorNombre ?? ''
  const searchEnabled = nombre.trim().length >= MIN_SEARCH_LENGTH
  const { data, isLoading, isFetched } = useBuscarProveedores(searchEnabled ? nombre : '')

  if (!proveedorNombre) {
    return { status: 'idle' }
  }

  if (!searchEnabled) {
    return { status: 'no-match' }
  }

  if (isLoading || !isFetched) {
    return { status: 'loading' }
  }

  const target = normalizeNombre(proveedorNombre)
  const matches = (data ?? []).filter((p) => normalizeNombre(p.nombre) === target)

  if (matches.length === 1) {
    return { status: 'matched', proveedor: matches[0] as ProveedorListItem }
  }

  return { status: 'no-match' }
}
