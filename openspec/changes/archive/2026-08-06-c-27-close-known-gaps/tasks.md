# Tasks: c-27-close-known-gaps

> Strict TDD. The three items touch disjoint files and may run concurrently.

## 1. Baseline

- [x] 1.1 Record backend and frontend suite counts before any edit

## Item A — Historial tab exposes its attachment

- [x] A.1 Write a failing test: a history row carrying an attachment offers a view-file control
- [x] A.2 Write a failing test: a row without an attachment offers none
- [x] A.3 Write a failing test: the control opens the in-app viewer, never a new tab
- [x] A.4 Add the control to `HistorialCronologico`, reusing `ArchivoPreviewDialog`
- [x] A.5 Confirm the tab still renders in the order it receives (the C-24 saldo invariant is untouched)

## Item B — CargaModal on Radix

- [x] B.1 Write a failing test: focus is trapped while the modal is open
- [x] B.2 Write a failing test: `Esc` closes when dismissal is allowed
- [x] B.3 Write a failing test: `Esc` and backdrop do NOT close while extraction is in progress
- [x] B.4 Replace the hand-rolled shell with Radix `Root`/`Portal`/`Overlay`/`Content`, carrying the existing header, body, footer and the `max-h-[90dvh]` cap
- [x] B.5 Wire `onOpenChange` through the existing `canClose` guard
- [x] B.6 Run the full existing `CargaModal` and `PropuestaIAModal` suites — they MUST pass untouched (D3). Any test needing an edit is evidence the behaviour changed: STOP and report it instead of adjusting the test
- [x] B.7 Confirm focus returns to the opener on close

## Item C — No redirect on collection routes

- [x] C.1 Write a failing test: `POST /api/pagos/` answers directly, with no 3xx in the exchange (assert with redirects disabled)
- [x] C.2 Same for facturas and proveedores collection routes, GET and POST
- [x] C.3 Register both path forms on the collection routes, keeping one out of the OpenAPI schema so operations stay single-valued
- [x] C.4 Confirm ownership/validation statuses are unchanged (401/404/422 tests still green)
- [x] C.5 Assert the OpenAPI document lists each collection operation once

## 2. Close out

- [x] 2.1 Full backend suite green, no regression against the 1.1 baseline
- [x] 2.2 Full frontend suite green; `npm run typecheck` and `npm run lint` clean
- [x] 2.3 Verify in the running app: open an attachment from the Historial tab, and confirm the carga modal traps focus and closes on Esc
- [x] 2.4 Report any test that had to be edited, and why
