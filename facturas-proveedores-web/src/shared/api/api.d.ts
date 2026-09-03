/**
 * Public contract types for the facturas-proveedores backend, derived from
 * the OpenAPI schema (C-41).
 *
 * This file is the frontend's PUBLIC model, not the wire: it names the
 * backend's schemas from `api.generated.d.ts` and, where the wire carries a
 * Pydantic-v2 Decimal serialized as a JSON string, converts those named
 * fields to `number` via `DecimalAsNumber<T, K>` (design.md D2). The actual
 * string→number conversion happens at each API client's boundary (D3),
 * never here and never in a global interceptor — this file only DECLARES
 * the promise; `src/features/*/api/*Api.ts` keeps it.
 *
 * Types with no counterpart in the backend schema (query filters, paginated
 * wrappers the client builds, locally-constructed error shapes) are hand-
 * written and grouped under their own labeled section (design.md D5) — not
 * mixed in with the derived ones.
 *
 * Regenerate the wire layer with `npm run generate-types` (writes
 * `api.generated.d.ts`, never this file — D7).
 *
 * NOTE (D-C04-5): `LoginBody.remember_me` is an additive field on top of the
 * derived `LoginRequest` schema, not part of it — C-41's regeneration
 * confirmed the backend schema still does not declare it. See `LoginBody`
 * below.
 */
import type { components } from './api.generated'

// ---------------------------------------------------------------------------
// Derivation helpers (C-41, D2)
// ---------------------------------------------------------------------------

/**
 * Converts the named keys `K` of a wire schema `T` from whatever the wire
 * declares (typically a Decimal-as-string) to `number`, leaving every other
 * key untouched.
 *
 * Deliberately NOT "smart": it does not guess which fields are money by name
 * or by shape. Every conversion is an explicit, reviewable choice — a digit
 * string that must stay a string (the CUIT chief among them) is never at
 * risk of being silently coerced (design.md D2, D3).
 *
 * `K extends never` (no keys named) is a legal, common case: it derives a
 * type identical to `T`, used for every public type that has no money field
 * at all — the same mechanism proves out the derivation pipeline before any
 * conversion is layered on top of it (task group 2). It is handled as an
 * explicit short-circuit rather than falling through to `Omit<T, never>`:
 * `Omit`/`Pick` resolve through `keyof T`, and for a string-literal union
 * schema (every backend enum) `keyof T` does not mean "no keys" — it means
 * the keys of `String.prototype` (`charAt`, `length`, ...), which would
 * silently turn an enum into an object type instead of leaving it alone.
 */
export type DecimalAsNumber<T, K extends keyof T> = [K] extends [never]
  ? T
  : Omit<T, K> & { [P in K]: number }

// ---------------------------------------------------------------------------
// Core domain types
// ---------------------------------------------------------------------------

export interface Usuario {
  id: string
  /** Negocio the session belongs to (C-28, D-27). Output only. */
  negocio_id: string
  /** Single privilege flag (C-28, D-29). Gates team management only. */
  es_admin: boolean
  email: string
  nombre: string
  /** Optional profile fields (C-05). */
  telefono?: string | null
  avatar_url?: string | null
  nombre_negocio?: string | null
  tema_preferido?: 'CLARO' | 'OSCURO'
  created_at: string
  updated_at?: string
}

// ---------------------------------------------------------------------------
// Auth request / response bodies
// ---------------------------------------------------------------------------

export interface RegistroBody {
  email: string
  nombre: string
  password: string
  /** Optional (C-28): omitted, the backend derives it from the user's name. */
  nombre_negocio?: string
}

/**
 * Payload for POST /api/auth/registro-empleado (C-29).
 *
 * Separate from RegistroBody on purpose: that one creates a negocio, this
 * one joins an existing one. No negocio_id and no es_admin — the shop comes
 * from the code and the privilege is not something you can ask for.
 *
 * Derived from `components['schemas']['RegistroEmpleadoRequest']` (C-41,
 * D6 alias — same shape, renamed on the backend).
 */
export type RegistroEmpleadoBody = DecimalAsNumber<
  components['schemas']['RegistroEmpleadoRequest'],
  never
>

/**
 * Payload for POST /api/auth/recuperar (C-31).
 * Derived from `RecuperarRequest` (C-41, D6 alias).
 */
export type RecuperarBody = DecimalAsNumber<components['schemas']['RecuperarRequest'], never>

/**
 * Payload for POST /api/auth/reset (C-31).
 * Derived from `ResetRequest` (C-41, D6 alias).
 */
export type ResetBody = DecimalAsNumber<components['schemas']['ResetRequest'], never>

/**
 * Derived from `LoginRequest` (C-41, D6 alias — same shape, renamed on the
 * backend), PLUS `remember_me`. C-41's regeneration confirmed the D-C04-5
 * forward-declaration warning was correct: `LoginRequest` has no
 * `remember_me` field on the backend today. It stays here as an explicit
 * additive field (not silently dropped — `LoginPage.tsx` sends it) rather
 * than folded into the schema derivation, so the gap between "what the
 * frontend sends" and "what the backend schema documents" stays visible
 * instead of being hidden inside a plain re-export.
 */
export type LoginBody = DecimalAsNumber<components['schemas']['LoginRequest'], never> & {
  /** Delegates session duration to the backend (D-C04-5). Forward-declared. */
  remember_me?: boolean
}

export interface LoginResponse {
  user: Usuario
}

export interface MeResponse extends Usuario {}

