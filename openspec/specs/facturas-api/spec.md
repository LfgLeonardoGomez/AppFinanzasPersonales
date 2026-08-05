# Facturas API Specification

## Purpose

Expose the invoice (factura) management capability over HTTP for authenticated users, building the CRUD API and service layer on top of the `Factura` and `FacturaItem` models established in C-02. Invoices represent supplier debts and are the primary input for the FIFO payment allocation algorithm (RN-FIFO). This capability provides:

- Paginated invoice listing with on-demand `estado` (PENDIENTE/PARCIAL/PAGADA) computed via the FIFO algorithm in memory, never persisted (RN-FAC-09)
- Filtering by supplier, estado, and date range — all applied in Python after FIFO, never in SQL
- Create, read, update (PATCH), and soft-delete with strict per-user isolation (foreign resource → 404, never 403)
- Optional line items (`FacturaItem`) atomically replaced on update
- `fecha_emision` validation against UTC-3 wall clock; `monto_total > 0` enforced in schema and service
- Non-blocking `items_sum_mismatch` warning when line items do not sum to `monto_total` (RN-FAC-04)
- Composite index migration on `(usuario_id, proveedor_id, deleted_at, fecha_emision)` optimizing FIFO queries
- `origen` set to `MANUAL` automatically on creation (RN-FAC-08); IA-assisted origin handled in C-14

The invariants that `estado` and `saldo` are NEVER persisted are preserved throughout. No `factura_id` exists on `Pago` — payments link only to `proveedor_id` (RN-PAG-01).
## Requirements
### Requirement: Invoice listing with on-demand FIFO estado

The system SHALL expose `GET /api/facturas` returning the authenticated user's active invoices (where `deleted_at IS NULL`). Each item in the response SHALL carry its `estado` (PENDIENTE/PARCIAL/PAGADA) computed by the FIFO algorithm applied in memory (RN-FAC-09). The `estado` SHALL NOT be read from or written to any persisted column. The endpoint SHALL accept optional query parameters: `proveedor_id` (UUID), `estado` (EstadoFactura enum), `fecha_desde` (date), and `fecha_hasta` (date). All filtering SHALL be applied in Python AFTER FIFO computation — no SQL WHERE clause SHALL reference `estado`.

#### Scenario: listing returns only the caller's active invoices with computed estado

- **WHEN** an authenticated user requests `GET /api/facturas` and has active invoices with associated payments
- **THEN** the response contains only that user's non-deleted invoices, each with an `estado` derived by the FIFO algorithm from the supplier's active payment pool

#### Scenario: soft-deleted invoices are excluded from the listing

- **WHEN** an invoice has `deleted_at` populated and the user requests the default listing
- **THEN** that invoice does not appear in the response

#### Scenario: estado filter applied in Python after FIFO, not in SQL

- **WHEN** the request supplies `estado=PAGADA`
- **THEN** the service fetches all active invoices first, computes FIFO estado in memory, and then filters the result set — no SQL WHERE clause for `estado` is emitted

#### Scenario: date range filter applied in Python after fetch

- **WHEN** the request supplies `fecha_desde` and/or `fecha_hasta`
- **THEN** the invoices outside the date range are excluded from the response, with the filter applied in Python (not in SQL), after the FIFO pool is computed on the full dataset

#### Scenario: listing scoped to a supplier when proveedor_id is provided

- **WHEN** the request supplies `proveedor_id`
- **THEN** only invoices belonging to that supplier are returned, still with FIFO-computed estado

### Requirement: FIFO-based estado computation (pure in-memory algorithm)

The `_compute_estado_fifo` function SHALL be a pure function (no DB access, no side effects) that receives the list of active facturas for a proveedor (pre-ordered by `fecha_emision ASC, created_at ASC, id ASC` — RN-FIFO-01) and a `pool` Decimal (sum of all active payments for that proveedor — RN-FIFO-02). It SHALL return a mapping of `factura_id → EstadoFactura`. The algorithm SHALL apply payments in FIFO order: `applied = min(pool, factura.monto_total)`; `pool -= applied`; if `applied == 0` → PENDIENTE; if `0 < applied < monto_total` → PARCIAL; if `applied >= monto_total` → PAGADA.

#### Scenario: zero payment pool → all PENDIENTE

- **WHEN** `pool = 0` and there are N active invoices
- **THEN** all N invoices are mapped to PENDIENTE

