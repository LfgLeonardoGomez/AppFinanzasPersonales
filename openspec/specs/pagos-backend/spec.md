# pagos-backend Specification

## Purpose

Expose the complete HTTP CRUD for `Pago` over `/api/pagos` so the C-08 FIFO estado algorithm and the C-12 cuenta-corriente view can read a real, isolated, user-scoped payment pool instead of the C-06 stub. Shipped by C-10, this capability delivers the full `Pago` lifecycle — `GET /api/pagos?proveedor_id&page` (paginated list, ordered by `fecha DESC, created_at DESC, id DESC`, scoped to the caller's active pagos), `POST /api/pagos` (create), `GET /api/pagos/{id}` (read), `PATCH /api/pagos/{id}` (update), `DELETE /api/pagos/{id}` (soft delete) — backed by `PagoService` in the service layer where all authorization and validation live, and by Pydantic `PagoCreate` / `PagoUpdate` schemas in `app/schemas/pago.py` (replacing the C-08 inline models) that use `model_config = ConfigDict(extra="forbid")` to reject any payload containing `factura_id` at the wire level. The capability enforces RN-PAG-01 through RN-PAG-05: no `factura_id` anywhere — neither in the schema, nor in the model, nor in any payload; `monto > 0`; `fecha <= today(UTC-3)` via `zoneinfo.ZoneInfo("America/Argentina/Buenos_Aires")`; `metodo` constrained to the `MetodoPago` enum; and `proveedor_id` cannot be changed via PATCH (would corrupt the FIFO pool history). Multi-tenant isolation is enforced by the `_get_owned_pago(negocio_id, pago_id)` helper, which raises 404 for foreign, soft-deleted, or non-existent pagos (never 403, to prevent enumeration, mirroring the C-08 pattern). Soft-deleted pagos remain in the table but are excluded from the FIFO pool aggregation in `FacturaService` and from the cuenta-corriente `historial`, and the composite index migration `(usuario_id, proveedor_id, deleted_at, fecha)` on `pago` keeps the FIFO pool queries fast as data grows.

> **Actualizado por C-28 (D-27):** el eje de aislamiento de esta capability pasó de `usuario_id` a `negocio_id`. Las referencias a `usuario_id` que quedan arriba describen migraciones históricas (los índices que existieron hasta la revisión 0005) y se conservan como registro; la migración 0006 los reemplazó por sus equivalentes liderados por `negocio_id`. Ver la capability `negocio-scoping`.
## Requirements
### Requirement: Payment listing scoped to the authenticated caller's negocio

The system SHALL expose `GET /api/pagos` returning the authenticated caller's **negocio**'s active payments (where `deleted_at IS NULL`). The endpoint SHALL accept optional query parameters: `proveedor_id` (UUID) and `page` (int, default 1, 1-indexed). The default page size SHALL be 50. The list SHALL be ordered by `fecha DESC, created_at DESC, id DESC` so the most recent payment surfaces first. When `proveedor_id` is provided, the list SHALL be filtered to that supplier. Foreign `proveedor_id` (owned by another negocio) SHALL return 404, not an empty list.

#### Scenario: listing returns only the caller's negocio's active payments

- **WHEN** an authenticated user requests `GET /api/pagos`
- **THEN** the response contains only that negocio's non-deleted payments, ordered by `fecha DESC, created_at DESC, id DESC`

#### Scenario: soft-deleted payments are excluded from the listing

- **WHEN** a payment has `deleted_at` populated and the user requests the default listing
- **THEN** that payment does not appear in the response

#### Scenario: listing scoped to a supplier when proveedor_id is provided

- **WHEN** the request supplies `proveedor_id` and that supplier belongs to the authenticated caller's negocio
- **THEN** only that supplier's payments are returned, still in the same `fecha DESC` order

#### Scenario: proveedor_id belonging to another negocio returns 404

- **WHEN** the request supplies a `proveedor_id` that belongs to a different negocio
- **THEN** the response is 404 Not Found and no payments from any supplier are leaked

#### Scenario: pagination with page size 50

- **WHEN** the negocio has more than 50 active payments and the user requests page 2
- **THEN** the response contains the next 50 payments, in the same order, and a `total` field reflecting the full active count

#### Scenario: payments loaded by a teammate are listed

- **WHEN** two users of the same negocio each create payments and either of them lists `GET /api/pagos`
- **THEN** the listing contains the payments created by both

### Requirement: Create payment (RN-PAG-01, RN-PAG-02, RN-PAG-03, RN-PAG-04)

The system SHALL expose `POST /api/pagos` that creates a payment owned by the authenticated caller's **negocio**, associated to one of that negocio's suppliers. The service SHALL verify that the target `proveedor_id` exists, is not soft-deleted, and belongs to the caller's negocio before persisting (foreign proveedor → 404). `monto` SHALL be validated as > 0 by both Pydantic schema and service layer. `fecha` SHALL be validated by the service as not in the future relative to the `America/Argentina/Buenos_Aires` (UTC-3, no DST) wall clock. `metodo` SHALL be a Pydantic enum. `negocio_id` SHALL be taken from the authenticated session — the payload cannot override it — and `creado_por_usuario_id` SHALL be set to the caller's user id. `origen` SHALL default to `MANUAL`, accepting `IA` from the client per D-18. The endpoint SHALL return status 201.

#### Scenario: create a valid payment

- **WHEN** an authenticated user POSTs a valid payload with a `proveedor_id` owned by their negocio, `monto > 0`, a non-future `fecha`, and a valid `metodo`
- **THEN** the payment is persisted with the caller's `negocio_id` and `creado_por_usuario_id`, and the response includes the persisted payment with status 201

#### Scenario: negocio_id is taken from the session, not the payload

- **WHEN** a `PagoCreate` payload is submitted by an authenticated user
- **THEN** the persisted `negocio_id` equals the authenticated caller's `negocio_id`, regardless of any payload field

#### Scenario: origen defaults to MANUAL

- **WHEN** a `PagoCreate` payload is submitted without `origen`
- **THEN** the persisted `origen` equals `MANUAL`

#### Scenario: proveedor belonging to another negocio returns 404

- **WHEN** the submitted `proveedor_id` belongs to a different negocio
- **THEN** the response is 404 Not Found and no payment is persisted

#### Scenario: proveedor that is soft-deleted returns 404

- **WHEN** the submitted `proveedor_id` has `deleted_at` set
- **THEN** the response is 404 Not Found and no payment is persisted

#### Scenario: factura_id is still rejected at the wire level

- **WHEN** a `PagoCreate` payload includes `factura_id`
- **THEN** the request is rejected by the schema (`extra="forbid"`), preserving RN-PAG-01

### Requirement: Read a single payment

The system SHALL expose `GET /api/pagos/{id}` returning a single payment only when it belongs to the caller's negocio. A foreign or soft-deleted payment SHALL be indistinguishable from a non-existent one (404, never 403).

#### Scenario: read own payment

- **WHEN** an authenticated user requests one of their own active payments by id
- **THEN** the payment is returned with all its fields (id, negocio_id, proveedor_id, monto, fecha, metodo, comprobante_url, origen, created_at, updated_at)

#### Scenario: reading a foreign payment returns 404

- **WHEN** an authenticated user requests a payment id that belongs to another negocio
- **THEN** the response is 404 Not Found (never 403)

#### Scenario: reading a soft-deleted payment returns 404

- **WHEN** an authenticated user requests a payment id that has `deleted_at` set
- **THEN** the response is 404 Not Found

### Requirement: Update payment with ownership check (PATCH semantics)

The system SHALL expose `PATCH /api/pagos/{id}` that updates editable fields (`monto`, `fecha`, `metodo`, `comprobante_url`) of a payment owned by the caller's negocio. All fields SHALL be optional; only provided (non-None) fields are applied. `proveedor_id` SHALL NOT be changeable via PATCH (re-linking a payment to a different supplier would corrupt the FIFO pool's history). `negocio_id` SHALL NOT be changeable. `origen` SHALL NOT be changeable. If `monto` is provided, it SHALL be > 0 (Pydantic + service). If `fecha` is provided, it SHALL be ≤ today in UTC-3. The ownership check SHALL be enforced in the service layer (foreign → 404, never 403).

