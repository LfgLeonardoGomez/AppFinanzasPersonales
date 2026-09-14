/**
 * Compile-time contract guard for `src/shared/api/api.d.ts` (C-41).
 *
 * This is the "general guard" D8 describes: for every public type derived
 * from the backend's OpenAPI schema, assert it still corresponds to that
 * schema — with the caveat that named money fields are `number` on the
 * public side and `string` on the wire (`DecimalAsNumber<T, K>`, D2). Once
 * this file covers everything `api.estadisticas.test-d.ts` covers, that
 * file is retired (D8, task 8.2/8.3) — not before.
 *
 * Like `api.types.test-d.ts` and `api.estadisticas.test-d.ts`, this is a
 * `.test-d.ts` file: NOT executed at runtime (outside Vitest's `*.test.ts`
 * glob), fired only by `tsc --noEmit`. The presence of this file in source
 * IS the test.
 *
 * Covered so far (task group 2 — the 22 types the C-41 design.md measurement
 * found identical to their backend schema, zero drift, zero decimal
 * conversion needed):
 *   - 16 matched by the SAME export name: AvatarUpdate, ClienteCreate,
 *     EstadoFactura, EstadoVentaFiada, FormaPago, Granularidad,
 *     InvitacionResponse, MetodoCobro, MetodoPago, MiembroResponse,
 *     OrigenDocumento, PresetFirmadoResponse, ProveedorDeleteResponse,
 *     TemaPreferido, TipoUpload, ValidationError.
 *   - 6 matched under a RENAMED schema (D6 aliases, applied here because
 *     they need no drift resolution beyond the rename): CobroCliente
 *     (→ CobroClienteResponse), Categoria (→ CategoriaProveedor), LoginBody
 *     (→ LoginRequest), RecuperarBody (→ RecuperarRequest), ResetBody
 *     (→ ResetRequest), RegistroEmpleadoBody (→ RegistroEmpleadoRequest).
 *   16 + 6 = 22, matching the design.md count exactly. The remaining 9 of
 *   D6's 15 aliases (Proveedor, Factura, Cliente, Pago, Venta, Usuario,
 *   FacturaItem, RegistroBody, MeResponse) DO have drift beyond the name and
 *   are task group 7's job, not this one.
 *
 * Also covered (task group 3 — the proveedores client, the first one with
 * REAL drift and REAL money conversion):
 *   - `Proveedor` (~ ProveedorResponse, D6 alias) and `ProveedorListItem` —
 *     `saldo` converted string→number via `DecimalAsNumber`, plus
 *     `cuit`/`telefono`/`notas`/`ultima_factura_fecha` widened back to
 *     required (FastAPI always serializes them, `Optional[...] = None` only
 *     means "optional at the constructor" — see the section below).
 *   - `ProveedorListItem` SHALL NOT carry `telefono`/`notas` — it is a
 *     genuinely LEANER row than `Proveedor`, not `extends Proveedor {}`.
 *
 * Also covered (task group 4 — the facturas client):
 *   - `FacturaItem`, `FacturaResponse`, `FacturaListItem`, `FacturaConEstado`
 *     — `monto_total`/`cantidad`/`precio_unitario` converted, `numero`
 *     widened back to required, `FacturaResponse.items` overridden to
 *     `FacturaItem[]` (nested arrays are NOT converted by `DecimalAsNumber`).
 *
 * Also covered (task group 5 — the pagos client):
 *   - `PagoResponse`, `PagoListItem`, `PagoListResponse` — `monto` converted,
 *     `comprobante_url` widened back to required, `PagoListResponse.items`
 *     overridden to `PagoListItem[]` for the same nested-array reason above.
 *
 * Also covered (task group 6 — the ventas client):
 *   - `Venta` (~ VentaResponse, D6 alias), `VentaListItem` (same shape as
 *     `Venta` — the backend has no separate list schema) and
 *     `VentaConEstado` (same schema name, no alias needed) — `monto`
 *     converted, `cliente_id` widened back to required on `Venta` (nullable)
 *     and required+non-null on `VentaConEstado` (a fiado always has a
 *     customer, RN-VTA-03).
 *
 * Also covered (task group 7 — the rest of the derived types, plus the
 * remaining D6 aliases):
 *   - The last 5 of D6's 15 aliases that groups 2-6 did not already close:
 *     `Factura`/`Pago` (plain re-exports of the already-derived
 *     `FacturaResponse`/`PagoResponse`, asserted equal), `RegistroBody`
 *     (~ RegistroRequest, zero drift), `Usuario` (~ UsuarioResponse —
 *     `telefono`/`avatar_url`/`nombre_negocio`/`updated_at` widened to
 *     required, `tema_preferido` narrowed to the domain enum despite the
 *     schema typing it as a bare `string` — a real backend inconsistency,
 *     documented not fixed), `MeResponse` (alias of `Usuario`).
 *   - `PropuestaFactura`/`PropuestaPago` — the one case in this file where a
 *     money field (`monto_total`/`monto`) is genuinely nullable, so the
 *     conversion is a hand override instead of routed through
 *     `DecimalAsNumber` (the helper's `[P in K]: number` mapping cannot
 *     express `| null`).
 *   - `Cliente` (~ ClienteResponse, D6 alias) and `ClienteListItem` (no
 *     separate schema) — `saldo` stays `string` (not converted), same
 *     convention as `Venta.monto`.
 *   - `EntradaHistorial`/`CuentaCorrienteResponse` and their customer-side
 *     mirror `EntradaHistorialCliente`/`CuentaCorrienteClienteResponse` —
 *     type derivation only; the parsing at `cuentaCorrienteApi.ts` /
 *     `cuentaCorrienteClienteApi.ts` predates C-41 and is unchanged.
 *   - `PeriodoTotal`/`ComprasResponse`/`VentaPeriodo`/`VentasResponse`/
 *     `ResumenResponse` — also type derivation only (`estadisticasParse.ts`
 *     predates C-41). `VentaPeriodo.desglose` is a hand override
 *     (`Record<FormaPago, number>`) because the wire's generic
 *     `{ [key: string]: string }` cannot be expressed by naming a key.
 */
