## ADDED Requirements

### Requirement: Edit-mode PagoFormPage displays the supplier name from PagoResponse.proveedor_nombre

The system SHALL display the supplier's `nombre` in the readonly supplier field of the `PagoFormPage` edit mode, using the new `PagoResponse.proveedor_nombre` field (populated by the backend per the `pagos-backend` delta). When the field is populated (the supplier is active), the display SHALL be the supplier's name (e.g., "YPF S.A."). When the field is `None` (the supplier is soft-deleted), the display SHALL fall back to the supplier's UUID (the previous behavior, preserved for the soft-deleted case). The fix removes the UUID-as-name fallback that c-11 introduced as a workaround for the missing backend field; the workaround is no longer needed because the backend now provides the field.

#### Scenario: edit-mode display shows the supplier's name when the field is populated

- **WHEN** the user opens `/pagos/:id/editar` for a pago whose `PagoResponse.proveedor_nombre` is "YPF S.A."
- **THEN** the readonly supplier field displays "YPF S.A." (NOT the UUID)

#### Scenario: edit-mode display falls back to UUID when the field is None

- **WHEN** the user opens `/pagos/:id/editar` for a pago whose `PagoResponse.proveedor_nombre` is `None` (the supplier was soft-deleted)
- **THEN** the readonly supplier field displays the supplier's UUID (the fallback behavior is preserved for the soft-deleted case)

#### Scenario: the readonly supplier field is structurally read-only (RN-PAG-01)

- **WHEN** the user opens `/pagos/:id/editar`
- **THEN** the readonly supplier field has no `<input>`, `<select>`, or other form control; the user cannot change the supplier (the backend PATCH cannot change `proveedor_id` per the `pagos-backend` D7 invariant; the frontend mirrors this)