#### Scenario: update editable fields of own payment

- **WHEN** an authenticated user PATCHes a subset of editable fields on their own payment
- **THEN** only the provided fields are updated and the response includes the updated payment

#### Scenario: updating a foreign payment returns 404

- **WHEN** an authenticated user PATCHes a payment that belongs to another negocio
- **THEN** the response is 404 Not Found and the foreign payment is unchanged

#### Scenario: proveedor_id cannot be changed via PATCH

- **WHEN** the PATCH payload includes a `proveedor_id` field
- **THEN** the response is 422 (the schema does not declare `proveedor_id` and `extra="forbid"` rejects it)

#### Scenario: future fecha in update returns 422

- **WHEN** the PATCH payload includes a `fecha` in the future (UTC-3)
- **THEN** the response is 422 and the payment is not modified

#### Scenario: non-positive monto in update returns 422

- **WHEN** the PATCH payload includes a `monto <= 0`
- **THEN** the response is 422 and the payment is not modified

### Requirement: Soft-delete payment (RN-PAG-05)

The system SHALL expose `DELETE /api/pagos/{id}` that performs a soft delete (sets `deleted_at`) on a payment owned by the caller's negocio, preserving the row and its FK references. Deleting a foreign or already-deleted payment SHALL return 404. The endpoint SHALL return 204 No Content on success. Deleting a payment does NOT directly affect any invoice (payments link only to `proveedor_id`, not `factura_id` — RN-PAG-01); the next on-demand re-aggregation of the FIFO pool (C-08 / C-12) automatically excludes the soft-deleted payment.

