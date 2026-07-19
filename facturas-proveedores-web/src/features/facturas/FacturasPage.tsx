/**
 * FacturasPage — route entry for the invoice list (/facturas).
 *
 * Composes FacturasFilters + FacturasList.
 * Filter state is kept in URL search params (D-C09-4).
 *
 * Route: /facturas (private, behind RequireAuthWithBootstrap)
 */
import { useEffect } from 'react'
import { useSearchParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { FacturasFilters } from './components/FacturasFilters'
import { FacturasList } from './components/FacturasList'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { toast } from '@shared/components/Toaster/toast'
import type { FacturasFilters as FacturasFiltersType, FacturaListItem, EstadoFactura } from '@shared/api/api'

function parseFiltersFromParams(params: URLSearchParams): FacturasFiltersType {
  const filters: FacturasFiltersType = {}
  const proveedorId = params.get('proveedor_id')
  if (proveedorId) filters.proveedor_id = proveedorId
  const estado = params.get('estado') as EstadoFactura | null
  if (estado) filters.estado = estado
  const fechaDesde = params.get('fecha_desde')
  if (fechaDesde) filters.fecha_desde = fechaDesde
  const fechaHasta = params.get('fecha_hasta')
  if (fechaHasta) filters.fecha_hasta = fechaHasta
  const page = params.get('page')
  if (page) filters.page = parseInt(page, 10)
  return filters
}

function filtersToParams(filters: FacturasFiltersType): Record<string, string> {
  const params: Record<string, string> = {}
  if (filters.proveedor_id) params.proveedor_id = filters.proveedor_id
  if (filters.estado) params.estado = filters.estado
  if (filters.fecha_desde) params.fecha_desde = filters.fecha_desde
  if (filters.fecha_hasta) params.fecha_hasta = filters.fecha_hasta
  if (filters.page && filters.page > 1) params.page = String(filters.page)
  return params
}

export function FacturasPage() {
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

  function handleFiltersChange(next: FacturasFiltersType) {
    setSearchParams(filtersToParams(next), { replace: true })
  }

  function handleEditFactura(factura: FacturaListItem) {
    // FE-001: SPA navigation via useNavigate (no full-page reload).
    void navigate(`/facturas/${factura.id}/editar`)
  }

  return (
    <div className="flex flex-col gap-6 font-inter">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Listado" title="Facturas" />
        {/* TODO(C-14/C-15 IA carga unificada): once the unified IA modal owns
            invoice creation, point this at that flow instead of /facturas/nueva. */}
        <Link
          to="/facturas/nueva"
          className="inline-flex items-center gap-1.5 rounded-pill bg-violet-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-600"
        >
          + Cargar factura
        </Link>
      </div>

      <FacturasFilters filters={filters} onChange={handleFiltersChange} />

      <FacturasList filters={filters} onEditFactura={handleEditFactura} />
    </div>
  )
}

export default FacturasPage
