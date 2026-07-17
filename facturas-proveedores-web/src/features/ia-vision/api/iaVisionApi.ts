/**
 * Raw Axios calls for the IA vision endpoints (C-15).
 *
 * The C-14 backend ships two additive endpoints:
 *   - POST /api/facturas/extraer-ia (multipart, image-only)
 *   - POST /api/pagos/extraer-ia     (multipart, image-only)
 *
 * Both return a `PropuestaFactura` / `PropuestaPago` envelope (200 even on
 * extractor failure — RN-IA-05). The Pydantic-v2 `Decimal` fields
 * (`monto_total`, `monto`) arrive as JSON strings; the `parsePropuesta*`
 * helpers here parse them to `number` at the API boundary (mirrors C-13's
 * `parseCuentaCorriente`, D13).
 *
 * Errors surface as Axios errors with `response.status` and
 * `response.headers['retry-after']` (for 429). The hooks in
 * `iaVisionHooks.ts` are thin wrappers that disable retry and skip
 * cache invalidation.
 */
import { apiClient } from '@shared/api/client'
import type { PropuestaFactura, PropuestaPago } from '@shared/api/api'

// ── File → bytes (cross-environment) ──────────────────────────────────────────

/**
 * Read a File's bytes as a `Uint8Array`. Real browsers expose
 * `Blob.arrayBuffer()`, but jsdom's `File` does not, so we fall back to
 * `FileReader` (available in both). This is what lets the same code path be
 * exercised by the Vitest + jsdom tests and run correctly in production.
 */
function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return file.arrayBuffer().then((buf) => new Uint8Array(buf))
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsArrayBuffer(file)
  })
}

// ── Shared POST helper ────────────────────────────────────────────────────────

/**
 * Post a single file as multipart/form-data to an /extraer-ia endpoint.
 * The `file` part is the only field; the backend validates magic bytes
 * and size (C-14, RN-IA-01). Axios serializes the native `FormData`
 * (correct boundary + real file bytes) in both the browser and the
 * MSW-backed jsdom tests, which do not read the request body.
 */
async function postExtraerIA<T>(endpoint: string, file: File): Promise<T> {
  // Build the multipart/form-data body by hand as a `Uint8Array`. This is the
  // one representation that works in BOTH environments:
  //   - real browser: `Buffer` is undefined (Node-only), and letting Axios
  //     auto-serialize a native `FormData` leaves the apiClient's default
  //     `Content-Type: application/json` in place → FastAPI drops the `file`
  //     field → 422 "Field required".
  //   - jsdom tests: Axios cannot transport a native `FormData` (the XHR
  //     adapter hangs, the fetch adapter throws DataCloneError).
  // A `Uint8Array` body with an explicit boundary sidesteps both: it carries
  // the REAL file bytes (read via `arrayBuffer()`, not the old zero-byte bug)
  // and we set the matching `multipart/form-data; boundary=…` Content-Type
  // ourselves, so nothing depends on runtime auto-serialization.
  const boundary = `----IAVisionBoundary${Math.random().toString(36).slice(2, 12)}`
  const enc = new TextEncoder()
  const head = enc.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${file.name || 'image'}"\r\n` +
      `Content-Type: ${file.type || 'application/octet-stream'}\r\n\r\n`,
  )
  const fileBytes = await readFileBytes(file)
  const tail = enc.encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + fileBytes.length + tail.length)
  body.set(head, 0)
  body.set(fileBytes, head.length)
  body.set(tail, head.length + fileBytes.length)

  const res = await apiClient.post<T>(endpoint, body, {
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
  })
  return res.data
}

// ── Decimal parsing helpers ───────────────────────────────────────────────────

/**
 * Parse a Pydantic-v2 Decimal string into a `number`. Defensive: any
 * non-finite result becomes `null` so the modal renders an empty input
 * (RN-IA-03 — never invent, guess, or compute a value).
 */
function parseDecimalOrNull(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Parse a `PropuestaFactura` payload from the API boundary. Mirrors the
 * C-14 Pydantic shape; converts the `monto_total` Decimal string to a
 * `number`. Exported for unit testing.
 */
export function parsePropuestaFactura(raw: PropuestaFactura): PropuestaFactura {
  return {
    ...raw,
    monto_total: parseDecimalOrNull(raw.monto_total as unknown as string | null),
  }
}

/**
 * Parse a `PropuestaPago` payload from the API boundary. Mirrors the
 * C-14 Pydantic shape; converts the `monto` Decimal string to a
 * `number`. Exported for unit testing.
 */
export function parsePropuestaPago(raw: PropuestaPago): PropuestaPago {
  return {
    ...raw,
    monto: parseDecimalOrNull(raw.monto as unknown as string | null),
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send an image to the C-14 vision extractor for invoice header data.
 * The response is a `PropuestaFactura` (200 even on extractor failure).
 * Never throws on 422 / 429 / `error: true` — the caller (the modal's
 * state machine) branches on the response shape.
 */
export async function extraerFacturaIA(file: File): Promise<PropuestaFactura> {
  const raw = await postExtraerIA<PropuestaFactura>('/facturas/extraer-ia', file)
  return parsePropuestaFactura(raw)
}

/**
 * Send an image to the C-14 vision extractor for payment header data.
 * The response is a `PropuestaPago` (200 even on extractor failure).
 */
export async function extraerPagoIA(file: File): Promise<PropuestaPago> {
  const raw = await postExtraerIA<PropuestaPago>('/pagos/extraer-ia', file)
  return parsePropuestaPago(raw)
}
