## ADDED Requirements

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
