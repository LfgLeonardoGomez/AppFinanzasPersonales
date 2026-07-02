# Pagos API Specification

> New capability: HTTP API for payment management (C-10). Introduces the full CRUD for `Pago` on top of the `Pago` SQLModel from C-02. Payments represent money paid to a supplier and feed the FIFO payment pool consumed by `FacturaService` (C-08) and the future cuenta-corriente view (C-12). The capability enforces RN-PAG-01 (no `factura_id`), RN-PAG-02 (`monto > 0`), RN-PAG-03 (`fecha` not future UTC-3), RN-PAG-04 (`metodo` enum, `origen=MANUAL`), RN-PAG-05 (soft delete + free edit). All derived state (`saldo`, `estado`) remains on-demand.

## ADDED Requirements

### Requirement: Payment listing scoped to the authenticated user

The system SHALL expose `GET /api/pagos` returning the authenticated user's active payments (where `deleted_at IS NULL`). The endpoint SHALL accept optional query parameters: `proveedor_id` (UUID) and `page` (int, default 1, 1-indexed). The default page size SHALL be 50. The list SHALL be ordered by `fecha DESC, created_at DESC, id DESC` so the most recent payment surfaces first. When `proveedor_id` is provided, the list SHALL be filtered to that supplier. Foreign `proveedor_id` (owned by another user) SHALL return 404, not an empty list.

#### Scenario: listing returns only the caller's active payments

- **WHEN** an authenticated user requests `GET /api/pagos`
- **THEN** the response contains only that user's non-deleted payments, ordered by `fecha DESC, created_at DESC, id DESC`

#### Scenario: soft-deleted payments are excluded from the listing

- **WHEN** a payment has `deleted_at` populated and the user requests the default listing
- **THEN** that payment does not appear in the response

#### Scenario: listing scoped to a supplier when proveedor_id is provided

- **WHEN** the request supplies `proveedor_id` and that supplier belongs to the authenticated user
- **THEN** only that supplier's payments are returned, still in the same `fecha DESC` order

#### Scenario: proveedor_id belonging to another user returns 404

- **WHEN** the request supplies a `proveedor_id` that belongs to a different user
- **THEN** the response is 404 Not Found and no payments from any supplier are leaked

#### Scenario: pagination with page size 50

- **WHEN** the user has more than 50 active payments and requests page 2
- **THEN** the response contains the next 50 payments, in the same order, and a `total` field reflecting the full active count

### Requirement: Create payment (RN-PAG-01, RN-PAG-02, RN-PAG-03, RN-PAG-04)

The system SHALL expose `POST /api/pagos` that creates a payment owned by the authenticated user, associated to one of the user's suppliers. The service SHALL verify that the target `proveedor_id` exists, is not soft-deleted, and belongs to the authenticated user before persisting (foreign proveedor → 404). `monto` SHALL be validated as > 0 by both Pydantic schema and service layer. `fecha` SHALL be validated by the service as not in the future relative to the `America/Argentina/Buenos_Aires` (UTC-3, no DST) wall clock. `metodo` SHALL be a Pydantic enum. `usuario_id` SHALL be taken from the authenticated session — the payload cannot override it. `origen` SHALL be set to `MANUAL` automatically and SHALL NOT be accepted from the payload. The endpoint SHALL return status 201.

#### Scenario: create a valid payment

- **WHEN** an authenticated user POSTs a valid payload with a `proveedor_id` they own, `monto > 0`, a non-future `fecha`, and a valid `metodo`
- **THEN** the payment is persisted with the caller's `usuario_id`, `origen = MANUAL`, and the response includes the persisted payment with status 201

#### Scenario: usuario_id is taken from the session, not the payload

- **WHEN** a `PagoCreate` payload is submitted by an authenticated user
- **THEN** the persisted `usuario_id` equals the authenticated caller's id, regardless of any payload field

#### Scenario: origen is set to MANUAL automatically

- **WHEN** a `PagoCreate` payload is submitted
- **THEN** the persisted `origen` equals `MANUAL` and the service never accepts `origen` from the payload (the schema has no such field)

#### Scenario: proveedor belonging to another user returns 404

- **WHEN** the submitted `proveedor_id` belongs to a different user
- **THEN** the response is 404 Not Found and no payment is persisted

#### Scenario: proveedor that is soft-deleted returns 404

- **WHEN** the submitted `proveedor_id` has `deleted_at` set
- **THEN** the response is 404 Not Found and no payment is persisted

#### Scenario: future fecha returns 422

- **WHEN** `fecha` is a date in the future relative to the UTC-3 wall clock
- **THEN** the response is 422 Unprocessable Entity and no payment is persisted

#### Scenario: monto of zero or negative returns 422

- **WHEN** `monto <= 0`
- **THEN** the response is 422 Unprocessable Entity (validated by Pydantic and re-validated by the service)

