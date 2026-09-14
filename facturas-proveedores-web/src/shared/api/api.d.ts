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
 * written and grouped under the "Hand-written types — no backend schema
 * counterpart" heading at the end of this file (design.md D5) — not mixed
 * in with the derived ones above it.
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

/**
 * Derived from `UsuarioResponse` (C-41, D6 alias — same shape, renamed on
 * the backend). `telefono`, `avatar_url` and `nombre_negocio` are widened
 * back to REQUIRED (`string | null`, not `?: string | null`) — same
 * FastAPI-always-serializes-the-key rationale as `Proveedor.cuit`:
 * `Optional[str] = None` only means "optional at the Pydantic constructor",
 * the key is always on the wire. `updated_at` is widened to REQUIRED too —
 * unlike the three fields above, the schema itself declares it non-optional
 * (`datetime`, no default); the pre-C-41 hand-written type marked it
 * optional with no schema reason to.
 *
 * `tema_preferido` WAS a genuine backend inconsistency — the schema used to
 * type it as a bare `Optional[str]` while the underlying column
 * (`app/models/usuario.py::Usuario.tema_preferido`) is the `TemaPreferido`
 * enum, NOT NULL, `default=TemaPreferido.CLARO` — fixed backend-side
 * (`UsuarioResponse.tema_preferido: TemaPreferido = TemaPreferido.CLARO`).
 * The generated schema now derives the enum directly, non-nullable and
 * required, so it needs no hand override here any more — plain derivation,
 * same as every other field that isn't a Decimal or a wire vs. domain
 * mismatch.
 */
export type Usuario = Omit<
  DecimalAsNumber<components['schemas']['UsuarioResponse'], never>,
  'telefono' | 'avatar_url' | 'nombre_negocio' | 'updated_at'
> & {
  telefono: string | null
  avatar_url: string | null
  nombre_negocio: string | null
  updated_at: string
}

// ---------------------------------------------------------------------------
// Auth request / response bodies
// ---------------------------------------------------------------------------

/**
 * Payload for POST /api/auth/registro.
 * Derived from `RegistroRequest` (C-41, D6 alias — same shape, renamed on
 * the backend). `nombre_negocio` optional (C-28): omitted, the backend
 * derives it from the user's name.
 */
export type RegistroBody = DecimalAsNumber<components['schemas']['RegistroRequest'], never>

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
 *
 * Derived from `PagoResponse` (C-41). `comprobante_url` is widened back to
 * REQUIRED (`string | null`, not `?: string | null`) — same
 * FastAPI-always-serializes-the-key rationale as `Proveedor.cuit`: the
 * schema marks it "not required" because that is what `Optional[str] =
 * None` means at the Pydantic constructor, but the key is always on the
 * wire. `parsePago` (`pagosApi.ts`) is the boundary that makes this true.
 */
export type PagoResponse = Omit<
  DecimalAsNumber<components['schemas']['PagoResponse'], 'monto'>,
  'comprobante_url'
> & {
  comprobante_url: string | null
}

/**
 * Item in the paginated payment list (GET /api/pagos).
 * Lean row — drops comprobante_url and updated_at to keep the payload small.
 * Mirrors FacturaListItem (C-08). NO factura_id (RN-PAG-01).
 *
 * Derived from `PagoListItem` (C-41).
 */
export type PagoListItem = DecimalAsNumber<components['schemas']['PagoListItem'], 'monto'>

/**
 * Alias for the full Pago (returned on create/update — same as PagoResponse).
 */
export interface Pago extends PagoResponse {}

/**
 * Paginated response wrapper for GET /api/pagos.
 * Mirrors PaginatedFacturas (note: no `total_pages` — backend C-10 returns
 * `{items, total, page, page_size}`; the client computes total_pages if needed).
 *
 * Derived from `PagoListResponse` (C-41). `items` is overridden to the
 * derived public `PagoListItem[]` — `DecimalAsNumber` only converts
 * top-level keys, so the nested wire items (string `monto`) would
 * otherwise leak through untouched.
 */
export type PagoListResponse = Omit<
  DecimalAsNumber<components['schemas']['PagoListResponse'], never>,
  'items'
