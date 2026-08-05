# Tasks: c-26-edit-form-ux-and-factura-detail

> Strict TDD: each behaviour starts from a test that fails against current code.
> Slice A (backend + forms) and Slice B (viewer + detail dialog) touch disjoint
> files and may run concurrently.

## 1. Baseline

- [x] 1.1 Record backend and frontend suite counts before any edit

## Slice A — supplier name and form exit

- [x] A.1 Write a failing API test: creating/fetching/updating an invoice returns `proveedor_nombre` with the supplier's name
- [x] A.2 Write a failing API test: a soft-deleted supplier yields `null`, never the id
- [x] A.3 Populate `proveedor_nombre` in `app/routers/facturas.py::_to_response`, reusing the payment router's resolver shape; confirm both tests pass
- [x] A.4 Confirm ownership is unaffected — a foreign invoice still returns 404 and resolves no name
- [x] A.5 Write a failing test: the invoice edit form shows the supplier NAME, and never a UUID, when the response carries `proveedor_nombre`
- [x] A.6 Write a failing test: with no name available the form shows a neutral placeholder, not the id
- [x] A.7 Wire `FacturaFormPage`'s edit branch to pass the supplier, mirroring `PagoFormPage`; make both tests pass
- [x] A.8 Write a failing test: each edit form exposes a top-right close control that cancels
- [x] A.9 Add the close control to `FacturaForm` and `PagoForm`; Cancelar stays where it is (D2)

## Slice B — in-app viewer everywhere, and the detail dialog

- [x] B.1 Write a failing test: the attachment in `FileUploadField` opens the in-app viewer, not a new tab
- [x] B.2 Replace the `target="_blank"` link in `FileUploadField` with `ArchivoPreviewDialog`
- [x] B.3 Same for `PagoCard`, with its own failing test first
- [x] B.4 Write failing tests for the detail dialog: core fields, line items present, line items absent, attachment present, attachment absent, visible close control, `dvh` cap with scroll container
- [x] B.5 Build `FacturaDetailDialog`, reusing `EstadoBadge`, `formatMonto` and `ArchivoPreviewDialog` (D5 — no fetch of its own)
- [x] B.6 Write a failing test: activating a row opens the dialog
- [x] B.7 Write a failing test: activating the row's edit control does NOT open the dialog (D4)
- [x] B.8 Make the row activate the dialog, with the action buttons outside the clickable region
- [x] B.9 Write a failing test: the dialog's edit action navigates to the edit form

## 2. Close out

- [x] 2.1 Full backend suite green, no regression against the 1.1 baseline
- [x] 2.2 Full frontend suite green, `npm run typecheck` and `npm run lint` clean
- [x] 2.3 Verify in the running app: open an invoice row, read the detail, open the attachment in-app, then edit and confirm the supplier name shows instead of a UUID
- [x] 2.4 Confirm no unintended files changed outside the two slices
