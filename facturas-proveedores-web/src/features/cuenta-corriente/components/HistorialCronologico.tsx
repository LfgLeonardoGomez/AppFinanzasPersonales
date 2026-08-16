/**
 * HistorialCronologico — thin supplier-ledger wrapper over the shared
 * `HistorialTable` (C-13, C-24; extracted in C-36, design.md D2).
 *
 * Same path, same export name, same props as before the extraction — its
 * call site in `CuentaCorrientePage` is unchanged and
 * `HistorialCronologico.test.tsx` is NOT edited. That unmodified suite
 * passing against this wrapper is the proof the extraction changed nothing
 * (design.md D2's stated proof obligation).
 *
 * Supplies the FACTURA/PAGO vocabulary the shared table renders generically.
 */
import type { EntradaHistorial } from '@shared/api/api'
import { HistorialTable, type HistorialTipoConfig } from '@shared/components/HistorialTable/HistorialTable'

interface HistorialCronologicoProps {
  historial: EntradaHistorial[]
}

const TIPO_CONFIG: Record<string, HistorialTipoConfig> = {
  FACTURA: { label: 'Debe', lado: 'debe', archivoTitulo: 'Archivo de factura' },
  PAGO: { label: 'Haber', lado: 'haber', archivoTitulo: 'Comprobante de pago' },
}

export function HistorialCronologico({ historial }: HistorialCronologicoProps) {
  return <HistorialTable historial={historial} tipoConfig={TIPO_CONFIG} />
}

export default HistorialCronologico