// ---------------------------------------------------------------------------
// Proveedores domain types (C-06 backend, C-07 frontend)
// ---------------------------------------------------------------------------

/**
 * Supplier category enum (backend: app/models/proveedor.py).
 * SERVICIO covers services, OTRO is the default.
 * Derived from `CategoriaProveedor` (C-41, D6 alias).
 */
export type Categoria = DecimalAsNumber<components['schemas']['CategoriaProveedor'], never>

/**
 * Full supplier object returned by GET /api/proveedores/{id}.
 * saldo is computed on-demand by the backend (RN-SALDO). NEVER computed on frontend.
 *
 * Derived from `ProveedorResponse` (C-41, D6 alias). `cuit`, `telefono` and
 * `notas` are widened back to REQUIRED (`string | null`, not `?: string |
 * null`): the OpenAPI schema marks them "not required" because that is what
 * `Optional[str] = None` means at the Pydantic constructor, but FastAPI
 * still serializes the key on every response — a Decimal-shaped field
 * missing from the wire would be a truncated response, not an absent key.
 * `parseProveedor` (`proveedoresApi.ts`) is the boundary that makes this
 * true; it always writes the key.
 */
export type Proveedor = Omit<
  DecimalAsNumber<components['schemas']['ProveedorResponse'], 'saldo'>,
  'cuit' | 'telefono' | 'notas'
> & {
  cuit: string | null
  telefono: string | null
  notas: string | null
}

/**
 * Item in the paginated list (GET /api/proveedores) — a LEANER row than
 * `Proveedor`, not the same shape: the backend omits `telefono`, `notas`,
 * `created_at` and `updated_at`, and adds `ultima_factura_fecha` (Home
 * redesign). The old hand-written `extends Proveedor {}` was wrong — it
 * promised fields (`telefono`, `notas`, timestamps) the list endpoint never
 * sends, which is exactly the kind of drift this file exists to end.
 *
 * Derived from `ProveedorListItem`. Same `cuit` required-widening rationale
 * as `Proveedor`; `ultima_factura_fecha` follows the same reasoning too —
 * always present, `null` when the supplier has no active facturas.
 */
export type ProveedorListItem = Omit<
  DecimalAsNumber<components['schemas']['ProveedorListItem'], 'saldo'>,
  'cuit' | 'ultima_factura_fecha'
> & {
  cuit: string | null
  ultima_factura_fecha: string | null
}

/**
 * Payload for POST /api/proveedores (create).
 * usuario_id is taken from the session by the backend — never sent by the client.
 */
export interface ProveedorCreate {
  nombre: string
  cuit?: string | null
  telefono?: string | null
  categoria?: Categoria
  notas?: string | null
}

/**
 * Payload for PATCH /api/proveedores/{id} (partial update).
 * All fields optional. usuario_id cannot be changed.
 */
export interface ProveedorUpdate {
  nombre?: string
  cuit?: string | null
  telefono?: string | null
  categoria?: Categoria
  notas?: string | null
}

/**
 * Response from DELETE /api/proveedores/{id}.
 * tiene_dependencias=true → frontend must show confirmation modal (RN-PROV-04).
 * The backend already performed the soft delete regardless of dependencies.
 * Derived from `ProveedorDeleteResponse` (C-41).
 */
export type ProveedorDeleteResponse = DecimalAsNumber<
  components['schemas']['ProveedorDeleteResponse'],
  never
>

/**
 * Paginated response wrapper for GET /api/proveedores.
 */
