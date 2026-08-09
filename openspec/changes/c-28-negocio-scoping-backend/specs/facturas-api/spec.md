## MODIFIED Requirements

### Requirement: Create invoice

The system SHALL expose `POST /api/facturas` that creates an invoice owned by the authenticated caller's **negocio**. The service SHALL verify that the target `proveedor_id` belongs to the caller's negocio before persisting (foreign proveedor → 404). The service SHALL validate `fecha_emision` is not in the future using `America/Argentina/Buenos_Aires` (UTC-3, no DST). `monto_total` SHALL be validated as > 0 by both Pydantic schema and service layer. `negocio_id` SHALL be taken from the authenticated session — the payload cannot override it — and `creado_por_usuario_id` SHALL be set to the caller's user id. `origen` SHALL be set to `MANUAL` automatically (RN-FAC-08) unless the client supplies `IA` (D-18). If provided line items (`items`) do not sum to `monto_total`, the response SHALL include `items_sum_mismatch = true` (non-blocking — the invoice IS persisted, RN-FAC-04). The response SHALL include the computed `estado` for the created invoice. The endpoint SHALL return status 201.

#### Scenario: create a valid invoice

- **WHEN** an authenticated user POSTs a valid payload with a `proveedor_id` owned by their negocio, a `fecha_emision` not in the future, and `monto_total > 0`
- **THEN** the invoice is persisted with the caller's `negocio_id` and `creado_por_usuario_id`, and the response includes the computed `estado` with status 201

#### Scenario: negocio_id is taken from the session, not the payload

- **WHEN** a FacturaCreate payload is submitted by an authenticated user
- **THEN** the persisted `negocio_id` equals the authenticated caller's `negocio_id`, regardless of any payload field

#### Scenario: proveedor belonging to another negocio returns 404

- **WHEN** the submitted `proveedor_id` belongs to a different negocio
- **THEN** the response is 404 Not Found and no invoice is persisted

#### Scenario: a teammate's supplier is accepted

- **WHEN** the submitted `proveedor_id` was created by a different user of the same negocio
- **THEN** the invoice is created successfully

### Requirement: All invoice endpoints require authentication

Every `/api/facturas` endpoint SHALL require a valid authenticated session (`get_current_user`). Requests without a valid `access_token` cookie SHALL be rejected with 401. All data access SHALL be scoped to the authenticated user's `negocio_id`.

#### Scenario: unauthenticated request rejected

- **WHEN** a request reaches any `/api/facturas` endpoint without a valid session cookie
- **THEN** the response is 401 Unauthorized

#### Scenario: deactivated user rejected

- **WHEN** a request reaches any `/api/facturas` endpoint with a valid token belonging to a user with `desactivado = true`
- **THEN** the response is 401 Unauthorized

### Requirement: Service-layer authorization — 404 on foreign resource

All authorization checks SHALL live exclusively in the service layer (`FacturaService`). The router SHALL NOT contain ownership logic. When a resource does not belong to the authenticated caller's negocio, the service SHALL raise HTTP 404 (not 403) — foreign resources are indistinguishable from non-existent ones to prevent enumeration. The helper `_get_owned_factura(negocio_id, factura_id)` SHALL raise 404 if the factura is missing, soft-deleted, or owned by a different negocio.

#### Scenario: cross-negocio isolation — negocio B cannot access negocio A's invoices

- **WHEN** a user of negocio B attempts to GET, PATCH, or DELETE an invoice that belongs to negocio A
- **THEN** every operation returns 404, and negocio A's invoice is not modified

#### Scenario: same-negocio access is permitted

- **WHEN** a user GETs, PATCHes or DELETEs an invoice created by another user of the same negocio
- **THEN** the operation succeeds

### Requirement: Schema validation

The `FacturaCreate` schema SHALL enforce: `proveedor_id` (UUID, required); `fecha_emision` (date, required, not future — Pydantic quick-fail before service re-validates UTC-3); `monto_total` (Decimal, > 0); `items` (list of `FacturaItemCreate`, optional, default empty). `FacturaItemCreate` SHALL enforce: `descripcion` (non-empty string); `cantidad` (Decimal, > 0); `precio_unitario` (Decimal, >= 0). `FacturaUpdate` SHALL make all fields optional, applying the same validators to provided values. Neither `usuario_id` nor `negocio_id` SHALL appear in `FacturaCreate` or `FacturaUpdate`.

#### Scenario: scoping fields are not accepted from the wire

- **WHEN** a `FacturaCreate` or `FacturaUpdate` payload includes `usuario_id` or `negocio_id`
- **THEN** the value is never used to determine ownership; the persisted `negocio_id` comes from the session
