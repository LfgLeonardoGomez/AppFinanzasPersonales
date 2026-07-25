# Proveedores Frontend Specification (Delta)

## Purpose

This is a **delta** to the canonical `proveedores-frontend` spec archived in C-07 (`openspec/changes/archive/2026-06-21-c-07-proveedores-frontend/specs/proveedores-frontend/spec.md`). The canonical spec is **preserved** and remains the source of truth for all unchanged requirements. This delta documents the requirements that **change** in C-19: the create/edit supplier modal, which currently is implemented as a custom backdrop+click-outside pattern, SHALL be migrated to a properly accessible dialog that satisfies the cross-cutting `frontend-ui-polish` capability.

No other requirement in the canonical `proveedores-frontend` spec is modified. The list view, the autocomplete, the auth gating, the TanStack Query usage, the CUIT validation, the dependency-aware delete flow, and the route structure all remain as documented in C-07.

## RENAMED Requirements

- FROM: `### Requirement: Create and edit supplier via modal form`
- TO: `### Requirement: Create and edit supplier via accessible dialog form`
- FROM: `### Requirement: Two-step delete with dependency confirmation (RN-PROV-04)`
- TO: `### Requirement: Delete confirmation uses an alertdialog (RN-PROV-04)`

## MODIFIED Requirements

### Requirement: Create and edit supplier via accessible dialog form

The `ProveedorForm` SHALL be rendered inside an accessible dialog (the `frontend-ui-polish` `role="dialog"` pattern) instead of the previous custom modal. In create mode the dialog calls `POST /api/proveedores`; in edit mode it calls `PATCH /api/proveedores/{id}`. The form SHALL include the same fields as before: `nombre` (required), `cuit` (optional), `telefono` (optional), `categoria` (select: SERVICIO / OTRO, defaults to OTRO), `notas` (optional). The frontend SHALL enforce `nombre` non-emptiness client-side before submitting; the backend (Pydantic) is the final authority for CUIT format validation. A 422 response from the backend SHALL be displayed in the form. The form SHALL reset after a successful save and SHALL pre-fill existing values when opened in edit mode. The dialog SHALL close on `Esc`, SHALL trap focus while open, and SHALL return focus to the trigger (the "Nuevo proveedor" or "Editar" button) when closed. The dialog MAY close on backdrop click (this is a non-destructive form, so backdrop close is acceptable; the destructive `DeleteProveedorDialog` is the only `alertdialog` and does not close on backdrop).

The following scenarios from the C-07 canonical spec are **preserved unchanged** and re-stated here only to anchor the reader: "submit with empty nombre shows client-side error and does not call API", "valid create payload calls POST and invalidates the list", "valid edit payload calls PATCH and invalidates the list", "CUIT with wrong format shows client hint", "backend 422 error is rendered in the form", "edit mode pre-fills existing supplier values", and "categoria select renders all enum options".

#### Scenario: dialog has accessible role, label, and modal semantics

- **WHEN** the user clicks "Nuevo proveedor" or "Editar" on a supplier row
- **THEN** the create/edit form is rendered inside an element with `role="dialog"`, `aria-modal="true"`, and an `aria-label` of "Formulario de proveedor"

#### Scenario: dialog opens with focus on the first field

- **WHEN** the create or edit dialog opens
- **THEN** the `nombre` input (the first focusable form field) receives focus

#### Scenario: dialog closes with Esc and returns focus to the trigger

- **WHEN** the create or edit dialog is open and the user presses `Esc`
- **THEN** the dialog closes, no submit is issued, and focus returns to the "Nuevo proveedor" or "Editar" trigger button

#### Scenario: dialog traps focus inside the form

- **WHEN** the create or edit dialog is open and the user presses `Tab` past the last field or `Shift+Tab` before the first field
- **THEN** focus cycles within the form fields and does not escape to the underlying page

#### Scenario: dialog closes on backdrop click (non-destructive form)

- **WHEN** the create or edit dialog is open and the user clicks the backdrop outside the form
- **THEN** the dialog closes without submitting, no HTTP request is made, and focus returns to the trigger

#### Scenario: dialog closes on Cancel and returns focus to the trigger

- **WHEN** the create or edit dialog is open and the user clicks "Cancelar"
- **THEN** the dialog closes without submitting, no HTTP request is made, and focus returns to the trigger

