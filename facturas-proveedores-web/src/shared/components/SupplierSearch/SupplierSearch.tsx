/**
 * SupplierSearch — autocomplete input for supplier linkage (RN-VINC).
 *
 * Premium redesign: clean dropdown with focus rings, hover states, and chip.
 * All ARIA and keyboard contracts preserved for test compatibility.
 * 
 * NEW: inline supplier creation when no matches exist. The user types a name,
   clicks "Crear como nuevo proveedor", and the backend creates it with
   defaults (categoria=OTRO, cuit=null, etc.).
 */
import { useState, useRef, useEffect, type KeyboardEvent } from 'react'
import { useBuscarProveedores } from '@features/proveedores/api/proveedoresHooks'
import { useCreateProveedor } from '@features/proveedores/api/proveedoresHooks'
import { Search, X, Check, Plus } from 'lucide-react'
import type { ProveedorListItem } from '@shared/api/api'

interface SupplierSearchProps {
  value: ProveedorListItem | null
  onChange: (proveedor: ProveedorListItem | null) => void
  placeholder?: string
  disabled?: boolean
}

export function SupplierSearch({
  value,
  onChange,
  placeholder = 'Buscar proveedor…',
  disabled = false,
}: SupplierSearchProps) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const { data: results, isLoading } = useBuscarProveedores(query)
  const createMutation = useCreateProveedor()
  const shouldShowDropdown = isOpen && query.length >= 2

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(-1)
  }, [results?.length])

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
    setIsOpen(v.length >= 2)
  }

  function handleSelect(proveedor: ProveedorListItem) {
    onChange(proveedor)
    setQuery('')
    setIsOpen(false)
    setActiveIndex(-1)
  }

  function handleClear() {
    onChange(null)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  function handleCreateNew() {
    const nombre = query.trim()
    if (!nombre) return
    
    createMutation.mutate(
      { nombre, categoria: 'OTRO' },
      {
        onSuccess: (created) => {
          // The API returns a full Proveedor which extends ProveedorListItem
          handleSelect(created as ProveedorListItem)
        },
      },
    )
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!shouldShowDropdown) return

    const hasResults = results && results.length > 0
    const canCreate = !hasResults && !isLoading && query.trim().length >= 2
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
          aria-controls={shouldShowDropdown ? 'supplier-search-listbox' : undefined}
          aria-activedescendant={
            activeIndex >= 0 ? `supplier-option-${activeIndex}` : undefined
          }
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (query.length >= 2) setIsOpen(true) }}
          placeholder={placeholder}
          disabled={disabled || createMutation.isPending}
          autoComplete="off"
          className="w-full rounded-xl border border-black/[0.06] bg-card py-2.5 pl-10 pr-3 text-sm text-navy-800 transition-all duration-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 dark:border-white/10 dark:bg-card-dark-secondary dark:text-zinc-100 dark:focus:ring-accent-500/20"
        />
      </div>

      {shouldShowDropdown && (
        <ul
          ref={listRef}
          id="supplier-search-listbox"
          role="listbox"
          className="absolute z-20 mt-1.5 w-full overflow-hidden rounded-xl border border-black/[0.06] bg-card shadow-[0_8px_24px_rgba(10,37,64,0.10)] dark:border-white/10 dark:bg-card-dark"
        >
          {isLoading && (
            <li role="option" aria-selected={false} className="px-3 py-2.5 text-sm text-navy-400 dark:text-zinc-500">
              Buscando…
            </li>
          )}

          {!isLoading && results && results.length === 0 && (
            <>
              <li role="option" aria-selected={false} className="px-3 py-2.5 text-sm text-navy-400 dark:text-zinc-500">
                Sin coincidencias
              </li>
              <li
                role="option"
                aria-selected={activeIndex === 0}
                id="supplier-option-0"
                onClick={handleCreateNew}
                className={`cursor-pointer border-t border-black/[0.04] px-3 py-2.5 text-sm transition-colors dark:border-white/10 ${
                  activeIndex === 0
                    ? 'bg-navy-50 text-navy-800 dark:bg-navy-800/30 dark:text-zinc-100'
                    : 'text-navy-700 hover:bg-cream-dark dark:text-zinc-300 dark:hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-accent-500" />
                  <span>Crear "{query.trim()}" como nuevo proveedor</span>
                </div>
              </li>
            </>
          )}

          {!isLoading &&
            results?.map((p, i) => (
              <li
                key={p.id}
                id={`supplier-option-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                onClick={() => handleSelect(p)}
                className={`cursor-pointer px-3 py-2.5 text-sm transition-colors ${
                  i === activeIndex
                    ? 'bg-navy-50 text-navy-800 dark:bg-navy-800/30 dark:text-zinc-100'
                    : 'text-navy-700 hover:bg-cream-dark dark:text-zinc-300 dark:hover:bg-white/[0.04]'
                }`}
              >
                {p.nombre}
              </li>
            ))}
        </ul>
      )}

      {createMutation.isPending && (
        <p className="mt-1.5 text-xs text-navy-400 dark:text-zinc-500">Creando proveedor…</p>
      )}
      {createMutation.isError && (
        <p className="mt-1.5 text-xs text-danger">Error al crear proveedor. Intentá de nuevo.</p>
      )}
    </div>
  )
}

export default SupplierSearch