import type { components } from './api.generated'
import type {
  DecimalAsNumber,
  ActividadRecienteItem,
  Proveedor,
  ProveedorListItem,
  FacturaItem,
  FacturaResponse,
  FacturaListItem,
  FacturaConEstado,
  Factura,
  PagoResponse,
  PagoListItem,
  PagoListResponse,
  Pago,
  Venta,
  VentaListItem,
  VentaConEstado,
  AvatarUpdate,
  ClienteCreate,
  EstadoFactura,
  EstadoVentaFiada,
  FormaPago,
  Granularidad,
  InvitacionResponse,
  MetodoCobro,
  MetodoPago,
  MiembroResponse,
  OrigenDocumento,
  PresetFirmadoResponse,
  ProveedorDeleteResponse,
  TemaPreferido,
  TipoUpload,
  ValidationError,
  CobroCliente,
  Categoria,
  LoginBody,
  RecuperarBody,
  ResetBody,
  RegistroEmpleadoBody,
  Usuario,
  MeResponse,
  RegistroBody,
  PropuestaFactura,
  PropuestaPago,
  Cliente,
  ClienteListItem,
  EntradaHistorial,
  CuentaCorrienteResponse,
  EntradaHistorialCliente,
  CuentaCorrienteClienteResponse,
  PeriodoTotal,
  ComprasResponse,
  VentaPeriodo,
  VentasResponse,
  ResumenResponse,
  HTTPValidationError,
  TopeExcedidoDetail,
} from './api'

type S = components['schemas']

/** Mutual `extends` — structural equality, not mere assignability. */
type Eq<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/**
 * Names every assertion so a failure points straight at the offending type
 * instead of a bare `false`.
 */
type Assert<Name extends string, R> = R extends true ? true : { CONTRACT_DRIFT: Name }

// ── Same export name, zero money fields ───────────────────────────────────

type _AvatarUpdate = Assert<'AvatarUpdate', Eq<AvatarUpdate, DecimalAsNumber<S['AvatarUpdate'], never>>>
type _ClienteCreate = Assert<'ClienteCreate', Eq<ClienteCreate, DecimalAsNumber<S['ClienteCreate'], never>>>
type _EstadoFactura = Assert<'EstadoFactura', Eq<EstadoFactura, DecimalAsNumber<S['EstadoFactura'], never>>>
type _EstadoVentaFiada = Assert<'EstadoVentaFiada', Eq<EstadoVentaFiada, DecimalAsNumber<S['EstadoVentaFiada'], never>>>
type _FormaPago = Assert<'FormaPago', Eq<FormaPago, DecimalAsNumber<S['FormaPago'], never>>>
type _Granularidad = Assert<'Granularidad', Eq<Granularidad, DecimalAsNumber<S['Granularidad'], never>>>
type _InvitacionResponse = Assert<'InvitacionResponse', Eq<InvitacionResponse, DecimalAsNumber<S['InvitacionResponse'], never>>>
type _MetodoCobro = Assert<'MetodoCobro', Eq<MetodoCobro, DecimalAsNumber<S['MetodoCobro'], never>>>
type _MetodoPago = Assert<'MetodoPago', Eq<MetodoPago, DecimalAsNumber<S['MetodoPago'], never>>>
type _MiembroResponse = Assert<'MiembroResponse', Eq<MiembroResponse, DecimalAsNumber<S['MiembroResponse'], never>>>
type _OrigenDocumento = Assert<'OrigenDocumento', Eq<OrigenDocumento, DecimalAsNumber<S['OrigenDocumento'], never>>>
type _PresetFirmadoResponse = Assert<'PresetFirmadoResponse', Eq<PresetFirmadoResponse, DecimalAsNumber<S['PresetFirmadoResponse'], never>>>
type _ProveedorDeleteResponse = Assert<'ProveedorDeleteResponse', Eq<ProveedorDeleteResponse, DecimalAsNumber<S['ProveedorDeleteResponse'], never>>>
type _TemaPreferido = Assert<'TemaPreferido', Eq<TemaPreferido, DecimalAsNumber<S['TemaPreferido'], never>>>
type _TipoUpload = Assert<'TipoUpload', Eq<TipoUpload, DecimalAsNumber<S['TipoUpload'], never>>>
type _ValidationError = Assert<'ValidationError', Eq<ValidationError, DecimalAsNumber<S['ValidationError'], never>>>

