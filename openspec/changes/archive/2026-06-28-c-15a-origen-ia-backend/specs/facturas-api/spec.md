## ADDED Requirements

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