#### Scenario: invalid metodo returns 422

- **WHEN** `metodo` is a value outside the `EFECTIVO` / `TRANSFERENCIA` / `TARJETA` / `MERCADOPAGO` / `OTRO` enum
- **THEN** the response is 422 Unprocessable Entity

#### Scenario: comprobante_url is optional

- **WHEN** the payload omits the `comprobante_url` field
- **THEN** the payment is created successfully with `comprobante_url = null`

### Requirement: Read a single payment

The system SHALL expose `GET /api/pagos/{id}` returning a single payment only when it belongs to the authenticated user. A foreign or soft-deleted payment SHALL be indistinguishable from a non-existent one (404, never 403).

#### Scenario: read own payment

- **WHEN** an authenticated user requests one of their own active payments by id
- **THEN** the payment is returned with all its fields (id, usuario_id, proveedor_id, monto, fecha, metodo, comprobante_url, origen, created_at, updated_at)

#### Scenario: reading a foreign payment returns 404

- **WHEN** an authenticated user requests a payment id that belongs to another user
- **THEN** the response is 404 Not Found (never 403)

#### Scenario: reading a soft-deleted payment returns 404

- **WHEN** an authenticated user requests a payment id that has `deleted_at` set
- **THEN** the response is 404 Not Found

### Requirement: Update payment with ownership check (PATCH semantics)

The system SHALL expose `PATCH /api/pagos/{id}` that updates editable fields (`monto`, `fecha`, `metodo`, `comprobante_url`) of a payment owned by the authenticated user. All fields SHALL be optional; only provided (non-None) fields are applied. `proveedor_id` SHALL NOT be changeable via PATCH (re-linking a payment to a different supplier would corrupt the FIFO pool's history). `usuario_id` SHALL NOT be changeable. `origen` SHALL NOT be changeable. If `monto` is provided, it SHALL be > 0 (Pydantic + service). If `fecha` is provided, it SHALL be ≤ today in UTC-3. The ownership check SHALL be enforced in the service layer (foreign → 404, never 403).

#### Scenario: update editable fields of own payment

- **WHEN** an authenticated user PATCHes a subset of editable fields on their own payment
- **THEN** only the provided fields are updated and the response includes the updated payment

#### Scenario: updating a foreign payment returns 404

- **WHEN** an authenticated user PATCHes a payment that belongs to another user
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

The system SHALL expose `DELETE /api/pagos/{id}` that performs a soft delete (sets `deleted_at`) on a payment owned by the authenticated user, preserving the row and its FK references. Deleting a foreign or already-deleted payment SHALL return 404. The endpoint SHALL return 204 No Content on success. Deleting a payment does NOT directly affect any invoice (payments link only to `proveedor_id`, not `factura_id` — RN-PAG-01); the next on-demand re-aggregation of the FIFO pool (C-08 / C-12) automatically excludes the soft-deleted payment.

#### Scenario: soft delete preserves the row

- **WHEN** an authenticated user deletes their own payment
- **THEN** the payment row remains in the database with `deleted_at` populated and the payment no longer appears in the default listing

#### Scenario: deleting a foreign payment returns 404

- **WHEN** an authenticated user deletes a payment that belongs to another user
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

Every `/api/pagos` endpoint SHALL require a valid authenticated session (`get_current_user`). Requests without a valid `access_token` cookie SHALL be rejected with 401. All data access SHALL be scoped to the authenticated user's `usuario_id`.

#### Scenario: unauthenticated request rejected

- **WHEN** a request reaches any `/api/pagos` endpoint without a valid session cookie
- **THEN** the response is 401 Unauthorized

### Requirement: Service-layer authorization — 404 on foreign resource

All authorization checks SHALL live exclusively in the service layer (`PagoService`). The router SHALL NOT contain ownership logic. When a resource does not belong to the authenticated user, the service SHALL raise HTTP 404 (not 403) — foreign resources are indistinguishable from non-existent ones to prevent enumeration. The helper `_get_owned_pago(usuario_id, pago_id)` SHALL raise 404 if the pago is missing, soft-deleted, or owned by a different user.

#### Scenario: cross-user isolation — user B cannot access user A's payments

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

The `PagoCreate` schema SHALL enforce: `proveedor_id` (UUID, required); `monto` (Decimal, > 0, Pydantic `Field(gt=0)`); `fecha` (date, required); `metodo` (MetodoPago enum, required); `comprobante_url` (Optional[str]). `usuario_id`, `origen`, and any other internal field SHALL NOT appear in the schema. The `PagoUpdate` schema SHALL make `monto`, `fecha`, `metodo`, and `comprobante_url` all optional, applying the same validators to provided values. `proveedor_id`, `usuario_id`, and `origen` SHALL NOT appear in `PagoUpdate`.

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
