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
 */
import type { components } from './api.generated'
import type {
  DecimalAsNumber,
  Proveedor,
  ProveedorListItem,
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

const _assertions: [
  _AvatarUpdate, _ClienteCreate, _EstadoFactura, _EstadoVentaFiada, _FormaPago,
  _Granularidad, _InvitacionResponse, _MetodoCobro, _MetodoPago, _MiembroResponse,
  _OrigenDocumento, _PresetFirmadoResponse, _ProveedorDeleteResponse, _TemaPreferido,
  _TipoUpload, _ValidationError, _CobroCliente, _Categoria, _LoginBody, _RecuperarBody,
  _ResetBody, _RegistroEmpleadoBody,
] = [
  true, true, true, true, true, true, true, true, true, true, true, true, true, true,
  true, true, true, true, true, true, true, true,
]
void _assertions

export {}
