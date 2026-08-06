# Proposal: c-27-close-known-gaps

## Why

Three gaps recorded during C-23 through C-26 and deliberately deferred at the time. None is a new discovery; each was written down rather than fixed, and this change closes them so the list stops growing.

**1. The Historial tab carries the attachment URL but offers no way to open it.** C-24 threaded `archivo_url` onto every `EntradaHistorial` row for schema symmetry, and the Facturas and Pagos tabs both render a view-file control from it. The Historial tab — the same data, one tab over — renders nothing. The payload pays for a field the screen ignores, and the user sees the same row behave differently depending on which tab they are looking at.

**2. `CargaModal` is a hand-rolled modal.** Every other overlay moved to Radix in C-20; this one did not. It implements its own backdrop, its own key handling and its own focus restore, which means no focus trap: tabbing out of the modal lands behind it, and the behaviour on `Esc` is whatever its own handler happens to do rather than what every other dialog does. It is also the modal most likely to grow, since it hosts the whole AI proposal form.

**3. Collection routes answer `307` on a trailing slash.** `POST /api/pagos/` redirects to `/api/pagos`, and the same holds for facturas and proveedores. This was diagnosed in C-22: on a redirect, HTTP clients rebuild the request and some drop headers — which is exactly what made the old test harness attribute writes to the wrong user for months. The frontend currently calls the trailing-slash form in several places and only works because the redirect is followed. A redirect that silently changes request semantics is a foot-gun that has already cost this project once.

## What Changes

- **The Historial tab gains the same view-file control** the other two tabs have, opening the shared `ArchivoPreviewDialog`. The field it needs is already in the payload.
- **`CargaModal` moves to Radix Dialog**, gaining a real focus trap, standard `Esc` and backdrop dismissal, and portal mounting — matching every other dialog since C-20. Its state machine, its steps and its public props stay exactly as they are: this replaces the shell, not the behaviour. The viewport cap added in C-23 is preserved.
- **Collection routes accept both `/api/x` and `/api/x/` without redirecting.** Registering both paths removes the `307` entirely, so no client can lose a header crossing it. The frontend keeps working unchanged either way.

## Capabilities

### Modified Capabilities
- `cuenta-corriente-frontend`: the Historial tab exposes the attachment it already receives.
- `ia-vision-frontend`: the carga modal is a standard dialog with a focus trap and conventional dismissal.
- `pagos-backend`, `facturas-api`, `proveedores-api`: collection endpoints answer directly on both path forms instead of redirecting.

## Impact

- **Frontend**: `HistorialCronologico.tsx`, `CargaModal.tsx` and their tests.
- **Backend**: the routers' collection route decorators, plus tests asserting no redirect.
- **Risk — item 2 is the real one.** `CargaModal` is the keystone of the carga flow with ~105 tests around it, and it has no user-visible defect today. Swapping its shell risks regressing focus, `Esc`, or the origen→processing→review→success machine for a benefit that is correctness-of-behaviour rather than a bug fix. Mitigation: the full existing suite must stay green untouched — any test that needs editing is a signal the behaviour changed, not that the test was wrong, and must be reported rather than adjusted.
- **Risk — item 3** changes routing for every collection endpoint. Ownership, validation and status codes must be unaffected; only the redirect disappears.
- No schema or migration change.