// ── Renamed (D6 alias), zero money fields ─────────────────────────────────

type _CobroCliente = Assert<'CobroCliente~CobroClienteResponse', Eq<CobroCliente, DecimalAsNumber<S['CobroClienteResponse'], never>>>
type _Categoria = Assert<'Categoria~CategoriaProveedor', Eq<Categoria, DecimalAsNumber<S['CategoriaProveedor'], never>>>
// LoginBody carries `remember_me` beyond LoginRequest — the backend schema
// does not have it (C-41 discovery: the D-C04-5 forward-declaration warning
// was correct). Asserted against the augmented shape, not the bare schema.
type _LoginBody = Assert<
  'LoginBody~LoginRequest+remember_me',
  Eq<LoginBody, DecimalAsNumber<S['LoginRequest'], never> & { remember_me?: boolean }>
>
type _RecuperarBody = Assert<'RecuperarBody~RecuperarRequest', Eq<RecuperarBody, DecimalAsNumber<S['RecuperarRequest'], never>>>
type _ResetBody = Assert<'ResetBody~ResetRequest', Eq<ResetBody, DecimalAsNumber<S['ResetRequest'], never>>>
type _RegistroEmpleadoBody = Assert<'RegistroEmpleadoBody~RegistroEmpleadoRequest', Eq<RegistroEmpleadoBody, DecimalAsNumber<S['RegistroEmpleadoRequest'], never>>>

// ── HTTPValidationError (task 8.1, closing the task 7.5 finding) ───────────
//
// `detail` widened back to required — same FastAPI-always-serializes-the-
// key rationale as every other required-widening in this file.

type _HTTPValidationError = Assert<
  'HTTPValidationError (detail required)',
  Eq<
    HTTPValidationError,
    Omit<DecimalAsNumber<S['HTTPValidationError'], never>, 'detail'> & {
      detail: ValidationError[]
    }
  >
>

// ── DecimalAsNumber selectivity (task 2.4) ──────────────────────────────────
//
// Proves the helper converts ONLY the named key(s), using the real
// `ProveedorResponse` schema as a concrete money-bearing example — WITHOUT
// touching the `Proveedor` export itself (that derivation, and its known
// `ProveedorListItem` drift, is task group 3's job, not this one).
//
// `cuit` is the case D3 exists to prevent: a digit string that must stay a
// string. If `DecimalAsNumber` ever converted by inferring "looks numeric"
// instead of by the named key, this is the assertion that would catch it.

type _ProveedorSaldoConverted = Assert<
  'DecimalAsNumber selectivity: saldo → number',
  DecimalAsNumber<S['ProveedorResponse'], 'saldo'>['saldo'] extends number ? true : false
>
type _ProveedorNombreUntouched = Assert<
  'DecimalAsNumber selectivity: nombre untouched',
  Eq<DecimalAsNumber<S['ProveedorResponse'], 'saldo'>['nombre'], S['ProveedorResponse']['nombre']>
>
type _ProveedorCuitUntouched = Assert<
  'DecimalAsNumber selectivity: cuit (digit-string identifier) untouched',
  Eq<DecimalAsNumber<S['ProveedorResponse'], 'saldo'>['cuit'], S['ProveedorResponse']['cuit']>
>

const _selectivity: [_ProveedorSaldoConverted, _ProveedorNombreUntouched, _ProveedorCuitUntouched] = [
  true,
  true,
  true,
]
void _selectivity

// ── Proveedor / ProveedorListItem (task group 3) ────────────────────────────
//
// Not zero-drift like the section above — `Proveedor` and `ProveedorListItem`
// both deliberately widen fields the schema marks "not required" back to
// required (`cuit`/`telefono`/`notas` on `Proveedor`; `cuit`/
// `ultima_factura_fecha` on `ProveedorListItem` — FastAPI/Pydantic always
// serializes these keys, `Optional[...] = None` only means "optional at the
// constructor"). These assertions are a REGRESSION LOCK, not a schema
// equality check: they fail if a future edit silently reintroduces
// hand-transcription instead of updating the `Omit<..., ...> & {...}`
// override in `api.d.ts`.

type _Proveedor = Assert<
  'Proveedor~ProveedorResponse (saldo converted, cuit/telefono/notas required)',
  Eq<
    Proveedor,
    Omit<DecimalAsNumber<S['ProveedorResponse'], 'saldo'>, 'cuit' | 'telefono' | 'notas'> & {
      cuit: string | null
      telefono: string | null
      notas: string | null
    }
  >
>

type _ProveedorListItem = Assert<
  'ProveedorListItem (lean row — NOT Proveedor; saldo converted, ultima_factura_fecha required)',
  Eq<
    ProveedorListItem,
    Omit<DecimalAsNumber<S['ProveedorListItem'], 'saldo'>, 'cuit' | 'ultima_factura_fecha'> & {
      cuit: string | null
      ultima_factura_fecha: string | null
    }
  >
>

// `ProveedorListItem` SHALL NOT carry `telefono`/`notas` — the old hand-
// written `extends Proveedor {}` promised fields the list endpoint never
// sends (design.md task 3.5's known drift). If either key reappears, this
// assertion is the one that catches it.
type _ProveedorListItemFields = keyof ProveedorListItem
type _AssertNoTelefonoInListItem = Assert<
  'ProveedorListItem SHALL NOT have telefono',
  'telefono' extends _ProveedorListItemFields ? false : true