export interface PaginatedProveedores {
  items: ProveedorListItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

// ---------------------------------------------------------------------------
// Perfil domain types (C-05 backend, C-05 frontend)
// ---------------------------------------------------------------------------

/**
 * Preferred UI theme (backend: app/models/enums.py TemaPreferido).
 * Persisted on the backend profile — NEVER in localStorage (D6).
 * Derived from `TemaPreferido` (C-41).
 */
export type TemaPreferido = DecimalAsNumber<components['schemas']['TemaPreferido'], never>

/**
 * Payload for PATCH /api/me (partial update of optional profile fields).
 * Identity fields (email, nombre, password) are NOT on this type — they
 * cannot be modified through this path.
 */
export interface PerfilUpdate {
  telefono?: string | null
  nombre_negocio?: string | null
  tema_preferido?: TemaPreferido
}

/**
 * Payload for POST /api/me/avatar.
 * The URL must point to the configured Cloudinary account; the backend
 * re-validates this before persisting (D4).
 */
export type AvatarUpdate = DecimalAsNumber<components['schemas']['AvatarUpdate'], never>

/**
 * Upload kind for the signed-preset endpoint (D5).
 * C-05 supports 'avatar'; C-08 added 'factura' (Factura.archivo_url);
 * C-10 added 'comprobante' (Pago.comprobante_url).
 * Derived from `TipoUpload` (C-41).
 */
export type TipoUpload = DecimalAsNumber<components['schemas']['TipoUpload'], never>

/**
 * Signed Cloudinary upload preset returned by GET /api/cloudinary/preset-firmado.
 * Public parameters only — the API secret is NEVER part of this response.
 * Derived from `PresetFirmadoResponse` (C-41).
 */
export type PresetFirmadoResponse = DecimalAsNumber<
  components['schemas']['PresetFirmadoResponse'],
  never
>

// ---------------------------------------------------------------------------
// Facturas domain types (C-08 backend, C-09 frontend)
// ---------------------------------------------------------------------------

/**
 * Computed invoice status. Derived server-side via FIFO (RN-FAC-09).
 * The frontend NEVER recomputes this value — it always reads it from the response.
 * Derived from `EstadoFactura` (C-41).
 */
export type EstadoFactura = DecimalAsNumber<components['schemas']['EstadoFactura'], never>

/**
 * Origin of a document (Factura or Pago). Stamped server-side; the client
 * never sends this — PagoCreate/FacturaCreate have no `origen` field.
 * MANUAL is set by the C-09/C-11 manual UI; IA is set by the C-14/C-15
 * vision-extraction flow.
 * Derived from `OrigenDocumento` (C-41).
 */
export type OrigenDocumento = DecimalAsNumber<components['schemas']['OrigenDocumento'], never>

/**
 * A single line item on an invoice (as returned by the API).
 * cantidad and precio_unitario are JSON numbers — formatted by the UI.
 * Derived from `FacturaItemResponse` (C-41, D6 alias).
 */
export type FacturaItem = DecimalAsNumber<
  components['schemas']['FacturaItemResponse'],
  'cantidad' | 'precio_unitario'
>

/**
 * Payload for creating/updating a line item.
 * descripcion must be non-empty; cantidad > 0; precio_unitario >= 0.
 *
 * NOT derived from `FacturaItemCreate` (D5-adjacent): the backend schema
 * accepts `number | string` for `cantidad`/`precio_unitario` (Pydantic's
 * Decimal validator takes either); this type narrows to `number` because
 * every call site builds the payload from parsed form state, never from a
 * raw wire string. Same narrowing rationale as `VentaCreate.monto`.
 */
export interface FacturaItemCreate {
  descripcion: string
  cantidad: number
  precio_unitario: number
}

/**
 * Full invoice object returned by GET /api/facturas/{id}.
 * estado is computed on-demand by the backend (RN-FAC-09). NEVER computed on frontend.
 * items_sum_mismatch is authoritative — the client sum warning is UX only (RN-FAC-04).
 *
 * Derived from `FacturaResponse` (C-41). `numero` is widened back to
 * REQUIRED (`string | null`, not `?: string | null`) for the same reason
 * `Proveedor.cuit`/`.telefono`/`.notas` are: the OpenAPI schema marks it
 * "not required" because that is what `Optional[str] = None` means at the
 * Pydantic constructor, but FastAPI still serializes the key on every
 * response. `items` is overridden to the derived public `FacturaItem[]` —
 * `DecimalAsNumber` only converts top-level keys, so the nested wire items
 * (string `cantidad`/`precio_unitario`) would otherwise leak through
 * untouched. `parseFactura` (`facturasApi.ts`) is the boundary that makes
 * both of these true.
 */
export type FacturaResponse = Omit<
  DecimalAsNumber<components['schemas']['FacturaResponse'], 'monto_total'>,
  'numero' | 'items'
> & {
  numero: string | null
  items: FacturaItem[]
}

/**
 * Lean row for the paginated listing — this is what `GET /api/facturas`
 * ACTUALLY returns.
 *
 * c-26: this type used to declare `usuario_id`, `fecha_vencimiento`,
 * `archivo_url`, `origen`, `created_at` and `updated_at`. The backend's
 * `FacturaListItem` omits every one of them on purpose ("Omits items,
 * timestamps, and archivo_url to keep payload small"), so the type was
 * promising fields that arrive as `undefined` at runtime — a compiler that
 * vouches for data the server never sends. Anything needing those fields
 * must fetch the full invoice via `GET /api/facturas/{id}`.
 *
 * Derived from `FacturaListItem` (C-41). Same `numero` required-widening
 * rationale as `FacturaResponse`.
 */
export type FacturaListItem = Omit<
  DecimalAsNumber<components['schemas']['FacturaListItem'], 'monto_total'>,
  'numero'
> & {
  numero: string | null
}

/**
 * Alias for the full Factura (returned on create/update — same as FacturaResponse).
 */
export interface Factura extends FacturaResponse {}

/**
 * Paginated response wrapper for GET /api/facturas.
 */
export interface PaginatedFacturas {
  items: FacturaListItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

/**
 * Payload for POST /api/facturas (create).
 * usuario_id is taken from the session cookie by the backend.
 *
 * origen (C-15, c-15a OQ-1 Path B): the C-09 manual UI omits it (the
 * backend stamps MANUAL). The C-15 IA modal sets `origen: 'IA'` on the
 * post-confirm POST so the persisted row records the origin. Fully
 * manual entries (C-09 / C-13 flow) DO NOT include the key — the
 * backend defaults to MANUAL.
 */
export interface FacturaCreate {
  proveedor_id: string
  fecha_emision: string
  monto_total: number
  numero?: string | null
  fecha_vencimiento?: string | null
  archivo_url?: string | null
  items?: FacturaItemCreate[]
  origen?: OrigenDocumento
}

/**
 * Payload for PATCH /api/facturas/{id} (partial update).
 * proveedor_id is NOT changeable after creation (C-08 spec).
 */
export interface FacturaUpdate {
  fecha_emision?: string
  monto_total?: number
  numero?: string | null
  fecha_vencimiento?: string | null
  archivo_url?: string | null
  items?: FacturaItemCreate[]
}

/**
 * Query params for GET /api/facturas.
 * estado filter is resolved server-side after FIFO (RN-FAC-09) — frontend just passes the value.
 */
export interface FacturasFilters {
  proveedor_id?: string
  estado?: EstadoFactura
  fecha_desde?: string
  fecha_hasta?: string
  page?: number
}

// ---------------------------------------------------------------------------
// Pagos domain types (C-10 backend, C-11 frontend)
// ---------------------------------------------------------------------------

/**
 * Payment method enum (backend: app/models/enums.py MetodoPago).
 * All payments are in ARS (no multi-currency, no IVA — D-C02-5).
 * Derived from `MetodoPago` (C-41).
 */
export type MetodoPago = DecimalAsNumber<components['schemas']['MetodoPago'], never>

/**
 * Full payment object returned by GET /api/pagos/{id}.
 *
 * INVARIANTS (RN-PAG-01, hard rule #1):
 *   - This type has NO `factura_id` key. Payments are supplier-scoped —
 *     they never link to a specific invoice. Enforced at three levels:
 *     (1) the backend SQLModel has no such column;
 *     (2) PagoCreate / PagoUpdate don't declare the field;
 *     (3) `extra="forbid"` on both schemas rejects any payload that tries.
 *   - `origen` is always MANUAL for now (C-14 will introduce IA pagos).
 */
export interface PagoResponse {
  id: string
  negocio_id: string
  proveedor_id: string
  monto: number
  fecha: string
  metodo: MetodoPago
  comprobante_url: string | null
  origen: OrigenDocumento
  created_at: string
  updated_at: string
  /**
   * C-18 (FE-005): the related supplier's name, populated by the
   * backend for POST/GET/PATCH responses. `None` when the supplier
   * was soft-deleted (the pago remains valid; the supplier's
   * absence is informational). The list endpoint does NOT carry
   * this field on PagoListItem.
   */
  proveedor_nombre?: string | null
}

/**
 * Item in the paginated payment list (GET /api/pagos).
 * Lean row — drops comprobante_url and updated_at to keep the payload small.
 * Mirrors FacturaListItem (C-08). NO factura_id (RN-PAG-01).
 */
export interface PagoListItem {
  id: string
  proveedor_id: string
  monto: number
  fecha: string
  metodo: MetodoPago
  origen: OrigenDocumento
  created_at: string
}

/**
 * Alias for the full Pago (returned on create/update — same as PagoResponse).
 */
export interface Pago extends PagoResponse {}

/**
 * Paginated response wrapper for GET /api/pagos.
 * Mirrors PaginatedFacturas (note: no `total_pages` — backend C-10 returns
 * `{items, total, page, page_size}`; the client computes total_pages if needed).
 */
export interface PagoListResponse {
  items: PagoListItem[]
  total: number
  page: number
  page_size: number
}

/**
 * Payload for POST /api/pagos (create).
 *
 * INVARIANTS:
 *   - NO `factura_id` key (RN-PAG-01). See PagoResponse for the triple-enforcement rationale.
 *   - NO `usuario_id` — taken from the session by the backend.
 *   - NO `id` — backend assigns the UUID.
 *
 * origen (C-15, c-15a OQ-1 Path B): the C-11 manual UI omits it. The
 * C-15 IA modal sets `origen: 'IA'` on the post-confirm POST. The
 * backend's `PagoCreate` declares it as `Optional[OrigenDocumento]`
 * since c-15a; `extra="forbid"` is preserved so `factura_id` and other
 * unknown fields still get rejected with 422.
 */
export interface PagoCreate {
  proveedor_id: string
  monto: number
  fecha: string
  metodo: MetodoPago
  comprobante_url?: string | null
  origen?: OrigenDocumento
}

/**
 * Payload for PATCH /api/pagos/{id} (partial update).
 *
 * INVARIANTS:
 *   - NO `proveedor_id` (D7: re-linking a pago to a different supplier
 *     would corrupt the FIFO pool's history).
 *   - NO `factura_id` (RN-PAG-01).
 *   - All fields optional — only fields explicitly set (non-None) are applied.
 *   - NO `origen`, NO `usuario_id` — immutable.
 */
export interface PagoUpdate {
  monto?: number
  fecha?: string
  metodo?: MetodoPago
  comprobante_url?: string | null
}

/**
 * Query params for GET /api/pagos.
 * Pagos have no `estado` (RN-PAG-01: no per-invoice link → no per-invoice
 * estado to filter on). Only supplier and pagination are supported.
 */
export interface PagosFilters {
  proveedor_id?: string
  page?: number
}

// ---------------------------------------------------------------------------
// IA vision domain types (C-14 backend, C-15 frontend)
// ---------------------------------------------------------------------------

/**
 * Output of POST /api/facturas/extraer-ia (C-14, ia-vision-backend spec).
 *
 * Mirrors the Pydantic `PropuestaFactura` in `app/schemas/factura.py:192`.
 * Every field except `error` is nullable — the vision extractor marks
 * unreadable fields as `null` and the frontend MUST render empty inputs
 * (RN-IA-03: never invent, guess, or compute a value).
 *
 * INVARIANTS (locked at the type level by `api.iaVision.test-d.ts`):
 *   - NO `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`,
 *     `updated_at`, no `factura_id` — the C-14 spec is explicit that
 *     vision proposals are header-only and identity-less. The `origen=IA`
 *     flag is stamped by the existing `POST /api/facturas` on confirm
 *     (c-15a, OQ-1 Path B).
 *   - `monto_total` is typed as `number` — the API helper parses the
 *     Pydantic-v2 Decimal-string at the boundary (D13, mirrors C-13's
 *     `parseCuentaCorriente`).
 *   - `error: boolean` is required (always present) and `error_message`
 *     is `string | null`. The C-14 contract guarantees these two are
 *     always on the response.
 */
export interface PropuestaFactura {
  proveedor_nombre: string | null
  numero: string | null
  fecha_emision: string | null
  monto_total: number | null
  error: boolean
  error_message: string | null
}

/**
 * Output of POST /api/pagos/extraer-ia (C-14, ia-vision-backend spec).
 *
 * Mirrors the Pydantic `PropuestaPago` in `app/schemas/pago.py:104`.
 * Same nullable contract as `PropuestaFactura`. The C-14 Pydantic
 * normalizes invalid enum values to `None`; the TS type mirrors this
 * with `MetodoPago | null`.
 *
 * INVARIANTS (locked at the type level by `api.iaVision.test-d.ts`):
 *   - NO `factura_id` (RN-PAG-01 surface defense in depth).
 *   - NO `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`,
 *     `updated_at`.
 *   - The `metodo` field is `MetodoPago | null` — never a raw string.
 */
export interface PropuestaPago {
  proveedor_nombre: string | null
  monto: number | null
  fecha: string | null
  metodo: MetodoPago | null
  error: boolean
  error_message: string | null
}

// ---------------------------------------------------------------------------
// Cuenta-corriente domain types (C-12 backend, C-13 frontend)
// ---------------------------------------------------------------------------

/**
 * Single factura row in the cuenta-corriente view, annotated with the FIFO
 * `estado` from the C-12 service layer (RN-FIFO). Mirrors the C-08
 * `FacturaResponse` shape with `items` and `items_sum_mismatch` omitted;
 * the cuenta-corriente is a per-supplier roll-up, not a detail view.
 *
 * The wire serializes `monto_total` as a Pydantic-v2 Decimal string; the
 * C-13 `getCuentaCorriente` helper parses it to `number` at the API
 * boundary (D13) so the rest of the app never sees a string-encoded decimal.
 *
 * INVARIANTS (RN-PAG-01, hard rule #1):
 *   - This type has NO `factura_id` key on a Pago. The cross-feature cache
 *     invalidation uses `proveedor_id` (see D6). The compile-time + runtime
 *     guards in `api.cuentaCorriente.test-d.ts` and `api.pagos.test.ts`
 *     lock the structural absence on the cuenta-corriente surface.
 */
/**
 * Derived from `FacturaConEstado` (C-41). Same `numero` required-widening
 * rationale as `FacturaResponse` — the schema marks it "not required" but
 * FastAPI always serializes the key. `parseFacturaConEstado`
 * (`cuentaCorrienteApi.ts`) is the boundary that makes this true and
 * already parses `monto_total`; this change only derives the type.
 */
export type FacturaConEstado = Omit<
  DecimalAsNumber<components['schemas']['FacturaConEstado'], 'monto_total'>,
  'numero'
> & {
  numero: string | null
}

/**
 * Historial entry type — `FACTURA` rows are debe (add), `PAGO` rows are
 * haber (subtract). The sign lives in the response's `saldo_acumulado`;
 * `monto` is always positive (the type comes from the C-12 spec).
 */
export type EntradaHistorialTipo = 'FACTURA' | 'PAGO'

/**
 * Single row in the cuenta-corriente `historial` array. The C-12 service
 * orders by `(fecha ASC, created_at ASC, id ASC)`; the frontend renders
 * the array verbatim — no client-side re-ordering (RN-HIST).
 *
 * `monto` is the absolute value; `saldo_acumulado` is signed and the
 * last row's value equals the response's `saldo` (the C-12 cross-check
 * invariant).
 *
 * `archivo_url` (C-24): the attached file for this row — `Factura.archivo_url`
 * for FACTURA rows, `Pago.comprobante_url` for PAGO rows. `null`/absent when
 * the underlying row has no file attached.
 *
 * NOTE: hand-edited (not regenerated via `npm run generate-types`) — the
 * running dev API reflects concurrent, unrelated in-progress work from other
 * changes, and a full regeneration produced an unrelated multi-thousand-line
 * diff. Only this one field was added, matching the backend Pydantic schema
 * (`EntradaHistorial.archivo_url: Optional[str] = None`) exactly. Safe to
 * regenerate later once the API is back to a clean/released state — that
 * regeneration should produce an identical shape for this field.
 */
export interface EntradaHistorial {
  id: string
  tipo: EntradaHistorialTipo
  fecha: string
  monto: number
  saldo_acumulado: number
  archivo_url?: string | null
}

/**
 * Response shape of `GET /api/proveedores/{id}/cuenta-corriente` (C-12).
 * The endpoint has no request body and no query parameters. The frontend
 * consumes the triple verbatim — `saldo`, the FIFO `estado` of each
 * `facturas_con_estado` row, and the `saldo_acumulado` of each `historial`
 * row are NEVER recomputed on the client (RN-SALDO, RN-FIFO, RN-HIST).
 */
export interface CuentaCorrienteResponse {
  proveedor_id: string
  saldo: number
  facturas_con_estado: FacturaConEstado[]
  historial: EntradaHistorial[]
}

/**
 * Client-side filter state for the cuenta-corriente facturas table.
 * Filters are applied on the response payload fields (`f.estado` and
 * `f.fecha_emision`) — the hook has no query params, the endpoint has
 * no query parameters (D3, D8). Defense in depth for RN-FAC-09: the
 * frontend never re-issues the request with a `estado` filter at the
 * SQL level.
 */
export interface FiltrosFacturas {
  estado?: EstadoFactura
  fecha_desde?: string
  fecha_hasta?: string
}

/**
 * Delete input for the `useDeleteFactura` mutation. Carries the supplier
 * id alongside the factura id so the cross-feature cache invalidation
 * (D6) can target the right `cuenta-corriente.detail(proveedorId)` key
 * without an extra `GET /api/facturas/{id}` round-trip.
 *
 * INVARIANT (RN-PAG-01, hard rule #1): no `factura_id` key. The compile-
 * time guard in `api.cuentaCorriente.test-d.ts` locks this.
 */
export interface FacturaDeleteInput {
  id: string
  proveedor_id: string
}

/**
 * Delete input for the `useDeletePago` mutation. Same shape and rationale
 * as `FacturaDeleteInput`. NO `factura_id` key (RN-PAG-01).
 */
export interface PagoDeleteInput {
  id: string
  proveedor_id: string
}

// ---------------------------------------------------------------------------
// Error bodies (from FastAPI / Pydantic)
// ---------------------------------------------------------------------------

/** Derived from `ValidationError` (C-41). */
export type ValidationError = DecimalAsNumber<components['schemas']['ValidationError'], never>

export interface HTTPValidationError {
  detail: ValidationError[]
}

export interface HTTPError {
  detail: string
}

// ---------------------------------------------------------------------------
// Equipo (C-29)
// ---------------------------------------------------------------------------

/** A team member as the admin sees them in the list. Derived from `MiembroResponse` (C-41). */
export type MiembroResponse = DecimalAsNumber<components['schemas']['MiembroResponse'], never>

/**
 * A freshly issued invitation.
 *
 * `codigo` appears here and nowhere else in the API: only its hash is stored,
 * so this response is the single chance to read it (D-31). The UI has to make
 * that obvious to the admin.
 * Derived from `InvitacionResponse` (C-41).
 */
export type InvitacionResponse = DecimalAsNumber<components['schemas']['InvitacionResponse'], never>

// ---------------------------------------------------------------------------
// Clientes domain types (C-32 backend, C-34 frontend)
// ---------------------------------------------------------------------------

/**
 * A customer as the app sees them (backend: app/schemas/cliente.py).
 *
 * `nombre_normalizado` is returned for information — it MAY be displayed or
 * compared, but MUST NEVER be sent in a request payload (design.md D8):
 * identity is decided exclusively by the backend (`app/core/normalizacion.py`).
 */
export interface Cliente {
  id: string
  negocio_id: string
  nombre: string
  nombre_normalizado: string
  telefono?: string | null
  notas?: string | null
  created_at: string
  updated_at: string
  /**
   * On-demand balance (backend: `ClienteResponse.saldo: Optional[Decimal] =
   * None`, app/schemas/cliente.py). Populated ONLY by the plain listing
   * endpoint (GET /api/clientes with no `buscar` filter) — `null` on
   * create/get/update/search, which don't pay the extra aggregate query.
   *
   * Typed as `string`, not `number`, unlike `Proveedor.saldo` — this
   * backend serializes `Decimal` fields as JSON strings (confirmed on the
   * same Decimal-typed field via
   * `test_c35_cuenta_corriente_cliente_integration.py`: `data["saldo"] ==
   * "0.00"`), the same convention already used for `Venta.monto`.
   * `Proveedor.saldo: number` predates this and is not touched here.
   */
  saldo: string | null
}

/** Item in the customer list/search results — same shape as Cliente. */
export interface ClienteListItem extends Cliente {}

/**
 * Payload for POST /api/clientes (create).
 *
 * Only `nombre` — this change's `ClienteAutocomplete` creates a customer from
 * the name alone (RN-CLI-01, design.md D7). `negocio_id` comes from the
 * session; `nombre_normalizado` is derived server-side, never accepted.
 */
export type ClienteCreate = DecimalAsNumber<components['schemas']['ClienteCreate'], never>

/**
 * Shape of the `detail` object on a `409` from POST /api/clientes
 * (backend: `app/services/cliente_service.py::_conflicto`).
 *
 * `cliente_existente` is present whenever the conflicting customer could be
 * identified — the frontend offers it instead of surfacing an error
 * (design.md D8, RN-CLI-03).
 */
export interface ClienteConflictDetail {
  mensaje: string
  cliente_existente?: { id: string; nombre: string }
}

// ---------------------------------------------------------------------------
// Ventas domain types (C-33 backend, C-34 frontend)
// ---------------------------------------------------------------------------

/**
 * Sale payment method (backend: app/models/enums.py FormaPago).
 *
 * Deliberately SEPARATE from `MetodoPago` (money going OUT to suppliers,
 * C-10): `MetodoPago` carries `MERCADOPAGO` and has no notion of credit;
 * `FormaPago` carries `CUENTA_CORRIENTE` and has no `MERCADOPAGO`. Sharing
 * them would make a supplier payment expressible as "on account", which is
 * not a thing on that side of the ledger (design.md D4).
 * Derived from `FormaPago` (C-41).
 */
export type FormaPago = DecimalAsNumber<components['schemas']['FormaPago'], never>

/**
 * A sale as the app sees it (backend: app/schemas/venta.py VentaResponse).
 *
 * `cliente_id IS NOT NULL ⟺ forma_pago = CUENTA_CORRIENTE` (RN-VTA-03) — a
 * database CHECK enforces it, `venta_service._validar_par` enforces it, and
 * the frontend form's shape enforces it too (design.md D1).
 *
 * `monto` is typed `string` on the wire, like every other `Decimal` in this
 * API — it is parsed only at the aggregation boundary (design.md D2), never
 * accumulated as a float.
 *
 * NO `estado`, NO `saldo` — there is nothing to compute per sale; RN-VTA-05
 * totals are aggregated on demand from the list, never persisted (D-01).
 */
export interface Venta {
  id: string
  negocio_id: string
  cliente_id: string | null
  fecha: string
  monto: string
  forma_pago: FormaPago
  notas?: string | null
  created_at: string
  updated_at: string
}

/** Item in the sales list (GET /api/ventas) — same shape as Venta. */
export interface VentaListItem extends Venta {}

/**
 * Payload for POST /api/ventas (create).
 *
 * NO `negocio_id`, NO `creado_por_usuario_id` — both come from the session
 * (backend: app/schemas/venta.py). `cliente_id` is present only for a fiado.
 */
export interface VentaCreate {
  monto: string
  fecha: string
  forma_pago: FormaPago
  cliente_id?: string
  notas?: string | null
}

/**
 * Payload for PATCH /api/ventas/{id} (partial update).
 *
 * `cliente_id` is intentionally typed `string` (never `null`) — design.md D4
 * and the ventas-frontend spec require the edit form to NEVER send
 * `cliente_id: null`. `PATCH /api/ventas/{id}` reads an absent `cliente_id`
 * key as "leave it alone"; clearing happens implicitly, as a consequence of
 * sending a `forma_pago` other than `CUENTA_CORRIENTE`.
 */
export interface VentaUpdate {
  monto?: string
  fecha?: string
  forma_pago?: FormaPago
  cliente_id?: string
  notas?: string | null
}

/**
 * Query params for GET /api/ventas. Only non-empty filters are sent
 * (design.md D9) — a filtered day is a shareable, reloadable URL.
 */
export interface VentasFilters {
  desde?: string
  hasta?: string
  forma_pago?: FormaPago
  cliente_id?: string
}

/**
 * Delete input for the `useDeleteVenta` mutation. Carries `cliente_id` and
 * `forma_pago` alongside the `id`, following the `PagoDeleteInput` precedent
 * from C-13: the delete mutation needs to know which customer's cached
 * account to invalidate, and whether the sale was on account at all, without
 * an extra `GET` (design.md D4).
 */
export interface VentaDeleteInput {
  id: string
  cliente_id: string | null
  forma_pago: FormaPago
}

// ---------------------------------------------------------------------------
// Cuenta-corriente de clientes + cobros domain types (C-35 backend, C-36
// frontend, design.md D9)
//
// Hand-written, matching the style of every other block in this file — NOT
// produced by `npm run generate-types` (C-41 owns that migration).
//
// The number/string split below is deliberate, not an oversight:
//   - Ledger READS (`saldo`, `VentaConEstado.monto`,
//     `EntradaHistorialCliente.monto` / `saldo_acumulado`) are typed
//     `number` — parsed at the API boundary exactly like
//     `CuentaCorrienteResponse`, because the screen formats and compares
//     those values.
//   - The cobro WRITE (`CobroCliente.monto`, `CobroClienteCreate.monto`) is
//     typed `string` — raw wire, exactly like `Venta.monto` — because the
//     amount is typed by a human and sent back untouched; parsing it into a
//     float and re-serializing it is where a cent goes missing.
// ---------------------------------------------------------------------------

/**
 * Cobro payment method (backend: app/models/enums.py MetodoCobro).
 *
 * Its own enum — neither `MetodoPago` (money going OUT to suppliers, has
 * `MERCADOPAGO`) nor `FormaPago` (has `CUENTA_CORRIENTE` — debt is not
 * cancelled with debt).
 * Derived from `MetodoCobro` (C-41).
 */
export type MetodoCobro = DecimalAsNumber<components['schemas']['MetodoCobro'], never>

/**
 * FIFO state of a fiado (backend: app/models/enums.py EstadoVentaFiada).
 *
 * Deliberately NOT `PAGADA` (the supplier-side `EstadoFactura` value) — a
 * customer's sale reported as "paid" would read as though the shop had paid
 * it (C-35's stated reason).
 * Derived from `EstadoVentaFiada` (C-41).
 */
export type EstadoVentaFiada = DecimalAsNumber<components['schemas']['EstadoVentaFiada'], never>

/** Row type in the customer history — `VENTA` (debe) or `COBRO` (haber). */
export type EntradaHistorialClienteTipo = 'VENTA' | 'COBRO'

/**
 * A fiado (`Venta` with `forma_pago = CUENTA_CORRIENTE`) annotated with its
 * on-demand FIFO `estado` from the C-35 service layer (RN-FIFO). No
 * `numero`, no `fecha_vencimiento`, no `origen` — a fiado is a `Venta`, not
 * a `Factura`, and has none of them (design.md D3).
 */
export interface VentaConEstado {
  id: string
  negocio_id: string
  cliente_id: string
  fecha: string
  monto: number
  forma_pago: FormaPago
  notas?: string | null
  estado: EstadoVentaFiada
  created_at: string
  updated_at: string
}

/**
 * Single row in the customer's `historial` array. The C-35 service orders
 * chronologically and computes `saldo_acumulado` as a running sum in the
 * same walk — the frontend renders the array verbatim, never re-sorted
 * (RN-HIST, mirrors `EntradaHistorial`).
 */
export interface EntradaHistorialCliente {
  id: string
  tipo: EntradaHistorialClienteTipo
  fecha: string
  monto: number
  saldo_acumulado: number
  archivo_url?: string | null
}

/**
 * Response shape of `GET /api/clientes/{id}/cuenta-corriente` (C-35). The
 * frontend consumes the triple verbatim — `saldo`, each fiado's `estado`,
 * and each history row's `saldo_acumulado` are NEVER recomputed on the
 * client (RN-SALDO, RN-FIFO, RN-HIST, design.md D1).
 */
export interface CuentaCorrienteClienteResponse {
  cliente_id: string
  saldo: number
  ventas_con_estado: VentaConEstado[]
  historial: EntradaHistorialCliente[]
}

/**
 * A cobro as the app sees it (backend: app/schemas/cobro.py). `monto` is a
 * raw Decimal-string on the wire — see the block comment above for why it
 * is never parsed to `number` here.
 * Derived from `CobroClienteResponse` (C-41, D6 alias — same shape, renamed
 * on the backend). Zero conversion keys: `monto` is deliberately left as
 * the wire's `string`.
 */
export type CobroCliente = DecimalAsNumber<components['schemas']['CobroClienteResponse'], never>

/**
 * Payload for POST /api/cobros (create).
 *
 * NO `venta_id` (RN-CCC-03 — a cobro is not linked to a specific sale), NO
 * `negocio_id`, NO `creado_por_usuario_id` — both come from the session.
 * `extra="forbid"` on the backend schema rejects any of them.
 */
export interface CobroClienteCreate {
  cliente_id: string
  monto: string
  fecha: string
  metodo: MetodoCobro
  comprobante_url?: string | null
}

// ── Estadísticas (C-38, consuming C-37) ──────────────────────────────────────

/**
 * Period bucket size for /api/estadisticas (backend: app/models/enums.py
 * Granularidad).
 *
 * Never a column — it exists only in query params and responses. `semana`
 * always starts on Monday (ISO, what `date_trunc('week', ...)` already does
 * in Postgres).
 * Derived from `Granularidad` (C-41).
 */
export type Granularidad = DecimalAsNumber<components['schemas']['Granularidad'], never>

/**
 * One bucket of the compras series (backend: app/schemas/estadisticas.py
 * PeriodoTotal). `periodo` equals `desde` — the bucket start.
 *
 * DECIMALS: `total` is a `number` here, but it travels the wire as a
 * Pydantic-v2 Decimal STRING. `parseEstadisticas` converts it at the
 * boundary (mirrors `parseCuentaCorriente`, C-13 D13) so no component ever
 * sees a string-encoded decimal.
 *
 * A period with no movement arrives with `total: 0` — the backend zero-fills
 * the series on purpose (C-37 D2) so a chart never draws a straight line
 * between two non-consecutive dates and invents a trend. The frontend must
 * NOT filter those zeros out.
 */
export interface PeriodoTotal {
  periodo: string
  desde: string
  hasta: string
  total: number
}

/**
 * Purchase totals by period (backend: ComprasResponse), optionally scoped to
 * one supplier. A `proveedor_id` belonging to another negocio answers 404,
 * never 403 (negocio_id isolation).
 */
export interface ComprasResponse {
  desde: string
  hasta: string
  granularidad: Granularidad
  proveedor_id?: string | null
  periodos: PeriodoTotal[]
}

/**
 * One bucket of the ventas series with its payment-method breakdown
 * (backend: VentaPeriodo).
 *
 * `desglose` always carries EVERY `FormaPago`, defaulting to `0` — same
 * reasoning as the zero-filled periods. And `sum(desglose) === total` holds
 * by construction: the backend computes both from the same grouped rows, so
 * the frontend must display them, never add them up to derive the total.
 *
 * `cobro_cliente` is NEVER part of this (C-37 D3): a fiado was already
 * counted as a sale the day the goods left.
 */
export interface VentaPeriodo {
  periodo: string
  desde: string
  hasta: string
  total: number
  desglose: Record<FormaPago, number>
}

/** Sales totals by period, broken down by payment method (backend: VentasResponse). */
export interface VentasResponse {
  desde: string
  hasta: string
  granularidad: Granularidad
  periodos: VentaPeriodo[]
}

/**
 * Purchases vs. sales for one range (backend: ResumenResponse).
 *
 * `diferencia = ventas - compras`. It is NOT a margin and must never be
 * labelled as one (C-37 D6): the system does not know what the goods it sold
 * cost, so calling this "margen" or "rentabilidad" would be a made-up number
 * wearing an accounting label.
 */
export interface ResumenResponse {
  desde: string
  hasta: string
  compras: number
  ventas: number
  diferencia: number
}

/**
 * Structured `detail` of the 422 the backend returns when a range would
 * produce more periods than its cap (backend: `_error_tope_excedido`).
 *
 * This 422 is an INSTRUCTION, not a failure: it tells the caller exactly how
 * many periods the request would have produced and how to shrink it, rather
 * than silently returning a truncated series. The UI must present it as an
 * actionable correction.
 *
 * The inverted-range 422 sends a plain STRING detail instead — that shape
 * difference is how the two are told apart, rather than by matching Spanish
 * prose that breaks the day someone fixes an accent.
 */
export interface TopeExcedidoDetail {
  mensaje: string
  periodos_estimados: number
  tope: number
  sugerencia: string
}