#### Scenario: pool covers all invoices → all PAGADA

- **WHEN** `pool >= sum(all factura monto_total)`
- **THEN** all invoices are mapped to PAGADA

#### Scenario: partial pool covers first invoice fully and second partially

- **WHEN** `pool` is enough to fully pay the first (oldest) invoice and partially pay the second
- **THEN** the first maps to PAGADA, the second to PARCIAL, and any remaining to PENDIENTE

#### Scenario: exact pool for one invoice maps to PAGADA, not PARCIAL

- **WHEN** `applied == factura.monto_total` (pool equals exactly one invoice's total)
- **THEN** that invoice maps to PAGADA (not PARCIAL)

#### Scenario: deterministic tiebreak by created_at when fecha_emision is equal

- **WHEN** two invoices share the same `fecha_emision`
- **THEN** the one with the earlier `created_at` is allocated first (then `id ASC` as tertiary)

#### Scenario: single invoice with partial payment → PARCIAL

- **WHEN** a single invoice exists and `0 < pool < monto_total`
- **THEN** the invoice maps to PARCIAL

### Requirement: Create invoice

The system SHALL expose `POST /api/facturas` that creates an invoice owned by the authenticated user. The service SHALL verify that the target `proveedor_id` belongs to the authenticated user before persisting (foreign proveedor → 404). The service SHALL validate `fecha_emision` is not in the future using `America/Argentina/Buenos_Aires` (UTC-3, no DST). `monto_total` SHALL be validated as > 0 by both Pydantic schema and service layer. `usuario_id` SHALL be taken from the authenticated session — the payload cannot override it. `origen` SHALL be set to `MANUAL` automatically (RN-FAC-08). If provided line items (`items`) do not sum to `monto_total`, the response SHALL include `items_sum_mismatch = true` (non-blocking — the invoice IS persisted, RN-FAC-04). The response SHALL include the computed `estado` for the created invoice. The endpoint SHALL return status 201.

#### Scenario: create a valid invoice

- **WHEN** an authenticated user POSTs a valid payload with a `proveedor_id` they own, a `fecha_emision` not in the future, and `monto_total > 0`
- **THEN** the invoice is persisted with the caller's `usuario_id`, `origen = MANUAL`, and the response includes the computed `estado` with status 201

#### Scenario: usuario_id is taken from the session, not the payload

- **WHEN** a FacturaCreate payload is submitted by an authenticated user
- **THEN** the persisted `usuario_id` equals the authenticated caller's id, regardless of any payload field

#### Scenario: proveedor belonging to another user returns 404

- **WHEN** the submitted `proveedor_id` belongs to a different user
- **THEN** the response is 404 Not Found and no invoice is persisted

#### Scenario: future fecha_emision returns 422

- **WHEN** `fecha_emision` is a date in the future relative to the UTC-3 wall clock
- **THEN** the response is 422 Unprocessable Entity and no invoice is persisted

#### Scenario: monto_total of zero or negative returns 422

- **WHEN** `monto_total <= 0`
- **THEN** the response is 422 Unprocessable Entity (validated by Pydantic and service)

#### Scenario: items sum mismatch produces non-blocking warning

- **WHEN** the submitted items list does not sum to `monto_total`
- **THEN** the invoice is persisted normally and the response includes `items_sum_mismatch = true`

#### Scenario: items are optional

- **WHEN** the payload omits the `items` field
- **THEN** the invoice is created successfully with an empty items list

### Requirement: Read a single invoice

The system SHALL expose `GET /api/facturas/{id}` returning the invoice with its computed `estado` and full `items` list, only when the invoice belongs to the authenticated user. A foreign or soft-deleted invoice SHALL be indistinguishable from a non-existent one (404, never 403).

#### Scenario: read own invoice

- **WHEN** an authenticated user requests one of their own active invoices by id
- **THEN** the invoice is returned with its FIFO-computed `estado` and full items list

#### Scenario: reading a foreign invoice returns 404

- **WHEN** an authenticated user requests an invoice id that belongs to another user
- **THEN** the response is 404 Not Found (never 403)

#### Scenario: reading a soft-deleted invoice returns 404

- **WHEN** an authenticated user requests an invoice id that has `deleted_at` set
- **THEN** the response is 404 Not Found

### Requirement: Update invoice with ownership check (PATCH semantics)

The system SHALL expose `PATCH /api/facturas/{id}` that updates editable fields (`fecha_emision`, `monto_total`, `numero`, `fecha_vencimiento`, `archivo_url`, `items`) of an invoice owned by the authenticated user. All fields SHALL be optional; only provided (non-None) fields are applied. If `items` is provided (even as an empty list), existing items SHALL be hard-deleted and replaced atomically in the same flush (RN-D4). The ownership check SHALL be enforced in the service layer (foreign → 404, never 403). `proveedor_id` SHALL NOT be changeable via PATCH. If `fecha_emision` is provided, it SHALL be validated as not future (UTC-3). The response SHALL include the updated `estado` and refreshed items list.

#### Scenario: update editable fields of own invoice

- **WHEN** an authenticated user PATCHes a subset of editable fields on their own invoice
- **THEN** only the provided fields are updated, the response includes the recomputed `estado` and current items

#### Scenario: updating a foreign invoice returns 404

- **WHEN** an authenticated user PATCHes an invoice that belongs to another user
- **THEN** the response is 404 Not Found and the foreign invoice is unchanged

#### Scenario: items are replaced atomically on update

- **WHEN** the PATCH payload includes a new `items` list
- **THEN** all previous items are hard-deleted and the new items are inserted in the same transaction

#### Scenario: future fecha_emision in update returns 422

- **WHEN** the PATCH payload includes a `fecha_emision` in the future (UTC-3)
- **THEN** the response is 422 and the invoice is not modified

### Requirement: Soft-delete invoice

The system SHALL expose `DELETE /api/facturas/{id}` that performs a soft delete (sets `deleted_at`) on an invoice owned by the authenticated user, preserving the row and its FK references. Deleting a foreign or already-deleted invoice SHALL return 404. Items SHALL remain in the database (no cascade hard-delete on soft-delete) — items have no soft-delete of their own; they stay but are unreachable via the listing. The endpoint SHALL return 204 No Content. Deleting an invoice does NOT affect any payments (payments link only to `proveedor_id`, not `factura_id` — RN-PAG-01).

#### Scenario: soft delete preserves the row

- **WHEN** an authenticated user deletes their own invoice
- **THEN** the invoice row remains in the database with `deleted_at` populated and the invoice no longer appears in the default listing

#### Scenario: deleting a foreign invoice returns 404

- **WHEN** an authenticated user deletes an invoice that belongs to another user
- **THEN** the response is 404 Not Found and the foreign invoice is not modified

#### Scenario: deleting an already-deleted invoice returns 404

- **WHEN** an authenticated user deletes an invoice that already has `deleted_at` set
- **THEN** the response is 404 Not Found

#### Scenario: soft delete does not affect payments

- **WHEN** an invoice is soft-deleted and the supplier has associated payments
- **THEN** the payment records are unchanged and still reference the `proveedor_id` (not the deleted invoice)

### Requirement: All invoice endpoints require authentication

Every `/api/facturas` endpoint SHALL require a valid authenticated session (`get_current_user`). Requests without a valid `access_token` cookie SHALL be rejected with 401. All data access SHALL be scoped to the authenticated user's `usuario_id`.

#### Scenario: unauthenticated request rejected

- **WHEN** a request reaches any `/api/facturas` endpoint without a valid session cookie
- **THEN** the response is 401 Unauthorized

### Requirement: Service-layer authorization — 404 on foreign resource

All authorization checks SHALL live exclusively in the service layer (`FacturaService`). The router SHALL NOT contain ownership logic. When a resource does not belong to the authenticated user, the service SHALL raise HTTP 404 (not 403) — foreign resources are indistinguishable from non-existent ones to prevent enumeration. The helper `_get_owned_factura(usuario_id, factura_id)` SHALL raise 404 if the factura is missing, soft-deleted, or owned by a different user.

#### Scenario: cross-user isolation — user B cannot access user A's invoices

- **WHEN** user B attempts to GET, PATCH, or DELETE an invoice that belongs to user A
- **THEN** every operation returns 404, and user A's invoice is not modified

### Requirement: Schema validation

The `FacturaCreate` schema SHALL enforce: `proveedor_id` (UUID, required); `fecha_emision` (date, required, not future — Pydantic quick-fail before service re-validates UTC-3); `monto_total` (Decimal, > 0); `items` (list of `FacturaItemCreate`, optional, default empty). `FacturaItemCreate` SHALL enforce: `descripcion` (non-empty string); `cantidad` (Decimal, > 0); `precio_unitario` (Decimal, >= 0). `FacturaUpdate` SHALL make all fields optional, applying the same validators to provided values. `usuario_id` SHALL NOT appear in `FacturaCreate` or `FacturaUpdate`.

#### Scenario: monto_total must be positive

- **WHEN** `FacturaCreate` is constructed with `monto_total = 0` or negative
- **THEN** Pydantic raises a validation error before the request reaches the service

#### Scenario: item cantidad must be positive

- **WHEN** a `FacturaItemCreate` has `cantidad <= 0`
- **THEN** Pydantic raises a validation error

#### Scenario: item descripcion must not be empty

- **WHEN** a `FacturaItemCreate` has an empty or whitespace-only `descripcion`
- **THEN** Pydantic raises a validation error

#### Scenario: FacturaUpdate is fully optional

- **WHEN** a `FacturaUpdate` is constructed with no fields set
- **THEN** it is valid (PATCH semantics — zero fields patched is acceptable)

### Requirement: Composite index migration

The change SHALL include a reversible Alembic migration `0004` (file `20240004_0004_factura_indices.py`, revision `"0004"`, `down_revision = "0003"`) that creates composite index `ix_factura_usuario_proveedor_deleted_emision` on `(usuario_id, proveedor_id, deleted_at, fecha_emision)` on the `factura` table (which already exists from migration 0001). The migration SHALL NOT introduce any `estado` or `saldo` column. Its `downgrade` SHALL drop the index.

#### Scenario: upgrade creates the composite index

- **WHEN** `alembic upgrade head` runs with the database at revision `0003`
- **THEN** the index `ix_factura_usuario_proveedor_deleted_emision` exists on the `factura` table and the head revision becomes `0004`

#### Scenario: downgrade drops the composite index

- **WHEN** `alembic downgrade` of revision `0004` runs
- **THEN** the index is removed and the schema returns to the `0003` state

#### Scenario: migration introduces no derived columns

- **WHEN** the `factura` table is inspected after the migration
- **THEN** no `estado` and no `saldo` column exists

### Requirement: Create endpoint honors optional `origen` field

The `POST /api/facturas` endpoint SHALL accept an optional `origen` field on the request body, typed as the `OrigenDocumento` enum (`MANUAL` | `IA`). When the field is provided, the service SHALL persist the supplied value on the new invoice. When the field is omitted, the service SHALL persist `OrigenDocumento.MANUAL` as the default. The endpoint SHALL return 422 if `origen` is provided with a value that is not a member of the `OrigenDocumento` enum.

#### Scenario: `origen=IA` from a C-15 IA confirmation persists as `IA`

- **WHEN** an authenticated user posts a `FacturaCreate` payload with `origen="IA"` to `POST /api/facturas`
- **THEN** the persisted `Factura.origen` column is `OrigenDocumento.IA` and the response body's `origen` field is `"IA"`

#### Scenario: `origen` omitted defaults to `MANUAL` (backward compat with C-09 manual flow)

- **WHEN** an authenticated user posts a `FacturaCreate` payload without an `origen` field
- **THEN** the persisted `Factura.origen` column is `OrigenDocumento.MANUAL` and the response body's `origen` field is `"MANUAL"`

#### Scenario: invalid `origen` value is rejected with 422

- **WHEN** an authenticated user posts a `FacturaCreate` payload with `origen="INVALID"` (not a member of `OrigenDocumento`)
- **THEN** the endpoint returns HTTP 422 and no row is created

### Requirement: Single-invoice responses carry the supplier name

`FacturaResponse` SHALL populate `proveedor_nombre` with the owning supplier's name. The field already exists on the schema but was never filled, so every consumer had to fall back to the supplier id — which surfaced a UUID to the user. Behaviour mirrors the payment endpoints, which already resolve the name.

#### Scenario: Creating, reading or updating an invoice returns the supplier name

- **WHEN** a client creates, fetches or updates an invoice belonging to the authenticated user
- **THEN** the response's `proveedor_nombre` is the supplier's name

#### Scenario: A soft-deleted supplier yields null, not an id

- **WHEN** the invoice's supplier has been soft-deleted
- **THEN** `proveedor_nombre` is `null` — never the supplier id, and never an error

#### Scenario: Resolving the name does not change ownership rules

- **WHEN** the invoice belongs to another user
- **THEN** the request still returns 404 and no supplier name is resolved or leaked

