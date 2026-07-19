/**
 * buildCreatePayload — pure payload builder for the terminal confirm of
 * the unified carga modal (C-21, D1/D2; extended for the manual origin
 * by the carga-modal convergence work).
 *
 * Builds the `FacturaCreate` / `PagoCreate` body from the edited
 * proposal, the user-selected supplier id, the Cloudinary `secure_url`
 * obtained on confirm (empty string when the origin is manual — no
 * image was ever uploaded), and the `origen` to stamp. Pure function —
 * no API calls, no React — so factura and pago share the exact same
 * construction shape (D2: avoids copy-paste divergence between the two
 * create paths).
 *
 * PRECONDITION: the caller (the modal, gated by `canConfirm` — a
 * supplier must be selected) is expected to only call this once the
 * proposal is in a confirmable state. Required fields (`fecha_emision`
 * + `monto_total` for factura; `monto` + `fecha` + `metodo` for pago)
 * are asserted non-null here; if the extractor left one of them empty,
 * or the user left a manual field empty, the backend's Pydantic
 * validation is the authoritative safety net — it rejects the request
 * with 422 and the modal surfaces that error without closing (RN-IA-04
 * unaffected; the extraction endpoint itself never persists).
 *
 * Optional fields (`numero` for factura) are omitted entirely when
 * `null` rather than sent as `null` — "only non-null fields are sent".
 *
 * `origen` is stamped from the modal's origin: `'IA'` when the data
 * came from the vision flow (D-18 / c-15a Path B), `'MANUAL'` when the
 * user typed it in by hand — no image is ever involved in the manual
 * path, so `url` is expected to be `''` and no url field is sent. The
 * pago payload structurally has NO `factura_id` key (RN-PAG-01).
 */
import type {
  FacturaCreate,
  MetodoPago,
  OrigenDocumento,
  PagoCreate,
  PropuestaFactura,
  PropuestaPago,
} from '@shared/api/api'

export function buildCreatePayload(
  tipo: 'factura',
  propuesta: PropuestaFactura,
  proveedorId: string,
  url: string,
  origen?: OrigenDocumento,
): FacturaCreate
export function buildCreatePayload(
  tipo: 'pago',
  propuesta: PropuestaPago,
  proveedorId: string,
  url: string,
  origen?: OrigenDocumento,
): PagoCreate
export function buildCreatePayload(
  tipo: 'factura' | 'pago',
  propuesta: PropuestaFactura | PropuestaPago,
  proveedorId: string,
  url: string,
  origen: OrigenDocumento = 'IA',
): FacturaCreate | PagoCreate {
  if (tipo === 'factura') {
    const p = propuesta as PropuestaFactura
    const payload: FacturaCreate = {
      proveedor_id: proveedorId,
      fecha_emision: p.fecha_emision as string,
      monto_total: p.monto_total as number,
      origen,
    }
    if (p.numero !== null) {
      payload.numero = p.numero
    }
    if (url) {
      payload.archivo_url = url
    }
    return payload
  }

  const p = propuesta as PropuestaPago
  const payload: PagoCreate = {
    proveedor_id: proveedorId,
    monto: p.monto as number,
    fecha: p.fecha as string,
    metodo: p.metodo as MetodoPago,
    origen,
  }
  if (url) {
    payload.comprobante_url = url
  }
  return payload
}
