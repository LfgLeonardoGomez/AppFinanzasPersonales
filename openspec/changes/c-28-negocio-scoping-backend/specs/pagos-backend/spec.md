## MODIFIED Requirements

### Requirement: Payment listing scoped to the authenticated user

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

## ADDED Requirements

### Requirement: Payment endpoints reject deactivated users

Every `/api/pagos` endpoint SHALL reject a request whose authenticated user has `desactivado = true` with **401**, independently of token validity, and SHALL scope all data access to the caller's `negocio_id`.

#### Scenario: deactivated user rejected

- **WHEN** a request reaches any `/api/pagos` endpoint with a valid token belonging to a deactivated user
- **THEN** the response is 401 Unauthorized and no payment data is returned
