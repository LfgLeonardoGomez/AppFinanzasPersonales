# Design: c-26-edit-form-ux-and-factura-detail

## Context

Four defects and one new view, all found in one testing pass over the invoice screens.

The supplier-id leak is the interesting one because the fix already exists in the codebase — for payments. `PagoFormPage` builds its read-only supplier display from `pago.proveedor_nombre` (C-18, FE-005), which the payment router populates via `_resolve_proveedor_nombre`. The invoice router never gained that step, and `FacturaResponse.proveedor_nombre` has been declared-but-null since it was added. So invoices fall through to `factura.proveedor_id` and print a UUID.

The attachment inconsistency is C-24 finishing only half its job: the in-app viewer replaced the new-tab link in the cuenta-corriente tables, but `FileUploadField` (the attachment control inside the edit form) and `PagoCard` (the standalone payments list) still navigate away.

## Goals / Non-Goals

**Goals:**
- No screen ever displays a supplier id where a name belongs.
- "Ver archivo" behaves identically everywhere.
- Both edit forms have a visible exit without scrolling.
- An invoice can be read without entering an editable form.

**Non-Goals:**
- Not redesigning the edit forms. Adding a close control is not a mandate to restructure the layout.
- Not building a payment detail view. The user asked about invoices; the symmetric view can follow if it proves useful.
- Not adding supplier names to list endpoints — those already resolve names their own way.
- Not making the detail view editable in place.

## Decisions

### D1: Fix the supplier name in the backend, not the form

`_to_response` in the invoice router resolves and sets `proveedor_nombre`, reusing the payment router's helper shape.

*Alternatives considered:*
- **Fetch the supplier in `FacturaFormPage` with `useProveedor`.** Rejected: it fixes one screen while every other consumer of `FacturaResponse` keeps getting null, costs an extra round-trip, and leaves invoices and payments asymmetric for no reason.
- **Render the id when the name is missing (status quo).** Rejected: a UUID is not a degraded name, it is noise the user cannot act on.

The soft-deleted supplier case returns `null`, matching payments. The form then shows a neutral placeholder rather than an id.

### D2: The form's close control is additive

A close button in the top-right corner, next to the heading. Cancelar stays at the bottom.

*Alternative considered:* a sticky footer keeping Cancelar/Guardar always visible. Better in principle, but it restructures both forms' markup and their tests to solve a discoverability problem that a conventional close control solves. Recorded as a follow-up if long forms keep causing trouble.

### D3: The detail view is a dialog, not a route

A Radix dialog opened from the list, consistent with every other overlay in the app since C-20, and with the `modal-viewport-fit` cap from C-23.

*Alternative considered:* a `/facturas/:id` route. It would give a shareable URL and browser-back, which is real value — but it also means a new page shell, a loading state and a not-found state for a view whose entire content the list already holds. The dialog reuses the row's data and adds no fetch. If deep-linking to an invoice is ever wanted, promoting the dialog's body to a route is a contained change.

### D4: The row is a button, the row's actions are not nested inside it

Nesting the edit and delete buttons inside a clickable row would produce interactive controls inside an interactive control — invalid, and it makes the small targets ambiguous. The row's clickable region is the informational area; the action buttons sit outside it and stop propagation.

*Alternative considered:* making the whole row clickable and calling `stopPropagation` in each action handler. Works, but relies on every future action remembering to do it. Structuring it so the actions are simply not inside the clickable region does not depend on anyone remembering.

### D5 (REVISED): The detail dialog fetches the full invoice

**The original decision was wrong. It is corrected here rather than quietly rewritten.**

It read: *"The list already holds every field the detail view shows, so opening it triggers no request."* That premise came from the frontend type `FacturaListItem`, which declared twelve fields. The endpoint returns **six**: `id`, `proveedor_id`, `numero`, `fecha_emision`, `monto_total`, `estado`. The backend omits the rest on purpose — its own schema says *"Omits items, timestamps, and archivo_url to keep payload small"*.

So the type was vouching for data the server never sends. Built on it, the dialog rendered an empty `origen`, and its "Ver archivo" button could never appear at all, because `archivo_url` is always `undefined` on a list row. Confirmed in a real browser: an invoice known to have an attachment offered no view-file action.

Two changes follow:
- `FacturaListItem` in `api.d.ts` now matches what the endpoint actually returns. Narrowing it immediately surfaced every test fixture that had been fabricating those fields — the compiler finally doing its job here.
- The dialog fetches with `useFactura(id)` while open. The lean row still paints the header instantly, so nothing regresses visually; `archivo_url`, `origen`, `fecha_vencimiento` and items come from the fetch. This also removes the items limitation the original D5 described.

*How it was caught:* not by the tests — they passed, because their fixtures were built from the same lying type. It surfaced by opening the page in a browser and noticing one empty field. A type is a claim about runtime data, and it is only as true as the last time someone checked it against a real response.

## Risks / Trade-offs

- **A per-invoice supplier query on every response** → the lookup runs only on single-invoice endpoints (create/get/update), which already load one row; list endpoints are untouched.
- **The detail dialog becomes a second, diverging way to render an invoice** → it reuses `EstadoBadge`, `formatMonto` and `ArchivoPreviewDialog` rather than restating them, so formatting cannot drift.
- **Row click competing with the action buttons** → addressed structurally by D4, and covered by a test asserting the edit control does not open the dialog.
- **D5 was revised mid-implementation** after the browser showed an empty field the tests had not caught. The original no-fetch design rested on a frontend type that overstated the API payload; both the type and the dialog were corrected. See D5.

## Open Questions

- Should payments get the same detail dialog? Left out deliberately; the shape here is reusable if the answer turns out to be yes.
