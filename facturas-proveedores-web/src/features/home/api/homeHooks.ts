/**
 * TanStack Query hooks for the Home screen.
 */
import { useQuery } from '@tanstack/react-query'
import { getActividadReciente, getProveedoresFrecuentes } from './homeApi'

export const HOME_QUERY_KEYS = {
  frecuentes: (limit: number) => ['home', 'proveedores-frecuentes', limit] as const,
  actividad: (limit: number) => ['home', 'actividad-reciente', limit] as const,
}

export function useProveedoresFrecuentes(limit = 6) {
  return useQuery({
    queryKey: HOME_QUERY_KEYS.frecuentes(limit),
    queryFn: () => getProveedoresFrecuentes(limit),
  })
}

export function useActividadReciente(limit = 8) {
  return useQuery({
    queryKey: HOME_QUERY_KEYS.actividad(limit),
    queryFn: () => getActividadReciente(limit),
  })
}
