## MODIFIED Requirements

### Requirement: Service-layer authorization — 404 on foreign supplier

All authorization checks SHALL live exclusively in the service layer (`ProveedorService`). The router SHALL NOT contain ownership logic. When the requested supplier does not belong to the authenticated caller's **negocio**, the service SHALL raise HTTP 404 (not 403) — foreign resources are indistinguishable from non-existent ones to prevent enumeration. The same 404 SHALL be returned for missing suppliers and for the negocio's own suppliers that have been soft-deleted. A supplier belonging to the caller's negocio SHALL be accessible regardless of which user of that negocio created it.

#### Scenario: cross-negocio isolation on the cuenta-corriente endpoint

- **WHEN** a user of negocio B requests the cuenta-corriente of a supplier belonging to negocio A
- **THEN** the response is 404 Not Found and no data from negocio A is leaked

#### Scenario: soft-deleted supplier of the caller's own negocio returns 404

- **WHEN** a user requests the cuenta-corriente of a supplier of their negocio that has been soft-deleted
- **THEN** the response is 404 Not Found

#### Scenario: a teammate's supplier is accessible

- **WHEN** a user requests the cuenta-corriente of a supplier created by another user of the same negocio
- **THEN** the response is 200 and contains the supplier's `saldo`, `facturas_con_estado` and `historial`

### Requirement: Cuenta-corriente endpoint returns the triple per supplier

The system SHALL expose `GET /api/proveedores/{proveedor_id}/cuenta-corriente` returning a JSON document with three blocks: `saldo` (Decimal, signed: `>0` deuda, `=0` al día, `<0` a favor), `facturas_con_estado` (a list of the supplier's active invoices, each annotated with its FIFO-computed `estado` of `PENDIENTE` / `PARCIAL` / `PAGADA`), and `historial` (a chronologically-merged list of the supplier's active invoices as `FACTURA` rows and active payments as `PAGO` rows, ordered by `(fecha ASC, created_at ASC, id ASC)`, with a `saldo_acumulado` field on every entry reflecting the running balance at that row). The endpoint SHALL require a valid authenticated session and SHALL reject deactivated users with 401. The endpoint SHALL return 404 if the supplier does not exist, is soft-deleted, or belongs to a different **negocio** — never 403. The endpoint SHALL NOT persist any derived value. The endpoint SHALL have no request body and no query parameters.

#### Scenario: supplier with invoices and payments returns the full triple

- **WHEN** an authenticated user requests `GET /api/proveedores/{proveedor_id}/cuenta-corriente` for a supplier of their negocio that has both active invoices and active payments
- **THEN** the response contains `saldo`, `facturas_con_estado` with a FIFO `estado` per invoice, and `historial` with `saldo_acumulado` on every row

#### Scenario: supplier with no movements returns an empty triple

- **WHEN** an authenticated user requests the endpoint for a supplier of their negocio that has no active invoices and no active payments
- **THEN** the response contains `saldo = 0.00` and empty `facturas_con_estado` and `historial` lists

#### Scenario: unauthenticated request rejected

- **WHEN** the endpoint is reached without a valid session cookie
- **THEN** the response is 401 Unauthorized

#### Scenario: deactivated user rejected

- **WHEN** the endpoint is reached with a valid token belonging to a user with `desactivado = true`
- **THEN** the response is 401 Unauthorized

#### Scenario: foreign supplier returns 404

- **WHEN** an authenticated user requests the endpoint for a supplier that belongs to a different negocio
- **THEN** the response is 404 Not Found and no data from the foreign supplier is leaked

#### Scenario: soft-deleted supplier returns 404

- **WHEN** an authenticated user requests the endpoint for a supplier of their negocio that has been soft-deleted
- **THEN** the response is 404 Not Found

#### Scenario: missing supplier returns 404

- **WHEN** an authenticated user requests the endpoint for a non-existent supplier id
- **THEN** the response is 404 Not Found
