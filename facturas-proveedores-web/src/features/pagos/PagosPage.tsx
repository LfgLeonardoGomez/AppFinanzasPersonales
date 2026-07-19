/**
 * PagosPage — route entry for the payment list (/pagos).
 *
 * Composes PagosFilters + PagosList.
 * Filter state is kept in URL search params (D-C11-7).
 *
 * Route: /pagos (private, behind RequireAuthWithBootstrap)
 */
import { useEffect } from 'react'
import { useSearchParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { PagosFilters } from './components/PagosFilters'
import { PagosList } from './components/PagosList'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { toast } from '@shared/components/Toaster/toast'
import type {
  PagosFilters as PagosFiltersType,
  PagoListItem,
} from '@shared/api/api'

function parseFiltersFromParams(params: URLSearchParams): PagosFiltersType {
  const filters: PagosFiltersType = {}
  const proveedorId = params.get('proveedor_id')
  if (proveedorId) filters.proveedor_id = proveedorId
  const page = params.get('page')
  if (page) filters.page = parseInt(page, 10)
  return filters
}

function filtersToParams(filters: PagosFiltersType): Record<string, string> {
  const params: Record<string, string> = {}
  if (filters.proveedor_id) params.proveedor_id = filters.proveedor_id
  if (filters.page && filters.page > 1) params.page = String(filters.page)
  return params
}

export function PagosPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = parseFiltersFromParams(searchParams)
  const navigate = useNavigate()
  const location = useLocation()
  const successMessage = (location.state as { successMessage?: string } | null)?.successMessage

  useEffect(() => {
    if (successMessage) {
      toast.success(successMessage)
      navigate(location.pathname + location.search, { replace: true, state: null })
    }
  }, [successMessage, navigate, location.pathname, location.search])

  function handleFiltersChange(next: PagosFiltersType) {
    setSearchParams(filtersToParams(next), { replace: true })
  }

  function handleEditPago(pago: PagoListItem) {
    // FE-001: SPA navigation via useNavigate (no full-page reload).
    void navigate(`/pagos/${pago.id}/editar`)
  }

  return (
    <div className="flex flex-col gap-6 font-inter">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Listado" title="Pagos" />
        {/* TODO(C-14/C-15 IA carga unificada): once the unified IA modal owns
            payment creation, point this at that flow instead of /pagos/nuevo. */}
        <Link
          to="/pagos/nuevo"
          className="inline-flex items-center gap-1.5 rounded-pill bg-violet-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-600"
        >
          + Cargar pago
        </Link>
      </div>

      <PagosFilters filters={filters} onChange={handleFiltersChange} />

      <PagosList filters={filters} onEditPago={handleEditPago} />
    </div>
  )
}

export default PagosPage