#### Scenario: submit with empty nombre shows client-side error and does not call API

- **WHEN** the user submits the form with an empty `nombre` field
- **THEN** a validation error is shown inline and no HTTP request is made

#### Scenario: valid create payload calls POST and invalidates the list

- **WHEN** the user fills in a valid `nombre` and submits in create mode
- **THEN** `POST /api/proveedores` is called with the correct payload, on success a success toast appears, the dialog closes, focus returns to the trigger, and the supplier list is refetched

#### Scenario: valid edit payload calls PATCH and invalidates the list

- **WHEN** the user edits a supplier and submits in edit mode
- **THEN** `PATCH /api/proveedores/{id}` is called with the updated fields, on success a success toast appears, the dialog closes, focus returns to the trigger, and the supplier list is refetched

#### Scenario: CUIT with wrong format shows client hint

- **WHEN** the user enters a CUIT that does not match `^\d{2}-\d{8}-\d{1}$` and blurs the field
- **THEN** a format hint "Formato esperado: XX-XXXXXXXX-X" is shown; the form is not blocked from submitting (backend is the authority)

#### Scenario: backend 422 error is rendered in the form

- **WHEN** the backend responds with a 422 validation error (e.g. malformed CUIT)
- **THEN** the form displays a backend error message without closing

#### Scenario: edit mode pre-fills existing supplier values

- **WHEN** the form is opened in edit mode for an existing supplier
- **THEN** all editable fields are pre-populated with the supplier's current values

#### Scenario: categoria select renders all enum options

- **WHEN** the form is rendered in create or edit mode
- **THEN** the `categoria` select contains exactly the options SERVICIO and OTRO

### Requirement: Delete confirmation uses an alertdialog (RN-PROV-04)

The `DeleteProveedorDialog` (the destructive confirmation that appears when `tiene_dependencias: true`) SHALL be rendered as an `alertdialog` (the `frontend-ui-polish` destructive dialog pattern). It SHALL satisfy the `frontend-ui-polish` contract for `alertdialog`: it has `role="alertdialog"`, `aria-modal="true"`, an `aria-label` of "Confirmar eliminación", focuses the "Cancelar" button by default (safer than focusing the destructive action), traps focus, closes on `Esc`, returns focus to the trigger on close, and **does NOT close on backdrop click** (the user must explicitly choose). The internal behavior (call DELETE on Confirmar, do nothing on Cancelar) is preserved from the C-07 spec.

The following scenarios from the C-07 canonical spec are **preserved unchanged**: "delete with no dependencies completes silently", "delete with dependencies shows confirmation dialog", "confirming deletion with dependencies issues a second DELETE", and "cancelling dependency confirmation leaves the list unchanged".

#### Scenario: alertdialog has accessible role, label, and modal semantics

- **WHEN** a `DeleteProveedorDialog` is shown (because the supplier has `tiene_dependencias: true`)
- **THEN** the dialog has `role="alertdialog"`, `aria-modal="true"`, and an `aria-label` of "Confirmar eliminación"

#### Scenario: alertdialog focuses the Cancel button on open

- **WHEN** a `DeleteProveedorDialog` is shown
- **THEN** the "Cancelar" button receives focus (not the destructive "Confirmar" button)

#### Scenario: alertdialog closes on Esc and returns focus to the trigger

- **WHEN** a `DeleteProveedorDialog` is open and the user presses `Esc`
- **THEN** the dialog closes without issuing a DELETE, and focus returns to the "Eliminar" trigger button

#### Scenario: alertdialog does not close on backdrop click

- **WHEN** a `DeleteProveedorDialog` is open and the user clicks the backdrop
- **THEN** the dialog remains open; the user MUST click "Confirmar" or "Cancelar" to close it

#### Scenario: confirming deletion issues a second DELETE and shows a toast

- **WHEN** a `DeleteProveedorDialog` is open and the user clicks "Confirmar"
- **THEN** `DELETE /api/proveedores/{id}` is called, on success a success toast appears, the dialog closes, focus returns to the trigger, and the supplier list is refetched

#### Scenario: cancelling the alertdialog leaves the list unchanged

- **WHEN** a `DeleteProveedorDialog` is open and the user clicks "Cancelar"
- **THEN** no second DELETE request is made, the dialog closes, and the supplier remains in the list