>
type _AssertNoNotasInListItem = Assert<
  'ProveedorListItem SHALL NOT have notas',
  'notas' extends _ProveedorListItemFields ? false : true
>

const _proveedorAssertions: [
  _Proveedor,
  _ProveedorListItem,
  _AssertNoTelefonoInListItem,
  _AssertNoNotasInListItem,
] = [true, true, true, true]
void _proveedorAssertions

// ── ActividadRecienteItem (C-44, task group 2) ──────────────────────────────
//
// `proveedor_nombre` is widened back to required (`string | null`, not
// `?: string | null`) — same pattern as `ProveedorListItem.ultima_factura_fecha`:
// the schema marks it "not required" because a supplier that was deactivated
// leaves the backend's LEFT JOIN with a NULL name, but the key itself is
// always on the wire. `monto` is converted string→number via
// `DecimalAsNumber` — `actividadRecienteApi.ts` (features/proveedores) is the
// boundary that makes this true.

type _ActividadRecienteItem = Assert<
  'ActividadRecienteItem (monto converted, proveedor_nombre required)',
  Eq<
    ActividadRecienteItem,
    Omit<DecimalAsNumber<S['ActividadRecienteItem'], 'monto'>, 'proveedor_nombre'> & {
      proveedor_nombre: string | null
    }
  >
>

const _actividadRecienteAssertions: [_ActividadRecienteItem] = [true]
void _actividadRecienteAssertions

// ── FacturaItem / FacturaResponse / FacturaListItem / FacturaConEstado
// (task group 4) ─────────────────────────────────────────────────────────
//
// `numero` is widened back to required on `FacturaResponse`, `FacturaListItem`
// and `FacturaConEstado` — same rationale as `Proveedor.cuit` above: the
// schema marks it "not required" but FastAPI always serializes the key.
// `FacturaResponse.items` is overridden to the derived `FacturaItem[]`
// (`DecimalAsNumber` only converts top-level keys, so the nested wire
// items — string `cantidad`/`precio_unitario` — would otherwise leak
// through untouched).

type _FacturaItem = Assert<
  'FacturaItem~FacturaItemResponse (cantidad/precio_unitario converted)',
  Eq<FacturaItem, DecimalAsNumber<S['FacturaItemResponse'], 'cantidad' | 'precio_unitario'>>
>

type _FacturaResponse = Assert<
  'FacturaResponse (monto_total converted, numero required, items → FacturaItem[])',
  Eq<
    FacturaResponse,
    Omit<DecimalAsNumber<S['FacturaResponse'], 'monto_total'>, 'numero' | 'items'> & {
      numero: string | null
      items: FacturaItem[]
    }
  >
>

type _FacturaListItem = Assert<
  'FacturaListItem (monto_total converted, numero required)',
  Eq<
    FacturaListItem,
    Omit<DecimalAsNumber<S['FacturaListItem'], 'monto_total'>, 'numero'> & {
      numero: string | null
    }
  >
>

type _FacturaConEstado = Assert<
  'FacturaConEstado (monto_total converted, numero required)',
  Eq<
    FacturaConEstado,
    Omit<DecimalAsNumber<S['FacturaConEstado'], 'monto_total'>, 'numero'> & {
      numero: string | null
    }
  >
>

// `DecimalAsNumber` selectivity, re-proven on a nested-array-bearing schema
// (task 2.4's proveedores case had no arrays): `numero` — a digit-heavy
// string like "0001-00012345" — must stay untouched by the conversion.
type _FacturaNumeroUntouched = Assert<
  'DecimalAsNumber selectivity: numero (digit-heavy string) untouched by monto_total conversion',
  Eq<
    DecimalAsNumber<S['FacturaResponse'], 'monto_total'>['numero'],
    S['FacturaResponse']['numero']
  >
>

const _facturaAssertions: [
  _FacturaItem,
  _FacturaResponse,
  _FacturaListItem,
  _FacturaConEstado,
  _FacturaNumeroUntouched,
] = [true, true, true, true, true]
void _facturaAssertions

// ── PagoResponse / PagoListItem / PagoListResponse (task group 5) ──────────
//
// `comprobante_url` is widened back to required on `PagoResponse` — same
// rationale as `Proveedor.cuit`/`Factura.numero` above: the schema marks it
// "not required" but FastAPI always serializes the key. `PagoListResponse.
// items` is overridden to the derived `PagoListItem[]` — `DecimalAsNumber`
// only converts top-level keys, so the nested wire items (string `monto`)
// would otherwise leak through untouched.

type _PagoResponse = Assert<
  'PagoResponse (monto converted, comprobante_url required)',
  Eq<
    PagoResponse,
    Omit<DecimalAsNumber<S['PagoResponse'], 'monto'>, 'comprobante_url'> & {
      comprobante_url: string | null
    }
  >
>

type _PagoListItem = Assert<
  'PagoListItem (monto converted)',
  Eq<PagoListItem, DecimalAsNumber<S['PagoListItem'], 'monto'>>
>

