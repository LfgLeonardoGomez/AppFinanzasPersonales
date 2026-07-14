/**
 * FacturasPage — route entry for the invoice list (/facturas).
 *
 * Composes FacturasFilters + FacturasList.
 * Filter state is kept in URL search params (D-C09-4).
 *
 * Route: /facturas (private, behind RequireAuthWithBootstrap)
 */
import { useSearchParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { FacturasFilters } from './components/FacturasFilters'
import { FacturasList } from './components/FacturasList'
import { SuccessMessage } from '@shared/components/SuccessMessage/SuccessMessage'
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

  function handleFiltersChange(next: FacturasFiltersType) {
    setSearchParams(filtersToParams(next), { replace: true })
  }

  function handleEditFactura(factura: FacturaListItem) {
    // FE-001: SPA navigation via useNavigate (no full-page reload).
    void navigate(`/facturas/${factura.id}/editar`)
  }

  return (
    <div className="flex flex-col gap-4">
      {successMessage && (
        <SuccessMessage
          message={successMessage}
          onDismiss={() => navigate('/facturas', { replace: true, state: null })}
        />
      )}
      <div className="flex items-center justify-between gap-4 mb-4">
        <h1 className="text-xl font-semibold">Facturas</h1>
        <Link to="/facturas/nueva">Cargar factura</Link>
      </div>

      <FacturasFilters filters={filters} onChange={handleFiltersChange} />

      <FacturasList filters={filters} onEditFactura={handleEditFactura} />
    </div>
  )
}

export default FacturasPage
