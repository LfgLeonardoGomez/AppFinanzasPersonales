## ADDED Requirements

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