type _PagoListResponse = Assert<
  'PagoListResponse (items → PagoListItem[])',
  Eq<
    PagoListResponse,
    Omit<DecimalAsNumber<S['PagoListResponse'], never>, 'items'> & {
      items: PagoListItem[]
    }
  >
>

// `DecimalAsNumber` selectivity, re-proven on the pagos schema: `proveedor_id`
// — a UUID, never a money field — must stay untouched by the `monto`
// conversion.
type _PagoProveedorIdUntouched = Assert<
  'DecimalAsNumber selectivity: proveedor_id (UUID) untouched by monto conversion',
  Eq<
    DecimalAsNumber<S['PagoResponse'], 'monto'>['proveedor_id'],
    S['PagoResponse']['proveedor_id']
  >
>

const _pagoAssertions: [
  _PagoResponse,
  _PagoListItem,
  _PagoListResponse,
  _PagoProveedorIdUntouched,
] = [true, true, true, true]
void _pagoAssertions

// ── Venta / VentaListItem / VentaConEstado (task group 6) ──────────────────
//
// `cliente_id` is widened back to required on `Venta` (`string | null`, not
// `?: string | null`) — same rationale as `Proveedor.cuit`/`Pago.
// comprobante_url` above. `VentaListItem` has no separate backend schema
// (the list endpoint returns the same shape as the single-item endpoint,
// design.md D2) — it is asserted structurally equal to `Venta`, not
// re-derived from a second schema. `VentaConEstado` widens `cliente_id`
// further, to required AND non-null (a fiado always has a customer,
// RN-VTA-03) — stricter than the general `Venta.cliente_id`.

type _Venta = Assert<
  'Venta~VentaResponse (monto converted, cliente_id required)',
  Eq<
    Venta,
    Omit<DecimalAsNumber<S['VentaResponse'], 'monto'>, 'cliente_id'> & {
      cliente_id: string | null
    }
  >
>

type _VentaListItem = Assert<'VentaListItem (same shape as Venta — no separate schema)', Eq<VentaListItem, Venta>>

type _VentaConEstado = Assert<
  'VentaConEstado (monto converted, cliente_id required and non-null)',
  Eq<
    VentaConEstado,
    Omit<DecimalAsNumber<S['VentaConEstado'], 'monto'>, 'cliente_id'> & {
      cliente_id: string
    }
  >
>

// `DecimalAsNumber` selectivity, re-proven on the ventas schema: `cliente_id`
// — a UUID, never a money field — must stay untouched by the `monto`
// conversion.
type _VentaClienteIdUntouched = Assert<
  'DecimalAsNumber selectivity: cliente_id (UUID) untouched by monto conversion',
  Eq<
    DecimalAsNumber<S['VentaResponse'], 'monto'>['cliente_id'],
    S['VentaResponse']['cliente_id']
  >
>

const _ventaAssertions: [
  _Venta,
  _VentaListItem,
  _VentaConEstado,
  _VentaClienteIdUntouched,
] = [true, true, true, true]
void _ventaAssertions

// ── D6 aliases finished off (task group 7) ──────────────────────────────────
//
// `Factura`/`Pago` were already DERIVED (as `FacturaResponse`/`PagoResponse`)
// by task groups 4/5 — what was still untested was the plain re-exported
// name itself. `Usuario`, `RegistroBody` and `Cliente` had no derivation at
// all until this group (they were still hand-written, drifting from
// `UsuarioResponse`/`RegistroRequest`/`ClienteResponse`). `MeResponse` stays
// a structural alias of `Usuario` (`extends Usuario {}`), asserted equal.

type _FacturaAlias = Assert<'Factura~FacturaResponse (alias, D6)', Eq<Factura, FacturaResponse>>
type _PagoAlias = Assert<'Pago~PagoResponse (alias, D6)', Eq<Pago, PagoResponse>>

type _RegistroBody = Assert<
  'RegistroBody~RegistroRequest',
  Eq<RegistroBody, DecimalAsNumber<S['RegistroRequest'], never>>
>

// `telefono`/`avatar_url`/`nombre_negocio` widened to required — same
// FastAPI-always-serializes-the-key rationale as `Proveedor.cuit`.
// `updated_at` widened to required too (the schema itself declares it
// non-optional; the pre-C-41 hand type marked it optional with no reason
// to). `tema_preferido` narrowed to the domain enum, non-null — the schema
// types it as a bare `Optional[str]` (a real backend inconsistency,
// documented not fixed, Non-Goal) but the model column is the
// `TemaPreferido` enum with a hard default, never `None`.
type _Usuario = Assert<
  'Usuario~UsuarioResponse (telefono/avatar_url/nombre_negocio/updated_at required, tema_preferido narrowed)',
  Eq<
    Usuario,
    Omit<
      DecimalAsNumber<S['UsuarioResponse'], never>,
      'telefono' | 'avatar_url' | 'nombre_negocio' | 'tema_preferido' | 'updated_at'
    > & {
      telefono: string | null
      avatar_url: string | null
      nombre_negocio: string | null
      tema_preferido: TemaPreferido
      updated_at: string
    }
  >
>

type _MeResponse = Assert<'MeResponse~UsuarioResponse (alias of Usuario, D6)', Eq<MeResponse, Usuario>>

