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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-xl font-semibold">Pagos</h1>
        <Link to="/pagos/nuevo">Cargar pago</Link>
      </div>

      <PagosFilters filters={filters} onChange={handleFiltersChange} />

      <PagosList filters={filters} onEditPago={handleEditPago} />
    </div>
  )
}

export default PagosPage