#### Scenario: soft delete preserves the row

- **WHEN** an authenticated user deletes their own payment
- **THEN** the payment row remains in the database with `deleted_at` populated and the payment no longer appears in the default listing

#### Scenario: deleting a foreign payment returns 404

- **WHEN** an authenticated user deletes a payment that belongs to another negocio
- **THEN** the response is 404 Not Found and the foreign payment is not modified

#### Scenario: deleting an already-deleted payment returns 404

- **WHEN** an authenticated user deletes a payment that already has `deleted_at` set
- **THEN** the response is 404 Not Found

#### Scenario: soft-deleted payment is excluded from the FIFO pool

- **WHEN** a payment is soft-deleted and a subsequent `FacturaService.listar` runs for the same supplier
- **THEN** the payment is not included in the `SUM(monto)` of the payment pool used by the FIFO algorithm

#### Scenario: soft delete does not affect invoices

- **WHEN** a payment is soft-deleted and the supplier has associated invoices
- **THEN** the invoice records are unchanged and still reference the `proveedor_id`

### Requirement: All payment endpoints require authentication

Every `/api/pagos` endpoint SHALL require a valid authenticated session (`get_current_user`). Requests without a valid `access_token` cookie SHALL be rejected with 401. All data access SHALL be scoped to the authenticated caller's negocio's `negocio_id`.

#### Scenario: unauthenticated request rejected

- **WHEN** a request reaches any `/api/pagos` endpoint without a valid session cookie
- **THEN** the response is 401 Unauthorized

### Requirement: Service-layer authorization — 404 on foreign resource

All authorization checks SHALL live exclusively in the service layer (`PagoService`). The router SHALL NOT contain ownership logic. When a resource does not belong to the authenticated caller's negocio, the service SHALL raise HTTP 404 (not 403) — foreign resources are indistinguishable from non-existent ones to prevent enumeration. The helper `_get_owned_pago(negocio_id, pago_id)` SHALL raise 404 if the pago is missing, soft-deleted, or owned by a different negocio.

#### Scenario: cross-negocio isolation — negocio B cannot access negocio A's payments

- **WHEN** user B attempts to GET, PATCH, or DELETE a payment that belongs to user A
- **THEN** every operation returns 404, and user A's payment is not modified

### Requirement: Pago schema forbids factura_id (RN-PAG-01)

The `PagoCreate` and `PagoUpdate` schemas SHALL NOT declare a `factura_id` field. Both schemas SHALL set `model_config = ConfigDict(extra="forbid")` so any payload attempting to send a `factura_id` (or any other unknown field) is rejected with 422 by Pydantic before reaching the service. The `Pago` SQLModel SHALL NOT contain a `factura_id` column (already enforced by C-02; this requirement reasserts it at the API surface).

#### Scenario: payload with factura_id is rejected at the schema layer

- **WHEN** an authenticated user POSTs `{"proveedor_id": ..., "monto": 100, "fecha": "2026-06-25", "metodo": "EFECTIVO", "factura_id": "<uuid>"}`
- **THEN** the response is 422 Unprocessable Entity and no payment is persisted

#### Scenario: PATCH payload with factura_id is rejected at the schema layer

- **WHEN** an authenticated user PATCHes a payment with `{"factura_id": "<uuid>"}`
- **THEN** the response is 422 Unprocessable Entity and the payment is unchanged

#### Scenario: Pago SQLModel has no factura_id attribute

- **WHEN** the `Pago` SQLModel is introspected
- **THEN** it has no `factura_id` attribute and no `factura_id` column is present in the `pago` table

### Requirement: Schema validation

The `PagoCreate` schema SHALL enforce: `proveedor_id` (UUID, required); `monto` (Decimal, > 0, Pydantic `Field(gt=0)`); `fecha` (date, required); `metodo` (MetodoPago enum, required); `comprobante_url` (Optional[str]). `usuario_id`, `negocio_id`, `origen`, and any other internal field SHALL NOT appear in the schema. The `PagoUpdate` schema SHALL make `monto`, `fecha`, `metodo`, and `comprobante_url` all optional, applying the same validators to provided values. `proveedor_id`, `usuario_id`, `negocio_id`, and `origen` SHALL NOT appear in `PagoUpdate`.

