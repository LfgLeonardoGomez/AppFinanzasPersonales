# Proveedores API Specification

## Purpose

Expose the supplier (proveedor) management capability over HTTP for authenticated users, building the CRUD API and service layer on top of the `Proveedor` model and balance-aggregate query delivered in C-02. Suppliers are the root of the business domain: every invoice and payment hangs off a `proveedor_id`. This capability provides:

- Paginated supplier listing with on-demand balance (`saldo`) computed in a single aggregate query (RN-SALDO, no N+1)
- Ordering by name (normalized) or by the computed balance expression
- Create, read, update, and soft-delete with strict per-negocio isolation (foreign resource → 404, never 403)
- CUIT format validation in the backend (RN-PROV-02)
- Name search for supplier linkage (RN-VINC)
- The supporting `(usuario_id, LOWER(nombre))` index migration

The invariants that `saldo` and `estado` are NEVER persisted are preserved throughout.


> **Actualizado por C-28 (D-27):** el eje de aislamiento de esta capability pasó de `usuario_id` a `negocio_id`. Las referencias a `usuario_id` que quedan arriba describen migraciones históricas (los índices que existieron hasta la revisión 0005) y se conservan como registro; la migración 0006 los reemplazó por sus equivalentes liderados por `negocio_id`. Ver la capability `negocio-scoping`.
## Requirements

### Requirement: Paginated supplier listing with on-demand balance

The system SHALL expose `GET /api/proveedores` returning the authenticated user's **active** suppliers (`deleted_at IS NULL`), paginated, each item carrying its `saldo` computed on-demand as `SUM(facturas activas.monto_total) − SUM(pagos activos.monto)` (RN-SALDO). The `saldo` SHALL NOT be read from or written to any persisted column. The supplier balances for the returned page SHALL be obtained through a single aggregate SQL query (one `GROUP BY`), never one query per supplier (no N+1). The endpoint SHALL accept a `page` parameter (1-based) and an `order_by` parameter accepting only `nombre` or `saldo`.

#### Scenario: listing returns only the caller's active suppliers with balance

- **WHEN** an authenticated user requests `GET /api/proveedores` and has active suppliers with active invoices and payments
- **THEN** the response contains only that user's non-deleted suppliers, each with a `saldo` equal to the sum of its active invoices minus the sum of its active payments

#### Scenario: soft-deleted suppliers are excluded from the listing

- **WHEN** a supplier has `deleted_at` populated and the user requests the default listing
- **THEN** that supplier does not appear in the response

#### Scenario: balance computed in a single aggregate query

- **WHEN** the listing is built for a user with N suppliers
- **THEN** the supplier balances are produced by a single `GROUP BY` aggregate query, not by N per-supplier balance queries

#### Scenario: invalid order_by is rejected

- **WHEN** the request supplies `order_by` with a value other than `nombre` or `saldo`
- **THEN** the request is rejected with a 422 validation error

### Requirement: Ordering by name or by computed balance

The supplier listing SHALL support ordering by `nombre` (case-insensitive, normalized) and by the **computed** `saldo` aggregate expression. Because `saldo` is derived and not a stored column, ordering by `saldo` SHALL be applied on the aggregate expression itself within the same query (not by referencing a non-existent column and not by sorting in Python after a full fetch).

#### Scenario: order by name

- **WHEN** the user requests `GET /api/proveedores?order_by=nombre`
- **THEN** the suppliers are returned ordered by `nombre` case-insensitively (ascending)

#### Scenario: order by computed balance

- **WHEN** the user requests `GET /api/proveedores?order_by=saldo`
- **THEN** the suppliers are returned ordered by their computed `saldo` (descending: largest debt first), with the ordering applied inside the aggregate query

### Requirement: Create supplier

The system SHALL expose `POST /api/proveedores` that creates a supplier owned by the authenticated caller's **negocio**. The created supplier SHALL be persisted with `negocio_id` set to the caller's `negocio_id` (the client SHALL NOT be able to set `negocio_id`), `creado_por_usuario_id` set to the caller's user id, `categoria` defaulting to `OTRO` when omitted, and `deleted_at = null`. The response SHALL include the supplier with `saldo = 0.00`.

#### Scenario: create a supplier

- **WHEN** an authenticated user POSTs a valid supplier payload (nombre present)
- **THEN** the supplier is persisted with the caller's `negocio_id` and `creado_por_usuario_id`, returned with status 201 and a `saldo` of `0.00`

#### Scenario: negocio_id is taken from the session, not the payload

- **WHEN** the payload attempts to include a `negocio_id` different from the caller's
- **THEN** the persisted supplier still belongs to the authenticated caller's negocio (the payload value is ignored)

#### Scenario: duplicate names are allowed

- **WHEN** a user creates two suppliers with the identical `nombre`
- **THEN** both are created successfully (nombre is not unique, RN-PROV-01)

#### Scenario: a teammate sees the supplier immediately

- **WHEN** a user creates a supplier and another active user of the same negocio lists suppliers
- **THEN** the new supplier appears in the teammate's listing

### Requirement: Read a single supplier

The system SHALL expose `GET /api/proveedores/{id}` returning the supplier with its on-demand `saldo`, only when the supplier belongs to the authenticated caller's negocio. A supplier that belongs to another negocio SHALL be indistinguishable from a non-existent one.

#### Scenario: read own supplier

- **WHEN** an authenticated user requests one of their negocio's suppliers by id
- **THEN** the supplier is returned with its computed `saldo`

#### Scenario: reading a foreign supplier returns 404

- **WHEN** an authenticated user requests a supplier id that belongs to another negocio
- **THEN** the response is 404 Not Found (never 403)

### Requirement: Update supplier with ownership check

