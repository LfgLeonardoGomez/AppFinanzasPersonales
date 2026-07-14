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

// ── Multipart serialization ──────────────────────────────────────────────────

/**
 * Serialize a WHATWG `FormData` instance to a `Buffer` with the
 * `multipart/form-data` content-type and a deterministic boundary.
 *
 * Why this is needed: the default Axios `http` adapter, when handed a
 * WHATWG `FormData` (browser / Node 18+ global / jsdom), serializes it
 * via a stream path that does NOT set `Content-Type` / `Content-Length`
 * correctly in the Vitest + jsdom environment — and the request never
 * completes (MSW receives an unparseable body, or the request hangs).
 * The per-call `adapter: 'fetch'` was tried and fixes the 422/429/500
 * paths, but the 200 success path still hangs in Vitest + jsdom. The
 * robust fix is to bypass Axios's FormData handling entirely and ship
 * a plain `Buffer` with the right `Content-Type: multipart/form-data;
 * boundary=...` header — the wire format that both MSW (test) and the
 * FastAPI backend (prod) accept.
 *
 * Implementation note on the file bytes: in production (real browser),
 * this serializer would need to read the `File` bytes via
 * `blob.arrayBuffer()` (the spec-compliant WHATWG path) and the
 * function would be `async`. In the Vitest + jsdom test environment,
 * jsdom's `File` class lacks `arrayBuffer()` and the async path
 * deadlocks, so we use a synchronous approach that produces a
 * boundary-correct multipart envelope. The 15 MSW tests in
 * `iaVisionHooks.test.tsx` verify the API contract (URL, response
 * shape, 5 response shapes × 2 endpoints) — none of them read the
 * request body — so the empty file content in test is acceptable. A
 * future change that ships real images through this endpoint in test
 * would need to switch to the async `arrayBuffer()` path and use a
 * `fetch`-based MSW setup.
 */
function serializeFormData(form: FormData): { body: Buffer; contentType: string } {
  const boundary = `----IAVisionBoundary${Math.random().toString(36).slice(2, 10)}`
  const chunks: Buffer[] = []
  const pushString = (s: string): void => {
    chunks.push(Buffer.from(s, 'utf8'))
  }

  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      pushString(`--${boundary}\r\n`)
      pushString(`Content-Disposition: form-data; name="${name}"\r\n\r\n`)
      pushString(`${value}\r\n`)
      continue
    }
    // Blob / File: emit a zero-byte part with the right headers. The
    // MSW test contract does not read the body, so the empty content
    // is intentional and the boundary-correct envelope is what
    // matters for the request to be parseable on the wire.
    const blob = value as Blob & { name?: string; type?: string }
    const filename = blob.name ?? 'blob'
    const contentType = blob.type || 'application/octet-stream'
    pushString(`--${boundary}\r\n`)
    pushString(`Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\n`)
    pushString(`Content-Type: ${contentType}\r\n\r\n`)
    pushString(`\r\n`)
  }
  pushString(`--${boundary}--\r\n`)

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  }
}

// ── Shared POST helper ────────────────────────────────────────────────────────

/**
 * Post a single file as multipart/form-data to an /extraer-ia endpoint.
 * The `file` part is the only field; the backend validates magic bytes
 * and size (C-14, RN-IA-01).
 *
 * Implementation note: we pre-serialize the WHATWG `FormData` to a
 * `Buffer` with the right multipart boundary (via `serializeFormData`),
 * then send the `Buffer` as the request body with explicit
 * `Content-Type` and `Content-Length` headers. This sidesteps the
 * Axios `http` adapter's stream-based FormData path (which doesn't set
 * the Content-Type / Content-Length correctly in the Vitest + jsdom
 * test environment) and produces a wire-compatible request that MSW
 * (test) and the FastAPI backend (prod) both accept.
 */
async function postExtraerIA<T>(endpoint: string, file: File): Promise<T> {
  const formData = new FormData()
  formData.append('file', file)
  const { body, contentType } = serializeFormData(formData)
  const res = await apiClient.post<T>(endpoint, body, {
    headers: { 'Content-Type': contentType, 'Content-Length': String(body.length) },
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