#### Scenario: monto must be positive

- **WHEN** `PagoCreate` is constructed with `monto = 0` or negative
- **THEN** Pydantic raises a validation error before the request reaches the service

#### Scenario: comprobante_url is optional on create

- **WHEN** `PagoCreate` is constructed without `comprobante_url`
- **THEN** the schema is valid and the field is persisted as `null`

#### Scenario: PagoUpdate is fully optional

- **WHEN** `PagoUpdate` is constructed with no fields set
- **THEN** it is valid (PATCH semantics — zero fields patched is acceptable)

#### Scenario: PagoUpdate rejects unknown fields

- **WHEN** `PagoUpdate` is constructed with a field that is not in its declared set
- **THEN** Pydantic raises a validation error because of `extra="forbid"`

### Requirement: Composite index migration

The change SHALL include a reversible Alembic migration (file `<timestamp>_pago_indices.py`) that creates composite index `ix_pago_usuario_proveedor_deleted_fecha` on `(usuario_id, proveedor_id, deleted_at, fecha)` on the `pago` table (which already exists from migration 0001). The migration SHALL NOT introduce any column on `pago`. Its `downgrade` SHALL drop the index. The migration SHALL NOT touch the `factura` table or the `proveedor` table.

#### Scenario: upgrade creates the composite index

- **WHEN** `alembic upgrade head` runs with the database at the previous head revision
- **THEN** the index `ix_pago_usuario_proveedor_deleted_fecha` exists on the `pago` table and the new head revision is recorded

#### Scenario: downgrade drops the composite index

- **WHEN** `alembic downgrade` of the new migration runs
- **THEN** the index is removed and the schema returns to its previous state

#### Scenario: migration introduces no new columns on pago

- **WHEN** the `pago` table is inspected after the migration
- **THEN** its column set is identical to what migration 0001 created; no `factura_id`, `estado`, or `saldo` column exists

### Requirement: Cloudinary preset endpoint accepts tipo=comprobante

The existing `GET /api/cloudinary/preset-firmado` endpoint SHALL accept `tipo=comprobante` in addition to the existing `tipo=factura` and `tipo=avatar` values. The response shape and validation contract (PDF/jpg/png, max 10 MB, signed upload preset) SHALL be identical across all three `tipo` values. An invalid `tipo` SHALL return 422.

#### Scenario: requesting a comprobante preset returns a signed upload preset

- **WHEN** an authenticated user requests `GET /api/cloudinary/preset-firmado?tipo=comprobante`
- **THEN** the response includes the same shape as the existing `factura` and `avatar` presets, suitable for uploading a comprobante to Cloudinary

#### Scenario: requesting an invalid tipo returns 422

- **WHEN** an authenticated user requests `GET /api/cloudinary/preset-firmado?tipo=desconocido`
- **THEN** the response is 422 Unprocessable Entity

### Requirement: Create endpoint honors optional `origen` field

The `POST /api/pagos` endpoint SHALL accept an optional `origen` field on the request body, typed as the `OrigenDocumento` enum (`MANUAL` | `IA`). When the field is provided, the service SHALL persist the supplied value on the new payment. When the field is omitted, the service SHALL persist `OrigenDocumento.MANUAL` as the default. The endpoint SHALL return 422 if `origen` is provided with a value that is not a member of the `OrigenDocumento` enum. The `extra="forbid"` constraint on `PagoCreate` is preserved — only the `origen` field is added as a known optional field; `factura_id` and other unknown fields continue to be rejected.

#### Scenario: `origen=IA` from a C-15 IA confirmation persists as `IA`

- **WHEN** an authenticated user posts a `PagoCreate` payload with `origen="IA"` to `POST /api/pagos`
- **THEN** the persisted `Pago.origen` column is `OrigenDocumento.IA` and the response body's `origen` field is `"IA"`

#### Scenario: `origen` omitted defaults to `MANUAL` (backward compat with C-11 manual flow)

- **WHEN** an authenticated user posts a `PagoCreate` payload without an `origen` field
- **THEN** the persisted `Pago.origen` column is `OrigenDocumento.MANUAL` and the response body's `origen` field is `"MANUAL"`

#### Scenario: invalid `origen` value is rejected with 422

- **WHEN** an authenticated user posts a `PagoCreate` payload with `origen="INVALID"` (not a member of `OrigenDocumento`)
- **THEN** the endpoint returns HTTP 422 and no row is created

