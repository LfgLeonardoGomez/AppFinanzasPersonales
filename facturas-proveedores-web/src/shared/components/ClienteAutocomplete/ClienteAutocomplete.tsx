/**
 * ClienteAutocomplete — customer autocomplete for the conditional field on a
 * `CUENTA_CORRIENTE` sale (C-34).
 *
 * Mirrors `SupplierSearch` (chip for the selection, dropdown, `Plus`
 * affordance for inline creation, combobox/listbox a11y and keyboard
 * traversal) — one endpoint over (design.md, "Two things about the existing
 * codebase shape every decision below").
 *
 * Adds one branch `SupplierSearch` has no equivalent of: a `409` on creation
 * carries the existing customer (`detail.cliente_existente`), and the
 * component offers THAT customer instead of surfacing an error (design.md D8,
 * RN-CLI-03). Accepting the offer selects it with no second POST.
 *
 * `ClienteRef` (not the full `ClienteListItem`) is the public value/onChange
 * shape on purpose: the `409` conflict detail only carries `{ id, nombre }`
 * — not `nombre_normalizado`, `telefono`, `notas`, or the timestamps — and a
 * consumer only ever needs `id` (for `cliente_id`) and `nombre` (for the
 * chip). Fabricating the missing fields to satisfy a wider type would be
 * worse than not having them.
 */
import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { isAxiosError } from 'axios'
import {
  useBuscarClientes,
  useCreateCliente,
} from '@features/clientes/api/clientesHooks'
import { Search, X, Check, Plus } from 'lucide-react'
import type { ClienteConflictDetail } from '@shared/api/api'

export interface ClienteRef {
  id: string
  nombre: string
}

interface ClienteAutocompleteProps {
  value: ClienteRef | null
  onChange: (cliente: ClienteRef | null) => void
  placeholder?: string
  disabled?: boolean
}

const MIN_QUERY_LENGTH = 2

