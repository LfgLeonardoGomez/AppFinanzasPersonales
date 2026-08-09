## MODIFIED Requirements

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

### Requirement: All supplier endpoints require authentication

Every `/api/proveedores` endpoint SHALL require a valid authenticated session (`get_current_user`). Requests without a valid `access_token` cookie SHALL be rejected with 401, and all data access SHALL be scoped to the authenticated user's `negocio_id`.

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
