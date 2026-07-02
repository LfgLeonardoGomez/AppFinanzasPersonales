## ADDED Requirements

### Requirement: PagoResponse includes proveedor_nombre populated by the service

The system SHALL include an optional `proveedor_nombre: Optional[str]` field on the `PagoResponse` schema (in `app/schemas/pago.py`). The field SHALL be `None` by default for backward compatibility with any caller that constructs a `PagoResponse` directly (e.g., older tests). The service layer (`PagoService`) SHALL populate the field in the response serializer for all 5 paths that return a `PagoResponse`: `crear`, `actualizar`, `obtener`, `listar_por_usuario`, `listar_por_proveedor`. For single-pago paths (`obtener`, `crear`, `actualizar`), the related `Proveedor` is already loaded; the service passes `proveedor_nombre=pago.proveedor.nombre`. For list paths, the service does a single targeted lookup (`SELECT id, nombre FROM proveedor WHERE id IN (...)`) and maps names to pagos by `proveedor_id`. When the related `Proveedor` is soft-deleted (`deleted_at IS NOT NULL`), the field SHALL be `None` (not 404, not 500; the pago remains valid and the supplier's absence is informational, not an error).

#### Scenario: a payment's response includes the supplier's name when the supplier is active

- **WHEN** a `Pago` is created or fetched and the related `Proveedor` is active (not soft-deleted)
- **THEN** the `PagoResponse.proveedor_nombre` field is the supplier's `nombre` (e.g., "YPF S.A.")

#### Scenario: a payment's response includes None when the supplier is soft-deleted

- **WHEN** a `Pago` is fetched and the related `Proveedor` has `deleted_at` populated (the supplier was soft-deleted after the pago was created, per RN-PROV-04)
- **THEN** the `PagoResponse.proveedor_nombre` field is `None`, the response is 200 OK, and no error is raised

#### Scenario: list endpoint includes proveedor_nombre for all rows

- **WHEN** a list endpoint (`listar_por_usuario` or `listar_por_proveedor`) returns multiple pagos
- **THEN** each `PagoResponse.proveedor_nombre` field is populated (or `None` if the supplier is soft-deleted) and the list response is one extra SQL round-trip (a single `SELECT id, nombre FROM proveedor WHERE id IN (...)` for the page's pagos)

#### Scenario: backward compatibility is preserved for direct PagoResponse construction

- **WHEN** a test or third-party caller constructs a `PagoResponse` directly without supplying `proveedor_nombre`
- **THEN** the field defaults to `None` and no validation error is raised; existing tests and consumers are unaffected

#### Scenario: aislamiento multi-tenant is preserved

- **WHEN** a `Pago` belongs to user A and is fetched by user B
- **THEN** the response is 404 Not Found (the isolation helper `_get_owned_pago` raises 404 before the response serializer runs); `proveedor_nombre` is never exposed to a user who does not own the pago