const _d6Assertions: [_FacturaAlias, _PagoAlias, _RegistroBody, _Usuario, _MeResponse] = [
  true, true, true, true, true,
]
void _d6Assertions

// ── PropuestaFactura / PropuestaPago (task group 7 — ia-vision) ────────────
//
// `proveedor_nombre`/`numero`/`fecha_emision`/`error_message` (and, on
// `PropuestaPago`, `fecha`/`metodo`) are widened to required — same
// FastAPI-always-serializes-the-key rationale as `Proveedor.cuit`.
// `monto_total`/`monto` are overridden BY HAND to `number | null` instead of
// routed through `DecimalAsNumber` — the helper's `[P in K]: number`
// mapping forces a non-nullable `number`, which would be WRONG here: the
// vision extractor genuinely returns `null` for an unreadable field
// (RN-IA-03). The two assertions below the main ones prove the override
// actually preserves that nullability instead of silently losing it.

type _PropuestaFactura = Assert<
  'PropuestaFactura (proveedor_nombre/numero/fecha_emision/error_message required, monto_total nullable-converted)',
  Eq<
    PropuestaFactura,
    Omit<
      DecimalAsNumber<S['PropuestaFactura'], never>,
      'proveedor_nombre' | 'numero' | 'fecha_emision' | 'monto_total' | 'error_message'
    > & {
      proveedor_nombre: string | null
      numero: string | null
      fecha_emision: string | null
      monto_total: number | null
      error_message: string | null
    }
  >
>

type _PropuestaPago = Assert<
  'PropuestaPago (proveedor_nombre/fecha/metodo/error_message required, monto nullable-converted)',
  Eq<
    PropuestaPago,
    Omit<
      DecimalAsNumber<S['PropuestaPago'], never>,
      'proveedor_nombre' | 'monto' | 'fecha' | 'metodo' | 'error_message'
    > & {
      proveedor_nombre: string | null
      monto: number | null
      fecha: string | null
      metodo: MetodoPago | null
      error_message: string | null
    }
  >
>

// `DecimalAsNumber` selectivity, re-proven on a NULLABLE money field —
// `PropuestaFactura.monto_total` is the one field in this change the
// helper itself cannot express, so this locks that the hand override kept
// `| null` instead of it being silently dropped by a future edit.
type _PropuestaFacturaMontoNullable = Assert<
  'PropuestaFactura.monto_total stays nullable (helper cannot express this — hand override must)',
  null extends PropuestaFactura['monto_total'] ? true : never
>
type _PropuestaFacturaNumeroUntouched = Assert<
  'DecimalAsNumber selectivity: numero (digit-heavy string) untouched by monto_total conversion',
  Eq<PropuestaFactura['numero'], string | null>
>

const _iaVisionAssertions: [
  _PropuestaFactura,
  _PropuestaPago,
  _PropuestaFacturaMontoNullable,
  _PropuestaFacturaNumeroUntouched,
] = [true, true, true, true]
void _iaVisionAssertions

// ── Cliente / ClienteListItem (task group 7) ────────────────────────────────
//
// `telefono`/`notas`/`saldo` widened to required — same rationale as above.
// `saldo` stays `string`, NOT run through `DecimalAsNumber` — unlike
// `Proveedor.saldo`, this backend serializes the Decimal as a JSON string
// (same convention as `Venta.monto`), so there is nothing to convert.
// `ClienteListItem` has no separate backend schema (both `GET /api/clientes`
// and `GET /api/clientes/buscar` return `ClienteResponse[]`) — asserted
// structurally equal to `Cliente`, mirroring `VentaListItem`.

type _Cliente = Assert<
  'Cliente~ClienteResponse (telefono/notas/saldo required, saldo stays string)',
  Eq<
    Cliente,
    Omit<DecimalAsNumber<S['ClienteResponse'], never>, 'telefono' | 'notas' | 'saldo'> & {
      telefono: string | null
      notas: string | null
      saldo: string | null
    }
  >
>

type _ClienteListItem = Assert<
  'ClienteListItem (same shape as Cliente — no separate schema)',
  Eq<ClienteListItem, Cliente>
>

const _clienteAssertions: [_Cliente, _ClienteListItem] = [true, true]
void _clienteAssertions

// ── Cuenta-corriente: EntradaHistorial / CuentaCorrienteResponse and the
// customer-side mirror (task group 7) ───────────────────────────────────────
//
// `EntradaHistorial`/`EntradaHistorialCliente` convert `monto`/
// `saldo_acumulado`; `archivo_url` is left as the schema's own `?:` (a
// row predating the field genuinely omits the key — not the
// FastAPI-always-serializes case). `CuentaCorrienteResponse`/
// `CuentaCorrienteClienteResponse` convert `saldo` and override their
// nested arrays to the already-derived public row types, same
// nested-array reason as `FacturaResponse.items`.

type _EntradaHistorial = Assert<
  'EntradaHistorial (monto/saldo_acumulado converted)',
  Eq<EntradaHistorial, DecimalAsNumber<S['EntradaHistorial'], 'monto' | 'saldo_acumulado'>>
>