> & {
  items: PagoListItem[]
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

// ---------------------------------------------------------------------------
// IA vision domain types (C-14 backend, C-15 frontend)
// ---------------------------------------------------------------------------

/**
 * Output of POST /api/facturas/extraer-ia (C-14, ia-vision-backend spec).
 *
 * Every field except `error` is nullable — the vision extractor marks
 * unreadable fields as `null` and the frontend MUST render empty inputs
 * (RN-IA-03: never invent, guess, or compute a value).
 *
 * Derived from `PropuestaFactura` (C-41 — same schema name, no D6 alias
 * needed). `proveedor_nombre`, `numero`, `fecha_emision` and
 * `error_message` are widened back to REQUIRED (`string | null`, not
 * `?: string | null`) — same FastAPI-always-serializes-the-key rationale as
 * `Proveedor.cuit`. `monto_total` is overridden directly to `number | null`
 * rather than routed through `DecimalAsNumber`: the helper's
 * `[P in K]: number` mapping forces a non-nullable `number`, but this field
 * genuinely can be `null` (an unreadable field, RN-IA-03) — so the
 * conversion is spelled out by hand here, the same way nested arrays like
 * `FacturaResponse.items` are overridden rather than run through the
 * helper. `parsePropuestaFactura` (`iaVisionApi.ts`) is the boundary that
 * makes all of this true — pre-existing, unchanged by this derivation
 * (D13, mirrors C-13's `parseCuentaCorriente`).
 *
 * INVARIANTS (locked at the type level by `api.iaVision.test-d.ts`):
 *   - NO `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`,
 *     `updated_at`, no `factura_id` — the C-14 spec is explicit that
 *     vision proposals are header-only and identity-less. The `origen=IA`
 *     flag is stamped by the existing `POST /api/facturas` on confirm
 *     (c-15a, OQ-1 Path B).
 *   - `error: boolean` is required (always present) and `error_message`
 *     is `string | null`. The C-14 contract guarantees these two are
 *     always on the response.
 */
export type PropuestaFactura = Omit<
  DecimalAsNumber<components['schemas']['PropuestaFactura'], never>,
  'proveedor_nombre' | 'numero' | 'fecha_emision' | 'monto_total' | 'error_message'
> & {
  proveedor_nombre: string | null
  numero: string | null
  fecha_emision: string | null
  monto_total: number | null
  error_message: string | null
}

/**
 * Output of POST /api/pagos/extraer-ia (C-14, ia-vision-backend spec).
 *
 * Same nullable contract as `PropuestaFactura`. The C-14 Pydantic
 * normalizes invalid enum values to `None`; the TS type mirrors this
 * with `MetodoPago | null`.
 *
 * Derived from `PropuestaPago` (C-41 — same schema name, no D6 alias
 * needed). Same widening rationale as `PropuestaFactura`, applied to
 * `proveedor_nombre`, `fecha`, `metodo` and `error_message`; `monto`
 * overridden the same way `PropuestaFactura.monto_total` is (nullable
 * decimal, hand-converted rather than routed through `DecimalAsNumber`).
 * `parsePropuestaPago` (`iaVisionApi.ts`) is the boundary that makes all of
 * this true — pre-existing, unchanged by this derivation.
 *
 * INVARIANTS (locked at the type level by `api.iaVision.test-d.ts`):
 *   - NO `factura_id` (RN-PAG-01 surface defense in depth).
 *   - NO `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`,
 *     `updated_at`.
 *   - The `metodo` field is `MetodoPago | null` — never a raw string.
 */
export type PropuestaPago = Omit<
  DecimalAsNumber<components['schemas']['PropuestaPago'], never>,
  'proveedor_nombre' | 'monto' | 'fecha' | 'metodo' | 'error_message'
> & {
  proveedor_nombre: string | null
  monto: number | null
  fecha: string | null
  metodo: MetodoPago | null
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
 * the underlying row has no file attached — genuinely optional (rows
 * created before the field existed omit it entirely), left as `?:` rather
 * than widened to required like the other fields in this file.
 *
 * Derived from `EntradaHistorial` (C-41 — this regeneration is the clean
 * one the previous hand-edit note asked for; the shape it produced for
 * `archivo_url` is identical to what was hand-added). `monto`/
 * `saldo_acumulado` converted string→number via `DecimalAsNumber`;
 * `parseEntradaHistorial` (`cuentaCorrienteApi.ts`) is the boundary that
 * already did this parsing (predates C-41) — this is type derivation only.
 */
export type EntradaHistorial = DecimalAsNumber<
  components['schemas']['EntradaHistorial'],
  'monto' | 'saldo_acumulado'
>

/**
 * Response shape of `GET /api/proveedores/{id}/cuenta-corriente` (C-12).
 * The endpoint has no request body and no query parameters. The frontend
 * consumes the triple verbatim — `saldo`, the FIFO `estado` of each
 * `facturas_con_estado` row, and the `saldo_acumulado` of each `historial`
 * row are NEVER recomputed on the client (RN-SALDO, RN-FIFO, RN-HIST).
 *
 * Derived from `CuentaCorrienteResponse` (C-41). `facturas_con_estado` and
 * `historial` are overridden to the derived public `FacturaConEstado[]` /
 * `EntradaHistorial[]` — `DecimalAsNumber` only converts top-level keys, so
 * the nested wire rows (string `monto_total`/`monto`/`saldo_acumulado`)
 * would otherwise leak through untouched. `parseCuentaCorriente`
 * (`cuentaCorrienteApi.ts`) is the boundary that already parses the whole
 * triple (predates C-41) — this change only derives the type.
 */
export type CuentaCorrienteResponse = Omit<
  DecimalAsNumber<components['schemas']['CuentaCorrienteResponse'], 'saldo'>,
  'facturas_con_estado' | 'historial'
> & {
  facturas_con_estado: FacturaConEstado[]
  historial: EntradaHistorial[]
}

// ---------------------------------------------------------------------------
// Error bodies (from FastAPI / Pydantic)
// ---------------------------------------------------------------------------

/** Derived from `ValidationError` (C-41). */
export type ValidationError = DecimalAsNumber<components['schemas']['ValidationError'], never>

/**
 * Derived from `HTTPValidationError` (C-41). `detail` widened back to
 * REQUIRED (`ValidationError[]`, not `?: ValidationError[]`) — same
 * FastAPI-always-serializes-the-key rationale as `Proveedor.cuit`: the
 * schema marks it "not required" because that is what a Pydantic default
 * means at the constructor, but FastAPI's built-in validation-exception
 * handler always puts the key on the wire, empty array or not. Task 7.5
 * flagged this as a hand-typed response that never got migrated when the
 * rest of this file moved to derivation; C-41 closes it here rather than
 * parking it in the hand-written section below — there is nothing
 * hand-invented about it, it was just never revisited.
 */
export type HTTPValidationError = Omit<
  DecimalAsNumber<components['schemas']['HTTPValidationError'], never>,
  'detail'
> & {
  detail: ValidationError[]
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
/**
 * A customer as the app sees them (backend: app/schemas/cliente.py).
 *
 * `nombre_normalizado` is returned for information — it MAY be displayed or
 * compared, but MUST NEVER be sent in a request payload (design.md D8):
 * identity is decided exclusively by the backend (`app/core/normalizacion.py`).
 *
 * Derived from `ClienteResponse` (C-41, D6 alias — same shape, renamed on
 * the backend). `telefono` and `notas` are widened back to REQUIRED
 * (`string | null`, not `?: string | null`) — same
 * FastAPI-always-serializes-the-key rationale as `Proveedor.cuit`:
 * `Optional[str] = None` only means "optional at the Pydantic constructor",
 * the key is always on the wire. `saldo` is widened the same way.
 *
 * `saldo` stays `string`, NOT converted to `number` via `DecimalAsNumber` —
 * unlike `Proveedor.saldo`, this backend serializes the `Decimal` field as a
 * JSON string (confirmed on the same Decimal-typed field via
 * `test_c35_cuenta_corriente_cliente_integration.py`: `data["saldo"] ==
 * "0.00"`), the same convention already used for `Venta.monto`. On-demand
 * (backend: `ClienteResponse.saldo: Optional[Decimal] = None`, app/schemas/
 * cliente.py): populated ONLY by the plain listing endpoint (GET
 * /api/clientes with no `buscar` filter) — `null` (not absent) on
 * create/get/update/search, which don't pay the extra aggregate query.
 */
export type Cliente = Omit<
  DecimalAsNumber<components['schemas']['ClienteResponse'], never>,
  'telefono' | 'notas' | 'saldo'
> & {
  telefono: string | null
  notas: string | null
  saldo: string | null
}

/**
 * Payload for POST /api/clientes (create).
 *
 * Only `nombre` — this change's `ClienteAutocomplete` creates a customer from
 * the name alone (RN-CLI-01, design.md D7). `negocio_id` comes from the
 * session; `nombre_normalizado` is derived server-side, never accepted.
 */
export type ClienteCreate = DecimalAsNumber<components['schemas']['ClienteCreate'], never>

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
 * NO `estado`, NO `saldo` — there is nothing to compute per sale; RN-VTA-05
 * totals are aggregated on demand from the list, never persisted (D-01).
 *
 * Derived from `VentaResponse` (C-41). `monto` is converted string→number
 * via `DecimalAsNumber` at the `ventasApi.ts` boundary (D3) — like every
 * other Decimal in this API, NOT special-cased for ventas anymore (an
 * earlier version of this type declared `monto: string`, deferring the
 * parse to the aggregation boundary in `totales.ts`; C-41 measured that as
 * drift against its own rule and closed it — see `totales.ts` for what
 * changed there). `cliente_id` is widened back to required (`string | null`,
 * not `?: string | null`) — same FastAPI-always-serializes-the-key
 * rationale as `Proveedor.cuit`: `Optional[...] = None` only means
 * "optional at the constructor", but the key is always on the wire.
 * `parseVenta` (`ventasApi.ts`) is the boundary that makes this true.
 */
export type Venta = Omit<
  DecimalAsNumber<components['schemas']['VentaResponse'], 'monto'>,
  'cliente_id'
> & {
  cliente_id: string | null
}

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

// ---------------------------------------------------------------------------
// Cuenta-corriente de clientes + cobros domain types (C-35 backend, C-36
// frontend, design.md D9)
//
// Derived from `npm run generate-types` output (C-41), matching every other
// derived block in this file — `CobroClienteCreate` is the one exception,
// staying hand-written for the same D5-adjacent reason `VentaCreate`/
// `FacturaItemCreate` do (a write payload whose wire union is narrowed to
// the human-typed `string`, not derived).
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
 *
 * Derived from `VentaConEstado` (C-41 — same schema name, no D6 alias
 * needed). `monto` converted string→number via `DecimalAsNumber`, already
 * parsed by `parseVentaConEstado` (`cuentaCorrienteClienteApi.ts`, predates
 * C-41) — this is a type-derivation-only change, mirroring `FacturaConEstado`
 * (task group 4). `cliente_id` is widened back to required AND non-null
 * (`string`, not `string | null`) — a fiado always has a customer by
 * definition (RN-VTA-03), unlike the general `Venta.cliente_id`.
 */
export type VentaConEstado = Omit<
  DecimalAsNumber<components['schemas']['VentaConEstado'], 'monto'>,
  'cliente_id'
> & {
  cliente_id: string
}

/**
 * Single row in the customer's `historial` array. The C-35 service orders
 * chronologically and computes `saldo_acumulado` as a running sum in the
 * same walk — the frontend renders the array verbatim, never re-sorted
 * (RN-HIST, mirrors `EntradaHistorial`).
 *
 * Derived from `EntradaHistorialCliente` (C-41). `monto`/`saldo_acumulado`
 * converted string→number via `DecimalAsNumber`; `parseEntradaHistorialCliente`
 * (`cuentaCorrienteClienteApi.ts`) is the boundary that already did this
 * parsing (predates C-41) — type derivation only.
 */
export type EntradaHistorialCliente = DecimalAsNumber<
  components['schemas']['EntradaHistorialCliente'],
  'monto' | 'saldo_acumulado'
>

/**
 * Response shape of `GET /api/clientes/{id}/cuenta-corriente` (C-35). The
 * frontend consumes the triple verbatim — `saldo`, each fiado's `estado`,
 * and each history row's `saldo_acumulado` are NEVER recomputed on the
 * client (RN-SALDO, RN-FIFO, RN-HIST, design.md D1).
 *
 * Derived from `CuentaCorrienteClienteResponse` (C-41). `ventas_con_estado`
 * and `historial` are overridden to the derived public `VentaConEstado[]` /
 * `EntradaHistorialCliente[]` — same nested-array reason as
 * `CuentaCorrienteResponse`. `parseCuentaCorrienteCliente`
 * (`cuentaCorrienteClienteApi.ts`) is the boundary that already parses the
 * whole triple (predates C-41) — this change only derives the type.
 */
export type CuentaCorrienteClienteResponse = Omit<
  DecimalAsNumber<components['schemas']['CuentaCorrienteClienteResponse'], 'saldo'>,
  'ventas_con_estado' | 'historial'
> & {
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
 * A period with no movement arrives with `total: 0` — the backend zero-fills
 * the series on purpose (C-37 D2) so a chart never draws a straight line
 * between two non-consecutive dates and invents a trend. The frontend must
 * NOT filter those zeros out.
 *
 * Derived from `PeriodoTotal` (C-41). `total` converted string→number via
 * `DecimalAsNumber`; `parsePeriodoTotal` (`estadisticasParse.ts`) is the
 * boundary that already did this parsing (predates this derivation, C-38,
 * mirrors `parseCuentaCorriente`, C-13 D13) — type derivation only.
 */
export type PeriodoTotal = DecimalAsNumber<components['schemas']['PeriodoTotal'], 'total'>

/**
 * Purchase totals by period (backend: ComprasResponse), optionally scoped to
 * one supplier. A `proveedor_id` belonging to another negocio answers 404,
 * never 403 (negocio_id isolation).
 *
 * Derived from `ComprasResponse` (C-41). `periodos` overridden to the
 * derived public `PeriodoTotal[]` — `DecimalAsNumber` only converts
 * top-level keys, so the nested wire rows (string `total`) would otherwise
 * leak through untouched.
 */
export type ComprasResponse = Omit<
  DecimalAsNumber<components['schemas']['ComprasResponse'], never>,
  'periodos'
> & {
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
 *
 * Derived from `VentaPeriodo` (C-41). `total` converted via
 * `DecimalAsNumber`; `desglose` is overridden by hand to `Record<FormaPago,
 * number>` — the OpenAPI-generated wire shape is a generic
 * `{ [key: string]: string }` (openapi-typescript cannot express "keyed by
 * every `FormaPago` member" from a Pydantic `dict[FormaPago, Decimal]`), and
 * `DecimalAsNumber` only converts named top-level keys, not a dict's value
 * type. `parseVentaPeriodo` (`estadisticasParse.ts`) is the boundary that
 * already builds this shape (predates this derivation, C-38) — type
 * derivation only.
 */
export type VentaPeriodo = Omit<
  DecimalAsNumber<components['schemas']['VentaPeriodo'], 'total'>,
  'desglose'
> & {
  desglose: Record<FormaPago, number>
}

/**
 * Sales totals by period, broken down by payment method (backend:
 * VentasResponse).
 *
 * Derived from `VentasResponse` (C-41). `periodos` overridden to the
 * derived public `VentaPeriodo[]`, same nested-array reason as
 * `ComprasResponse.periodos`.
 */
export type VentasResponse = Omit<
  DecimalAsNumber<components['schemas']['VentasResponse'], never>,
  'periodos'
> & {
  periodos: VentaPeriodo[]
}

/**
 * Purchases vs. sales for one range (backend: ResumenResponse).
 *
 * `diferencia = ventas - compras`. It is NOT a margin and must never be
 * labelled as one (C-37 D6): the system does not know what the goods it sold
 * cost, so calling this "margen" or "rentabilidad" would be a made-up number
 * wearing an accounting label.
 *
 * Derived from `ResumenResponse` (C-41). `compras`/`ventas`/`diferencia`
 * converted string→number via `DecimalAsNumber`; `parseResumen`
 * (`estadisticasParse.ts`) is the boundary that already did this parsing
 * (predates this derivation, C-38) — type derivation only.
 */
export type ResumenResponse = DecimalAsNumber<
  components['schemas']['ResumenResponse'],
  'compras' | 'ventas' | 'diferencia'
>

// ---------------------------------------------------------------------------
// Actividad reciente (C-44, D3)
// ---------------------------------------------------------------------------

/**
 * One row of the merged recent-activity feed (facturas + pagos), sorted by
 * the backend service layer (`fecha DESC, created_at DESC`).
 *
 * Derived from `ActividadRecienteItem` (C-44). `monto` converted
 * string→number via `DecimalAsNumber` — the wire serializes it as a
 * Pydantic-v2 Decimal string, same convention as every other money field in
 * this file. `proveedor_nombre` is widened back to REQUIRED (`string |
 * null`, not `?: string | null`) — same pattern as
 * `ProveedorListItem.ultima_factura_fecha`: the schema marks it "not
 * required" because a deactivated supplier leaves the backend's LEFT JOIN
 * with a NULL name, but FastAPI still serializes the key on every response.
 * `actividadRecienteApi.ts` (`features/proveedores/api/`) is the boundary
 * that makes this true and converts `monto`, never degrading a malformed
 * value to `0` (D-88, D-94).
 */
export type ActividadRecienteItem = Omit<
  DecimalAsNumber<components['schemas']['ActividadRecienteItem'], 'monto'>,
  'proveedor_nombre'
> & {
  proveedor_nombre: string | null
}

// ---------------------------------------------------------------------------
// Hand-written types — no backend schema counterpart (design.md D5)
// ---------------------------------------------------------------------------
//
// Everything below has no `components['schemas'][...]` entry to derive
// from — measured directly against `api.generated.d.ts`, not assumed. Each
// one is a construction of THIS frontend: a query-filter shape built for a
// client hook, a pagination envelope this client wraps around a list
// response, a delete-mutation input that bundles extra ids for cache
// invalidation, or a locally-assembled error/conflict shape the backend
// raises as a raw dict rather than a Pydantic response model. None of them
// is "should have been derived and wasn't" — each has a stated reason it
// stays hand-written, right where it's declared below.
//
// This is D5 made concrete: a type in this file is either derived from a
// schema above, or it lives down here with a reason. There is no third
// place — task 8.1.

// ── Proveedores ──────────────────────────────────────────────────────────

/**
 * Paginated response wrapper for GET /api/proveedores. No backend schema:
 * the pagination envelope (`items`/`total`/`page`/`page_size`/
 * `total_pages`) is assembled by the router, not declared as a Pydantic
 * response model.
 */
export interface PaginatedProveedores {
  items: ProveedorListItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

// ── Facturas ──────────────────────────────────────────────────────────────

/**
 * Paginated response wrapper for GET /api/facturas. Same reason as
 * `PaginatedProveedores` — no backend schema for the envelope itself.
 */
export interface PaginatedFacturas {
  items: FacturaListItem[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

/**
 * Query params for GET /api/facturas. A FastAPI query-param signature, not
 * a schema — `openapi-typescript` exposes query params under `paths`, not
 * `components['schemas']`, and this file only derives from the latter.
 * estado filter is resolved server-side after FIFO (RN-FAC-09) — frontend
 * just passes the value.
 */
export interface FacturasFilters {
  proveedor_id?: string
  estado?: EstadoFactura
  fecha_desde?: string
  fecha_hasta?: string
  page?: number
}

/**
 * Delete input for the `useDeleteFactura` mutation. Carries the supplier
 * id alongside the factura id so the cross-feature cache invalidation
 * (D6) can target the right `cuenta-corriente.detail(proveedorId)` key
 * without an extra `GET /api/facturas/{id}` round-trip — this pairing
 * exists only on the frontend, no backend endpoint takes both together.
 *
 * INVARIANT (RN-PAG-01, hard rule #1): no `factura_id` key. The compile-
 * time guard in `api.cuentaCorriente.test-d.ts` locks this.
 */
export interface FacturaDeleteInput {
  id: string
  proveedor_id: string
}

/**
 * Client-side filter state for the cuenta-corriente facturas table. No
 * backend query params at all — the endpoint takes none (D3, D8) and this
 * shape only ever filters the response payload in memory (`f.estado` and
 * `f.fecha_emision`). Defense in depth for RN-FAC-09: the frontend never
 * re-issues the request with a `estado` filter at the SQL level.
 */
export interface FiltrosFacturas {
  estado?: EstadoFactura
  fecha_desde?: string
  fecha_hasta?: string
}

// ── Pagos ─────────────────────────────────────────────────────────────────

/**
 * Query params for GET /api/pagos. Same query-param-vs-schema reason as
 * `FacturasFilters`. Pagos have no `estado` (RN-PAG-01: no per-invoice
 * link → no per-invoice estado to filter on). Only supplier and pagination
 * are supported.
 */
export interface PagosFilters {
  proveedor_id?: string
  page?: number
}

/**
 * Delete input for the `useDeletePago` mutation. Same shape and rationale
 * as `FacturaDeleteInput`. NO `factura_id` key (RN-PAG-01).
 */
export interface PagoDeleteInput {
  id: string
  proveedor_id: string
}

// ── Error bodies ──────────────────────────────────────────────────────────

/**
 * Plain-string error body most non-validation FastAPI `HTTPException`s
 * raise (`raise HTTPException(status_code=..., detail="...")`). No
 * Pydantic model backs it — it is a bare dict, so there is nothing under
 * `components['schemas']` to derive from. `HTTPValidationError` (Error
 * bodies section above), by contrast, IS a real response model and is
 * derived there.
 */
export interface HTTPError {
  detail: string
}

// ── Clientes ──────────────────────────────────────────────────────────────

/**
 * Item in the customer list/search results — same shape as Cliente; both
 * `GET /api/clientes` and `GET /api/clientes/buscar` return
 * `ClienteResponse[]` (no separate list schema on the backend, confirmed
 * against `api.generated.d.ts` — there is no `ClienteListItem` schema to
 * derive), mirroring `VentaListItem extends Venta {}` below.
 */
export interface ClienteListItem extends Cliente {}

/**
 * Shape of the `detail` object on a `409` from POST /api/clientes
 * (backend: `app/services/cliente_service.py::_conflicto`) — raised as a
 * raw dict, not a Pydantic response model, so there is nothing to derive.
 *
 * `cliente_existente` is present whenever the conflicting customer could be
 * identified — the frontend offers it instead of surfacing an error
 * (design.md D8, RN-CLI-03).
 */
export interface ClienteConflictDetail {
  mensaje: string
  cliente_existente?: { id: string; nombre: string }
}

// ── Ventas ────────────────────────────────────────────────────────────────

/**
 * Item in the sales list (GET /api/ventas) — same shape as Venta; the
 * backend has no separate list schema (confirmed against
 * `api.generated.d.ts`).
 */
export interface VentaListItem extends Venta {}

/**
 * Query params for GET /api/ventas. Only non-empty filters are sent
 * (design.md D9) — a filtered day is a shareable, reloadable URL. Query
 * params, not a schema — same reason as `FacturasFilters`.
 */
export interface VentasFilters {
  desde?: string
  hasta?: string
  forma_pago?: FormaPago
  cliente_id?: string
}

/**
 * Delete input for the `useDeleteVenta` mutation. Carries `cliente_id` and
 * `forma_pago` alongside the `id`, following the `PagoDeleteInput`
 * precedent from C-13: the delete mutation needs to know which customer's
 * cached account to invalidate, and whether the sale was on account at
 * all, without an extra `GET` (design.md D4) — this pairing exists only on
 * the frontend.
 */
export interface VentaDeleteInput {
  id: string
  cliente_id: string | null
  forma_pago: FormaPago
}

// ── Estadísticas ──────────────────────────────────────────────────────────

/**
 * Structured `detail` of the 422 the backend returns when a range would
 * produce more periods than its cap (backend: `_error_tope_excedido`) —
 * raised as a raw dict on the `HTTPException`, not a Pydantic response
 * model, so there is nothing under `components['schemas']` to derive.
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