The system SHALL expose `PATCH /api/proveedores/{id}` that updates editable fields (`nombre`, `cuit`, `telefono`, `categoria`, `notas`) of a supplier owned by the authenticated caller's negocio. The ownership check SHALL be enforced in the service layer by filtering on `negocio_id`; updating a supplier owned by another negocio SHALL return **404** (never 403). The update SHALL NOT allow changing `negocio_id`.

#### Scenario: update own supplier

- **WHEN** an authenticated user PATCHes editable fields of a supplier of their own negocio
- **THEN** the supplier is updated and returned with its computed `saldo`

#### Scenario: updating a foreign supplier returns 404

- **WHEN** an authenticated user PATCHes a supplier that belongs to another negocio
- **THEN** the response is 404 Not Found and the foreign supplier is unchanged

#### Scenario: a teammate can update the same supplier

- **WHEN** a user PATCHes a supplier created by another user of the same negocio
- **THEN** the update succeeds

### Requirement: Soft-delete supplier reporting dependencies

The system SHALL expose `DELETE /api/proveedores/{id}` that performs a **soft delete** (sets `deleted_at`, RN-PROV-03) on a supplier owned by the caller's negocio, preserving the row and its foreign-key references intact. Deleting a foreign supplier SHALL return **404**. The service SHALL determine whether the supplier has associated active invoices or payments and report a `tiene_dependencias` boolean (RN-PROV-04) so the caller can decide whether confirmation was required; the deletion SHALL NOT be blocked by the presence of dependencies.

#### Scenario: soft delete preserves the row and FKs

- **WHEN** an authenticated user deletes their own supplier
- **THEN** the supplier row remains in the database with `deleted_at` populated, its invoices and payments keep their `proveedor_id`, and the supplier no longer appears in the default listing

#### Scenario: delete reports dependencies present

- **WHEN** the deleted supplier has at least one active invoice or active payment
- **THEN** the response reports `tiene_dependencias = true`

#### Scenario: delete reports no dependencies

- **WHEN** the deleted supplier has no active invoices or payments
- **THEN** the response reports `tiene_dependencias = false`

#### Scenario: deleting a foreign supplier returns 404

- **WHEN** an authenticated user deletes a supplier that belongs to another negocio
- **THEN** the response is 404 Not Found and the foreign supplier is not modified

### Requirement: Search suppliers by name for linkage

The system SHALL expose `GET /api/proveedores/buscar?nombre=` returning the authenticated user's **active** suppliers whose `nombre` matches the query after normalization (lowercase, trimmed), supporting RN-VINC linkage. The search SHALL return all matches (it SHALL NOT assume a single result), restricted to the caller's suppliers.

#### Scenario: search returns normalized matches for the caller only

- **WHEN** an authenticated user searches by a name fragment that matches several of their active suppliers (case- and accent-insensitively)
- **THEN** all matching active suppliers owned by the caller are returned, and no supplier owned by another negocio is included

#### Scenario: search excludes soft-deleted suppliers

- **WHEN** a matching supplier has been soft-deleted
- **THEN** it is not included in the search results

### Requirement: CUIT format validation

When a supplier payload includes a non-empty `cuit`, the system SHALL validate it against the format `^\d{2}-\d{8}-\d{1}$` (RN-PROV-02). Validation SHALL occur in the backend (Pydantic schema and/or service layer), never relying on the frontend. An absent or null `cuit` SHALL be accepted.

#### Scenario: valid CUIT accepted

- **WHEN** a supplier is created or updated with `cuit = "20-12345678-9"`
- **THEN** the request succeeds

#### Scenario: malformed CUIT rejected

- **WHEN** a supplier is created or updated with a `cuit` that does not match `^\d{2}-\d{8}-\d{1}$` (for example `"20123456789"`)
- **THEN** the request is rejected with a 422 validation error and the supplier is not persisted

#### Scenario: missing CUIT accepted

- **WHEN** a supplier is created without a `cuit`
- **THEN** the request succeeds and `cuit` is stored as null

### Requirement: All supplier endpoints require authentication

Every `/api/proveedores` endpoint SHALL require a valid authenticated session (`get_current_user`). Requests without a valid `access_token` cookie SHALL be rejected with 401, and all data access SHALL be scoped to the authenticated caller's negocio's `negocio_id`.

#### Scenario: unauthenticated request rejected

- **WHEN** a request reaches any `/api/proveedores` endpoint without a valid session
- **THEN** the response is 401 Unauthorized

#### Scenario: deactivated user rejected

- **WHEN** a request reaches any `/api/proveedores` endpoint with a valid token belonging to a user with `desactivado = true`
- **THEN** the response is 401 Unauthorized

### Requirement: Supplier name index migration

The change SHALL include a reversible Alembic migration `0003` (revision `"0003"`, `down_revision = "0002"`) that creates a composite index on `proveedor` supporting normalized name search and name ordering. To make the index usable by case-insensitive search, the index SHALL be expression-based on `LOWER(nombre)` (or an equivalent collation-aware definition). Following migration `0006`, the leading column of this index SHALL be `negocio_id` rather than `usuario_id`, so that the index keeps serving the scoped name search and ordering. The migration SHALL NOT create any `saldo` or `estado` column and its `downgrade` SHALL drop the index.

#### Scenario: upgrade creates the name index

- **WHEN** `alembic upgrade head` runs with the database at revision `0002`
- **THEN** a composite index supporting `LOWER(nombre)` search exists on the `proveedor` table and the head revision becomes `0003`

#### Scenario: the scoped name index follows the negocio axis

- **WHEN** the schema is inspected after migration `0006`
- **THEN** the composite index on `proveedor` leads with `negocio_id` and still covers `LOWER(nombre)`