type _CuentaCorrienteResponse = Assert<
  'CuentaCorrienteResponse (saldo converted, facturas_con_estado/historial → derived arrays)',
  Eq<
    CuentaCorrienteResponse,
    Omit<DecimalAsNumber<S['CuentaCorrienteResponse'], 'saldo'>, 'facturas_con_estado' | 'historial'> & {
      facturas_con_estado: FacturaConEstado[]
      historial: EntradaHistorial[]
    }
  >
>

type _EntradaHistorialCliente = Assert<
  'EntradaHistorialCliente (monto/saldo_acumulado converted)',
  Eq<EntradaHistorialCliente, DecimalAsNumber<S['EntradaHistorialCliente'], 'monto' | 'saldo_acumulado'>>
>

type _CuentaCorrienteClienteResponse = Assert<
  'CuentaCorrienteClienteResponse (saldo converted, ventas_con_estado/historial → derived arrays)',
  Eq<
    CuentaCorrienteClienteResponse,
    Omit<
      DecimalAsNumber<S['CuentaCorrienteClienteResponse'], 'saldo'>,
      'ventas_con_estado' | 'historial'
    > & {
      ventas_con_estado: VentaConEstado[]
      historial: EntradaHistorialCliente[]
    }
  >
>

const _cuentaCorrienteAssertions: [
  _EntradaHistorial,
  _CuentaCorrienteResponse,
  _EntradaHistorialCliente,
  _CuentaCorrienteClienteResponse,
] = [true, true, true, true]
void _cuentaCorrienteAssertions

// ── Estadísticas: PeriodoTotal / ComprasResponse / VentaPeriodo /
// VentasResponse / ResumenResponse (task group 7) ───────────────────────────
//
// `PeriodoTotal.total` and `ResumenResponse`'s three fields convert via
// `DecimalAsNumber`. `ComprasResponse.periodos`/`VentasResponse.periodos`
// override to the derived row arrays, same nested-array reason as above.
// `VentaPeriodo.desglose` is overridden BY HAND to `Record<FormaPago,
// number>` — the OpenAPI-generated wire shape is a generic
// `{ [key: string]: string }` (a Pydantic `dict[FormaPago, Decimal]` loses
// its key-enum at the OpenAPI boundary), so `DecimalAsNumber` cannot express
// this conversion by naming a key.

type _PeriodoTotal = Assert<
  'PeriodoTotal (total converted)',
  Eq<PeriodoTotal, DecimalAsNumber<S['PeriodoTotal'], 'total'>>
>

type _ComprasResponse = Assert<
  'ComprasResponse (periodos → PeriodoTotal[])',
  Eq<
    ComprasResponse,
    Omit<DecimalAsNumber<S['ComprasResponse'], never>, 'periodos'> & { periodos: PeriodoTotal[] }
  >
>

type _VentaPeriodo = Assert<
  'VentaPeriodo (total converted, desglose → Record<FormaPago, number>)',
  Eq<
    VentaPeriodo,
    Omit<DecimalAsNumber<S['VentaPeriodo'], 'total'>, 'desglose'> & {
      desglose: Record<FormaPago, number>
    }
  >
>

type _VentasResponse = Assert<
  'VentasResponse (periodos → VentaPeriodo[])',
  Eq<
    VentasResponse,
    Omit<DecimalAsNumber<S['VentasResponse'], never>, 'periodos'> & { periodos: VentaPeriodo[] }
  >
>

type _ResumenResponse = Assert<
  'ResumenResponse (compras/ventas/diferencia converted)',
  Eq<ResumenResponse, DecimalAsNumber<S['ResumenResponse'], 'compras' | 'ventas' | 'diferencia'>>
>

const _estadisticasAssertions: [
  _PeriodoTotal,
  _ComprasResponse,
  _VentaPeriodo,
  _VentasResponse,
  _ResumenResponse,
] = [true, true, true, true, true]
void _estadisticasAssertions

const _assertions: [
  _AvatarUpdate, _ClienteCreate, _EstadoFactura, _EstadoVentaFiada, _FormaPago,
  _Granularidad, _InvitacionResponse, _MetodoCobro, _MetodoPago, _MiembroResponse,
  _OrigenDocumento, _PresetFirmadoResponse, _ProveedorDeleteResponse, _TemaPreferido,
  _TipoUpload, _ValidationError, _CobroCliente, _Categoria, _LoginBody, _RecuperarBody,
  _ResetBody, _RegistroEmpleadoBody, _HTTPValidationError,
] = [
  true, true, true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true, true, true, true, true,
]
void _assertions