#### Scenario: `factura_id` and other unknown fields are still rejected (regression guard for RN-PAG-01)

- **WHEN** an authenticated user posts a `PagoCreate` payload with `factura_id` (or any other field not declared in the schema)
- **THEN** the endpoint returns HTTP 422 with a `forbidden` / `extra_forbidden` validation error and no row is created — `extra="forbid"` is preserved

### Requirement: PagoResponse includes proveedor_nombre populated by the service

The system SHALL include an optional `proveedor_nombre: Optional[str]` field on the `PagoResponse` schema (in `app/schemas/pago.py`). The field SHALL be `None` by default for backward compatibility with any caller that constructs a `PagoResponse` directly (e.g., older tests). The service layer (`PagoService`) SHALL populate the field in the response serializer for all 5 paths that return a `PagoResponse`: `crear`, `actualizar`, `obtener`, `listar_por_usuario`, `listar_por_proveedor`. For single-pago paths (`obtener`, `crear`, `actualizar`), the related `Proveedor` is already loaded; the service passes `proveedor_nombre=pago.proveedor.nombre`. For list paths, the service does a single targeted lookup (`SELECT id, nombre FROM proveedor WHERE id IN (...)`) and maps names to pagos by `proveedor_id`. When the related `Proveedor` is soft-deleted (`deleted_at IS NOT NULL`), the field SHALL be `None` (not 404, not 500; the pago remains valid and the supplier's absence is informational, not an error).

#### Scenario: a payment's response includes the supplier's name when the supplier is active

- **WHEN** a `Pago` is created or fetched and the related `Proveedor` is active (not soft-deleted)
- **THEN** the `PagoResponse.proveedor_nombre` field is the supplier's `nombre` (e.g., "YPF S.A.")

#### Scenario: a payment's response includes None when the supplier is soft-deleted

- **WHEN** a `Pago` is fetched and the related `Proveedor` has `deleted_at` populated (the supplier was soft-deleted after the pago was created, per RN-PROV-04)
- **THEN** the `PagoResponse.proveedor_nombre` field is `None`, the response is 200 OK, and no error is raised

#### Scenario: list endpoint includes proveedor_nombre for all rows

- **WHEN** a list endpoint (`listar_por_usuario` or `listar_por_proveedor`) returns multiple pagos
- **THEN** each `PagoResponse.proveedor_nombre` field is populated (or `None` if the supplier is soft-deleted) and the list response is one extra SQL round-trip (a single `SELECT id, nombre FROM proveedor WHERE id IN (...)` for the page's pagos)

#### Scenario: backward compatibility is preserved for direct PagoResponse construction

- **WHEN** a test or third-party caller constructs a `PagoResponse` directly without supplying `proveedor_nombre`
- **THEN** the field defaults to `None` and no validation error is raised; existing tests and consumers are unaffected

#### Scenario: aislamiento multi-tenant is preserved

- **WHEN** a `Pago` belongs to user A and is fetched by user B
- **THEN** the response is 404 Not Found (the isolation helper `_get_owned_pago` raises 404 before the response serializer runs); `proveedor_nombre` is never exposed to a user who does not own the pago

### Requirement: Collection endpoints answer without redirecting

Collection endpoints SHALL respond directly on both the trailing-slash and the bare path. Neither form may produce a redirect.

A redirect is not cosmetic here: HTTP clients rebuild the request when they follow one, and some drop headers set explicitly on the original. That is precisely what let the old multi-user test harness attribute writes to the wrong user (C-22) — the request arrived authenticated as whoever the client's cookie jar held rather than the header the caller set.

#### Scenario: Both path forms answer directly

- **WHEN** an authenticated client issues a collection request to either `/api/<recurso>` or `/api/<recurso>/`
- **THEN** the endpoint answers the request itself, with no 3xx redirect in the exchange

#### Scenario: Ownership and validation are unaffected

- **WHEN** a request that previously returned 401, 404 or 422 is issued on either path form
- **THEN** it returns the same status as before — only the redirect disappears

#### Scenario: The generated schema stays single-valued

- **WHEN** the OpenAPI document is produced
- **THEN** each collection operation appears once, so generated clients and types do not gain a duplicate

### Requirement: Payment endpoints reject deactivated users

Every `/api/pagos` endpoint SHALL reject a request whose authenticated user has `desactivado = true` with **401**, independently of token validity, and SHALL scope all data access to the caller's `negocio_id`.

#### Scenario: deactivated user rejected

- **WHEN** a request reaches any `/api/pagos` endpoint with a valid token belonging to a deactivated user
- **THEN** the response is 401 Unauthorized and no payment data is returned
