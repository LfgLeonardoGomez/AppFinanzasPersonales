/**
 * VentasPage — route entry for the sales list (/ventas), C-34.
 *
 * Composes VentasFilters + VentasList. Filter state is kept in URL search
 * params (mirrors PagosPage/FacturasPage).
 *
 * design.md D9: the default view is TODAY. When `desde`/`hasta` are absent
 * from the URL, they default to `getTodayInArgentina()` — the page opens on
 * the number the user came to see, never an unfiltered "all time" list.
 * "Limpiar filtros" (VentasFilters) resets to `{}`, which lands back on this
 * same default through `parseFiltersFromParams` — clearing returns to today,
 * not to every sale ever recorded.
 */
import { useEffect } from 'react'
import { useSearchParams, Link, useNavigate, useLocation } from 'react-router-dom'
import { VentasFilters } from './components/VentasFilters'
import { VentasList } from './components/VentasList'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { toast } from '@shared/components/Toaster/toast'
import { getTodayInArgentina } from '@shared/utils/date'
import type { VentasFilters as VentasFiltersType, VentaListItem, FormaPago } from '@shared/api/api'

function parseFiltersFromParams(params: URLSearchParams): VentasFiltersType {
  const filters: VentasFiltersType = {}
  filters.desde = params.get('desde') ?? getTodayInArgentina()
  filters.hasta = params.get('hasta') ?? getTodayInArgentina()
  const formaPago = params.get('forma_pago') as FormaPago | null
  if (formaPago) filters.forma_pago = formaPago
  const clienteId = params.get('cliente_id')
  if (clienteId) filters.cliente_id = clienteId
  return filters
}

function filtersToParams(filters: VentasFiltersType): Record<string, string> {
  const params: Record<string, string> = {}
  if (filters.desde) params.desde = filters.desde
  if (filters.hasta) params.hasta = filters.hasta
  if (filters.forma_pago) params.forma_pago = filters.forma_pago
  if (filters.cliente_id) params.cliente_id = filters.cliente_id
  return params
}

export function VentasPage() {
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

  function handleFiltersChange(next: VentasFiltersType) {
    setSearchParams(filtersToParams(next), { replace: true })
  }

  function handleEditVenta(venta: VentaListItem) {
    void navigate(`/ventas/${venta.id}/editar`)
  }

  return (
    <div className="flex flex-col gap-6 font-inter">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Listado" title="Ventas" />
        <Link
          to="/ventas/nueva"
          className="inline-flex items-center gap-1.5 rounded-pill bg-violet-500 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-violet-600"
        >
          + Cargar venta
        </Link>
      </div>

      <VentasFilters filters={filters} onChange={handleFiltersChange} />

      <VentasList filters={filters} onEditVenta={handleEditVenta} />
    </div>
  )
}

export default VentasPage