// ── Estadísticas structural guards, absorbed from api.estadisticas.test-d.ts
// (D8, tasks 8.2/8.3) ────────────────────────────────────────────────────
//
// The `Eq<>` assertions above are a REGRESSION LOCK: they catch someone
// hand-editing `api.d.ts` to drift from its own derivation expression, but
// (per the group-7 finding, documented in `api.d.ts`'s header and this
// file's own comments) they do NOT catch the backend schema itself
// changing shape, because both sides of `Eq<>` reference the SAME live
// schema import and move in lockstep.
//
// The assertions below are a DIFFERENT style, on purpose: instead of
// comparing two independently-re-derived expressions, they inspect a
// property of the LIVE, already-derived type directly (`'x' extends keyof
// T`, a hardcoded literal-union comparison, ...). Because the live type
// reflects whatever the schema currently says, these assertions DO fail
// when the schema changes underneath them — verified by mutation before
// `api.estadisticas.test-d.ts` was retired (task 8.2/8.3):
//   - Added a 4th literal ('anio') to `Granularidad` in `api.generated.d.ts`
//     — `_AssertGranularidadClosed` below failed to compile (extra member
//     outside the closed 3-literal union); the `Eq<>`-style `_Granularidad`
//     assertion above did NOT fail (lockstep). Reverted.
//   - Renamed `PeriodoTotal.periodo` to `periodo_inicio` in the generated
//     schema — `_AssertPeriodoHasPeriodo` below failed; `_PeriodoTotal`
//     above did NOT (lockstep, no named DecimalAsNumber key involved).
//     Reverted.
//   - Renamed `ComprasResponse.proveedor_id` to `proveedor_id_opt` in the
//     generated schema — `_AssertProveedorIdOptional` below failed (the
//     renamed key does not exist under the old name, so `undefined extends
//     ComprasResponse['proveedor_id_opt' as never]` breaks the indexed
//     access); `_ComprasResponse` above did NOT fail. Reverted.
//   - Removed `sugerencia` from the hand-written `TopeExcedidoDetail`
//     interface in `api.d.ts` — `_AssertTopeHasSugerencia` below failed.
//     Reverted. (`TopeExcedidoDetail` has no backend schema at all — this
//     is the one case in this section that is ALSO a hand-written-type
//     regression lock, not a schema-drift catch; see the D5 section header
//     in `api.d.ts` for why.)

// ── Granularidad is closed to the three backend values ───────────────────

type _AssertGranularidadClosed = Granularidad extends 'dia' | 'semana' | 'mes' ? true : never
type _AssertGranularidadComplete = 'dia' | 'semana' | 'mes' extends Granularidad ? true : never

// ── PeriodoTotal carries its bucket bounds alongside the numeric total ────

type PeriodoFields = keyof PeriodoTotal
type _AssertPeriodoHasPeriodo = 'periodo' extends PeriodoFields ? true : never
type _AssertPeriodoHasDesde = 'desde' extends PeriodoFields ? true : never
type _AssertPeriodoHasHasta = 'hasta' extends PeriodoFields ? true : never
type _AssertPeriodoTotalIsNumber = PeriodoTotal['total'] extends number ? true : never

// ── `desglose` covers EVERY FormaPago, with numeric amounts ──────────────

type _AssertDesgloseCoversEveryFormaPago = FormaPago extends keyof VentaPeriodo['desglose']
  ? true
  : never
type _AssertDesgloseAmountsAreNumbers = VentaPeriodo['desglose'][FormaPago] extends number
  ? true
  : never

// ── Both series responses echo the range's granularity ────────────────────

type _AssertComprasEchoesGranularidad = ComprasResponse['granularidad'] extends Granularidad
  ? true
  : never
type _AssertVentasEchoesGranularidad = VentasResponse['granularidad'] extends Granularidad
  ? true
  : never

// ── `proveedor_id` is OPTIONAL on ComprasResponse (the unscoped call omits it) ─

type _AssertProveedorIdOptional = undefined extends ComprasResponse['proveedor_id'] ? true : never

// ── ResumenResponse has no margin, by any of its names (C-37 D6) ─────────

type ResumenFields = keyof ResumenResponse
type _AssertResumenHasDiferencia = 'diferencia' extends ResumenFields ? true : never
type _AssertResumenNoMargen = 'margen' extends ResumenFields ? never : true
type _AssertResumenNoRentabilidad = 'rentabilidad' extends ResumenFields ? never : true
type _AssertResumenNoGanancia = 'ganancia' extends ResumenFields ? never : true

// ── TopeExcedidoDetail carries what the UI needs to be actionable ────────

type TopeFields = keyof TopeExcedidoDetail
type _AssertTopeHasEstimados = 'periodos_estimados' extends TopeFields ? true : never
type _AssertTopeHasTope = 'tope' extends TopeFields ? true : never
type _AssertTopeHasSugerencia = 'sugerencia' extends TopeFields ? true : never
type _AssertTopeCountsAreNumbers = TopeExcedidoDetail['periodos_estimados'] extends number
  ? true
  : never

const _estadisticasStructuralAssertions: [
  _AssertGranularidadClosed,
  _AssertGranularidadComplete,
  _AssertPeriodoHasPeriodo,
  _AssertPeriodoHasDesde,
  _AssertPeriodoHasHasta,
  _AssertPeriodoTotalIsNumber,
  _AssertDesgloseCoversEveryFormaPago,
  _AssertDesgloseAmountsAreNumbers,
  _AssertComprasEchoesGranularidad,
  _AssertVentasEchoesGranularidad,
  _AssertProveedorIdOptional,
  _AssertResumenHasDiferencia,
  _AssertResumenNoMargen,
  _AssertResumenNoRentabilidad,
  _AssertResumenNoGanancia,
  _AssertTopeHasEstimados,
  _AssertTopeHasTope,
  _AssertTopeHasSugerencia,
  _AssertTopeCountsAreNumbers,
] = [
  true, true, true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true,
]
void _estadisticasStructuralAssertions

export {}