export function ClienteAutocomplete({
  value,
  onChange,
  placeholder = 'Buscar cliente…',
  disabled = false,
}: ClienteAutocompleteProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [conflict, setConflict] = useState<ClienteRef | null>(null)
  const [createError, setCreateError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  // Review fix (finding E): `createMutation.isPending` only updates on the
  // NEXT render. Two clicks/Enters fired back to back in the same tick (a
  // fast double-tap, before React flushes) both read the same stale
  // `isPending === false` from this closure — the ref is set synchronously,
  // so the second call sees it immediately, with no render in between.
  const isCreatingRef = useRef(false)

  const { data: results, isLoading } = useBuscarClientes(query)
  const createMutation = useCreateCliente()
  const shouldShowDropdown = isOpen && query.trim().length >= MIN_QUERY_LENGTH

  // Reset active index when results (or the conflict offer) change.
  useEffect(() => {
    setActiveIndex(-1)
  }, [results?.length, conflict])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        inputRef.current &&
        !inputRef.current.contains(e.target as Node) &&
        listRef.current &&
        !listRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    setActiveIndex(-1)
    setConflict(null)
    setCreateError(null)
    setIsOpen(v.trim().length >= MIN_QUERY_LENGTH)
  }

  function handleSelect(cliente: ClienteRef) {
    onChange(cliente)
    setQuery('')
    setIsOpen(false)
    setActiveIndex(-1)
    setConflict(null)
    setCreateError(null)
  }

  function handleClear() {
    onChange(null)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  function handleCreateNew() {
    // Review fix (finding E): the text input is disabled while pending
    // (`disabled={disabled || createMutation.isPending}` below), but this is
    // the single entry point for BOTH the "crear…" `<li>` onClick and the
    // Enter-key branch in `handleKeyDown` — neither checked `isPending`, so
    // a fast double-tap/double-Enter could fire two POSTs. It can't corrupt
    // data (the backend's unique index + 409 handling in `cliente_service.py`
    // already guards that) — this guard is about not sending the redundant
    // request, mirroring the `disabled={isPending}` discipline used
    // elsewhere in this change (`VentaForm.tsx`, `DeudaDesapareceDialog.tsx`).
    // A ref, not `createMutation.isPending`, because the latter only updates
    // on the next render — two calls in the same tick would both read it as
    // still `false`.
    if (isCreatingRef.current) return
    const nombre = query.trim()
    if (!nombre) return
    isCreatingRef.current = true
    setConflict(null)
    setCreateError(null)

    createMutation.mutate(
      { nombre },
      {
        onSuccess: (created) => {
          isCreatingRef.current = false
          handleSelect({ id: created.id, nombre: created.nombre })
        },
        onError: (error) => {
          isCreatingRef.current = false
          if (isAxiosError(error) && error.response?.status === 409) {
            const detail = error.response.data as { detail?: ClienteConflictDetail } | undefined
            const existente = detail?.detail?.cliente_existente
            if (existente) {
              setConflict({ id: existente.id, nombre: existente.nombre })
              return
            }
          }
          setCreateError('Error al crear cliente. Intentá de nuevo.')
        },
      },
    )
  }

  function handleAcceptConflict() {
    if (!conflict) return
    handleSelect(conflict)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!shouldShowDropdown) return

    if (conflict) {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAcceptConflict()
      } else if (e.key === 'Escape') {
        setIsOpen(false)
      }
      return
    }

    const hasResults = results && results.length > 0
    const canCreate = !hasResults && !isLoading && query.trim().length >= MIN_QUERY_LENGTH
    const totalItems = (results?.length ?? 0) + (canCreate ? 1 : 0)

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, totalItems - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (canCreate && activeIndex === (results?.length ?? 0)) {
          handleCreateNew()
        } else if (activeIndex >= 0 && results && results[activeIndex]) {
          handleSelect(results[activeIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        break
    }
  }

  if (value) {
    return (
      <div className="flex items-center gap-2">
        <div className="inline-flex items-center gap-2 rounded-full bg-accent-50 px-3 py-1.5 text-sm font-medium text-accent-700 ring-1 ring-accent-200 dark:bg-accent-500/10 dark:text-accent-300 dark:ring-accent-500/20">
          <Check className="h-3.5 w-3.5" />
          {value.nombre}
        </div>
        <button
          type="button"
          onClick={handleClear}
          aria-label="Limpiar selección"
          disabled={disabled}
          className="rounded-full p-1.5 text-navy-400 transition-colors hover:bg-danger-bg hover:text-danger dark:text-zinc-500 dark:hover:bg-danger/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="relative">
        <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy-300 dark:text-zinc-600">
          <Search className="h-4 w-4" />
        </div>
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={shouldShowDropdown}
          aria-autocomplete="list"
          aria-controls={shouldShowDropdown ? 'cliente-search-listbox' : undefined}
          aria-activedescendant={activeIndex >= 0 ? `cliente-option-${activeIndex}` : undefined}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (query.trim().length >= MIN_QUERY_LENGTH) setIsOpen(true)
          }}
          placeholder={placeholder}
          disabled={disabled || createMutation.isPending}
          autoComplete="off"
          className="w-full rounded-xl border border-black/[0.06] bg-card py-2.5 pl-10 pr-3 text-sm text-navy-800 transition-all duration-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 dark:border-white/10 dark:bg-card-dark-secondary dark:text-zinc-100 dark:focus:ring-accent-500/20"
        />
      </div>

      {shouldShowDropdown && (
        <ul
          ref={listRef}
          id="cliente-search-listbox"
          role="listbox"
          className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-black/[0.06] bg-card shadow-[0_8px_24px_rgba(10,37,64,0.10)] dark:border-white/10 dark:bg-card-dark"
        >
          {conflict && (
            <>
              <li
                role="option"
                aria-selected={false}
                className="px-3 py-2.5 text-sm text-navy-400 dark:text-zinc-500"
              >
                Ya existe un cliente con ese nombre
              </li>
              <li
                role="option"
                aria-selected={activeIndex === 0}
                id="cliente-option-0"
                onClick={handleAcceptConflict}
                className={`cursor-pointer border-t border-black/[0.04] px-3 py-2.5 text-sm transition-colors dark:border-white/10 ${
                  activeIndex === 0
                    ? 'bg-navy-50 text-navy-800 dark:bg-navy-800/30 dark:text-zinc-100'
                    : 'text-navy-700 hover:bg-cream-dark dark:text-zinc-300 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-accent-500" />
                  <span>{conflict.nombre}</span>
                </div>
              </li>
            </>
          )}

          {!conflict && isLoading && (
            <li role="option" aria-selected={false} className="px-3 py-2.5 text-sm text-navy-400 dark:text-zinc-500">
              Buscando…
            </li>
          )}

          {!conflict && !isLoading && results && results.length === 0 && (
            <>
              <li role="option" aria-selected={false} className="px-3 py-2.5 text-sm text-navy-400 dark:text-zinc-500">
                Sin coincidencias
              </li>
              <li
                role="option"
                aria-selected={activeIndex === 0}
                id="cliente-option-0"
                onClick={handleCreateNew}
                className={`cursor-pointer border-t border-black/[0.04] px-3 py-2.5 text-sm transition-colors dark:border-white/10 ${
                  activeIndex === 0
                    ? 'bg-navy-50 text-navy-800 dark:bg-navy-800/30 dark:text-zinc-100'
                    : 'text-navy-700 hover:bg-cream-dark dark:text-zinc-300 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-accent-500" />
                  <span>Crear "{query.trim()}" como nuevo cliente</span>
                </div>
              </li>
            </>
          )}

          {!conflict &&
            !isLoading &&
            results?.map((c, i) => (
              <li
                key={c.id}
                id={`cliente-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onClick={() => handleSelect(c)}
                className={`cursor-pointer px-3 py-2.5 text-sm transition-colors ${
                  i === activeIndex
                    ? 'bg-navy-50 text-navy-800 dark:bg-navy-800/30 dark:text-zinc-100'
                    : 'text-navy-700 hover:bg-cream-dark dark:text-zinc-300 dark:hover:bg-white/[0.04]'
                }`}
              >
                {c.nombre}
              </li>
            ))}
        </ul>
      )}

      {createMutation.isPending && (
        <p className="mt-1.5 text-xs text-navy-400 dark:text-zinc-500">Creando cliente…</p>
      )}
      {createError && <p className="mt-1.5 text-xs text-danger">{createError}</p>}
    </div>
  )
}

export default ClienteAutocomplete
