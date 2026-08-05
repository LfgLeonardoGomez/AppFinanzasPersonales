# Proposal: c-26-edit-form-ux-and-factura-detail

## Why

Five defects found while testing the invoice and payment screens. Four are UX failures in the edit form; the fifth is a missing read-affordance in the list.

**1. The edit form shows a raw UUID where the supplier name belongs.** `FacturaForm.tsx:226` renders `{initialProveedor?.nombre ?? factura?.proveedor_id}`, and `FacturaFormPage`'s edit branch never passes `proveedor` — so the fallback always wins and the user reads `019f4831-4050-70fc-b221-e402d0445831` instead of "pencamar". A UUID is not a degraded label; it is noise. Note the payment form already solved this in C-18 (FE-005) by reading `pago.proveedor_nombre` from the backend. `FacturaResponse` declares the same field (`app/schemas/factura.py:207`) but the router never populates it — `_to_response` simply omits it.

**2. The attachment still opens in a new tab from inside the form.** C-24 replaced the new-tab link with an in-app viewer, but only in the cuenta-corriente tables. `FileUploadField.tsx:125` — the attachment shown while editing — still uses `target="_blank"`, so the same action behaves differently depending on where the user clicks it. `PagoCard.tsx:82` has the same leftover.

**3. The form has no visible way out.** Cancelar and Guardar sit at the bottom of a long form, below the fold. At a glance the form looks like a dead end, and on a phone the user has to scroll to discover the exit. There is no close control at the top.

**4. The only way to open an invoice is the pencil icon.** Clicking the row itself does nothing, so reading an invoice requires aiming at a small target and landing in an editable form.

## What Changes

- **The backend populates `proveedor_nombre` on `FacturaResponse`**, mirroring the payment router's existing `_resolve_proveedor_nombre` helper. This fixes the UUID for every consumer at once rather than papering over it in one screen, and keeps invoices and payments symmetric. When the supplier is soft-deleted the backend returns `null`, matching the payment behaviour.
- **The invoice edit form renders the supplier name**, and when no name is available shows a neutral placeholder — never the id.
- **`FileUploadField` and `PagoCard` open the attachment in the shared `ArchivoPreviewDialog`** introduced by C-24, so "ver archivo" means the same thing everywhere in the app.
- **Both edit forms gain a close button in the top-right**, the conventional position, so the exit is visible without scrolling. Cancelar stays where it is — this adds an affordance, it does not move one.
- **NEW: a read-only invoice detail dialog**, opened by clicking anywhere on an invoice row. It shows number, supplier, dates, status, total and line items, with actions to view the attachment, edit, or close. Chosen over making the row open the edit form directly: reading an invoice is the common case and it should not put the user inside an editable form by accident, which is easy to trigger on a phone.

## Capabilities

### New Capabilities
- `factura-detail-view`: read-only presentation of a single invoice, reachable from the list, from which editing is an explicit further step.

### Modified Capabilities
- `facturas-api`: `FacturaResponse.proveedor_nombre` is populated rather than always null.
- `facturas-frontend`: the edit form never displays a supplier id; attachments open in-app; the form exposes a top-right close control.
- `pagos-frontend`: attachments open in-app; the form exposes a top-right close control.

## Impact

- **Backend**: `app/routers/facturas.py` (`_to_response` gains the supplier lookup) plus tests. No schema or migration change — the field already exists.
- **Frontend**: `FacturaFormPage.tsx`, `FacturaForm.tsx`, `PagoForm.tsx`, `FileUploadField.tsx`, `PagoCard.tsx`, `FacturasList.tsx`, plus the new detail dialog and its tests.
- **Risk**: low for items 1–3 (display and affordances). The detail dialog is new surface, so the risk is the usual one for new UI: it must not become a second, diverging way to render an invoice. It reuses `EstadoBadge`, `formatMonto` and `ArchivoPreviewDialog` rather than restating them.
- **Watch out**: `_to_response` runs per invoice, so the supplier lookup must not become a query per row. The list endpoint already resolves names separately; only the single-invoice responses need it.
- **Related**: the same "one action, two behaviours" drift that C-24 fixed for tables is what item 2 finishes.
