/**
 * Raw Axios calls for the C-39 export endpoints:
 *
 *   GET /api/proveedores/{id}/cuenta-corriente/export
 *   GET /api/clientes/{id}/cuenta-corriente/export
 *
 * design.md D7 — the frontend does NOT build the document or compute any of
 * its numbers: it requests the file as a `Blob` and hands it to the browser
 * as-is. This module is pure transport — no parsing, no summing, no
 * reformatting of amounts. It exists to:
 *
 *  1. Build the query params, omitting `desde`/`hasta` entirely when there
 *     is no range (never sending them as empty strings — task 8.3).
 *  2. Read the download filename from the backend's `Content-Disposition`
 *     (D6) — never composed on the client.
 *  3. On a rejection (most importantly the 422 "too many movements" case,
 *     design.md D5), recover the JSON `detail` the backend wrote to be
 *     acted on — even though the request was sent with
 *     `responseType: 'blob'`, which means an ERROR response body arrives
 *     as a `Blob` too, not as parsed JSON. `extraerDetalleErrorExport`
 *     un-blobs it back into the object the UI needs to show verbatim.
 */
import { apiClient } from '@shared/api/client'
import { isAxiosError } from 'axios'

export type FormatoExport = 'pdf' | 'xlsx'

export interface ExportarCuentaCorrienteParams {
  formato: FormatoExport
  incluirHistorial?: boolean
  desde?: string
  hasta?: string
}

export interface ArchivoExportado {
  blob: Blob
  filename: string
}

/** The shape of the 422 "too many movements" detail (design.md D5). */
export interface DetalleErrorExport {
  mensaje?: string
  cantidad_movimientos?: number
  tope?: number
  sugerencia?: string
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function exportarCuentaCorrienteProveedor(
  proveedorId: string,
  params: ExportarCuentaCorrienteParams,
): Promise<ArchivoExportado> {
  return _exportar(`/proveedores/${proveedorId}/cuenta-corriente/export`, params)
}

export async function exportarCuentaCorrienteCliente(
  clienteId: string,
  params: ExportarCuentaCorrienteParams,
): Promise<ArchivoExportado> {
  return _exportar(`/clientes/${clienteId}/cuenta-corriente/export`, params)
}

/**
 * Recover the backend's `detail` from a rejected export request.
 *
 * The request is sent with `responseType: 'blob'`, so Axios applies that
 * SAME response type to an error response too — `error.response.data` is a
 * `Blob` of the JSON error body, not a parsed object. This reads it back.
 * Returns `null` when `error` is not an Axios error with a body to read.
 */
export async function extraerDetalleErrorExport(error: unknown): Promise<DetalleErrorExport | null> {
  if (!isAxiosError(error) || !error.response) return null

  const raw = error.response.data as unknown
  let parsed: unknown

  if (raw instanceof Blob) {
    try {
      parsed = JSON.parse(await _blobToText(raw))
    } catch {
      return null
    }
  } else {
    parsed = raw
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const detail = (parsed as { detail?: unknown }).detail

  if (typeof detail === 'string') return { mensaje: detail }
  if (typeof detail === 'object' && detail !== null) return detail as DetalleErrorExport
  return null
}

// ── Internals ────────────────────────────────────────────────────────────────

async function _exportar(url: string, params: ExportarCuentaCorrienteParams): Promise<ArchivoExportado> {
  const query: Record<string, string | boolean> = { formato: params.formato }
  if (params.incluirHistorial) query.incluir_historial = true
  if (params.desde) query.desde = params.desde
  if (params.hasta) query.hasta = params.hasta

  const res = await apiClient.get<Blob>(url, {
    params: query,
    responseType: 'blob',
  })

  return {
    blob: res.data,
    filename: _parseFilename(res.headers['content-disposition'], params.formato),
  }
}

/**
 * `FileReader`, not `Blob.text()` — `text()` is a real browser API but is
 * NOT implemented by the test double this project's Vitest/jsdom
 * environment substitutes for `Blob` (verified empirically: `typeof
 * blob.text` is `undefined` there). `FileReader.readAsText` is implemented
 * by both, so it is the one path that actually works in production AND
 * under test, instead of two different code paths for each.
 */
function _blobToText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsText(blob)
  })
}

function _parseFilename(contentDisposition: unknown, formato: FormatoExport): string {
  if (typeof contentDisposition === 'string') {
    const match = /filename="?([^";]+)"?/i.exec(contentDisposition)
    if (match?.[1]) return match[1]
  }
  // Defensive fallback — the backend always sends Content-Disposition (D6),
  // this only guards against an unexpected response shape in a test double.
  return `cuenta-corriente.${formato}`
}
