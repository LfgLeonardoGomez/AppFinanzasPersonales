/**
 * OpenAPI-derived types for the facturas-proveedores backend (C-03).
 *
 * Generated manually from the C-03 auth-backend contract (backend not running at apply time).
 * Run `npm run generate-types` when the backend is available to regenerate from the live schema.
 *
 * NOTE (D-C04-5): The `remember_me` flag in POST /auth/login is included per the design
 * contract. If C-03 does not expose it in the OpenAPI schema, this field is a forward-
 * declaration that must be reconciled when `generate-types` is run against the live backend.
 */

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
 */
export interface RegistroEmpleadoBody {
  email: string
  nombre: string
  password: string
  codigo: string
}

export interface LoginBody {
  email: string
  password: string
  /** Delegates session duration to the backend (D-C04-5). */
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
 */
export type Categoria = 'INSUMO' | 'SERVICIO' | 'OTRO'

/**
 * Full supplier object returned by GET /api/proveedores/{id}.
 * saldo is computed on-demand by the backend (RN-SALDO). NEVER computed on frontend.
 */
export interface Proveedor {
  id: string
  nombre: string
  cuit: string | null
  telefono: string | null
  categoria: Categoria
  notas: string | null
  saldo: number
  created_at: string
  updated_at: string
}

/**
 * Item in the paginated list (GET /api/proveedores).
 * Same shape as Proveedor — saldo is the aggregate computed by the backend.
 */
export interface ProveedorListItem extends Proveedor {}

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
 */
export interface ProveedorDeleteResponse {
  tiene_dependencias: boolean
  id: string
}

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
 */
export type TemaPreferido = 'CLARO' | 'OSCURO'

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
export interface AvatarUpdate {
  avatar_url: string
}

/**
 * Upload kind for the signed-preset endpoint (D5).
 * C-05 supports 'avatar'; C-08 added 'factura' (Factura.archivo_url);
 * C-10 added 'comprobante' (Pago.comprobante_url).
 */
export type TipoUpload = 'avatar' | 'factura' | 'comprobante'

/**
 * Signed Cloudinary upload preset returned by GET /api/cloudinary/preset-firmado.
 * Public parameters only — the API secret is NEVER part of this response.
 */
export interface PresetFirmadoResponse {
  signature: string
  timestamp: number
  api_key: string
  cloud_name: string
  folder: string
  allowed_formats: string[]
  max_file_size: number
}

// ---------------------------------------------------------------------------
// Facturas domain types (C-08 backend, C-09 frontend)
// ---------------------------------------------------------------------------

/**
 * Computed invoice status. Derived server-side via FIFO (RN-FAC-09).
 * The frontend NEVER recomputes this value — it always reads it from the response.
 */
export type EstadoFactura = 'PENDIENTE' | 'PARCIAL' | 'PAGADA'

/**
 * Origin of a document (Factura or Pago). Stamped server-side; the client
 * never sends this — PagoCreate/FacturaCreate have no `origen` field.
 * MANUAL is set by the C-09/C-11 manual UI; IA is set by the C-14/C-15
 * vision-extraction flow.
 */
export type OrigenDocumento = 'MANUAL' | 'IA'

/**
 * A single line item on an invoice (as returned by the API).
 * cantidad and precio_unitario are JSON numbers — formatted by the UI.
 */
export interface FacturaItem {
  id: string
  factura_id: string
  descripcion: string
  cantidad: number
  precio_unitario: number
}

/**
 * Payload for creating/updating a line item.
 * descripcion must be non-empty; cantidad > 0; precio_unitario >= 0.
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
 */
export interface FacturaResponse {
  id: string
  negocio_id: string
  proveedor_id: string
  numero: string | null
  fecha_emision: string
  fecha_vencimiento: string | null
  monto_total: number
  archivo_url: string | null
  origen: OrigenDocumento
  estado: EstadoFactura
  items: FacturaItem[]
  items_sum_mismatch: boolean
  created_at: string
  updated_at: string
  /**
   * c-26 (D1): the related supplier's name, populated by the backend
   * for POST/GET/PATCH responses — mirrors PagoResponse.proveedor_nombre
   * (C-18, FE-005). `null` when the supplier was soft-deleted (the
   * factura remains valid; the supplier's absence is informational).
   * The list endpoint does NOT carry this field on FacturaListItem.
   */
  proveedor_nombre?: string | null
}

/**
 * Item in the paginated invoice list (GET /api/facturas).
 * Carries computed estado; items array is NOT included in list items.
 */
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
 */
export interface FacturaListItem {
  id: string
  proveedor_id: string
  numero: string | null
  fecha_emision: string
  monto_total: number
  estado: EstadoFactura
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
 */
export type MetodoPago =
  | 'EFECTIVO'
  | 'TRANSFERENCIA'
  | 'TARJETA'
  | 'MERCADOPAGO'
  | 'OTRO'

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
export interface FacturaConEstado {
  id: string
  negocio_id: string
  proveedor_id: string
  numero: string | null
  fecha_emision: string
  fecha_vencimiento: string | null
  monto_total: number
  archivo_url: string | null
  origen: OrigenDocumento
  estado: EstadoFactura
  created_at: string
  updated_at: string
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

export interface ValidationError {
  loc: (string | number)[]
  msg: string
  type: string
}

export interface HTTPValidationError {
  detail: ValidationError[]
}

export interface HTTPError {
  detail: string
}

// ---------------------------------------------------------------------------
// Equipo (C-29)
// ---------------------------------------------------------------------------

/** A team member as the admin sees them in the list. */
export interface MiembroResponse {
  id: string
  nombre: string
  email: string
  es_admin: boolean
  desactivado: boolean
  created_at: string
}

/**
 * A freshly issued invitation.
 *
 * `codigo` appears here and nowhere else in the API: only its hash is stored,
 * so this response is the single chance to read it (D-31). The UI has to make
 * that obvious to the admin.
 */
export interface InvitacionResponse {
  id: string
  codigo: string
  expira_en: string
}
