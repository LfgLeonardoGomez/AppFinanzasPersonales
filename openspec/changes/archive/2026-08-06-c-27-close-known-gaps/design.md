# Design: c-27-close-known-gaps

## Context

Three deferred items, closed together because each is small on its own and none depends on the others. They touch disjoint files and can be implemented concurrently.

The third one carries history: the `307` on trailing-slash collection routes is what made the old multi-user test harness silently attribute writes to the wrong user (C-22). On a redirect, httpx rebuilds the request from its own cookie jar and discards an explicitly-set `Cookie` header. The harness was fixed; the redirect that enabled the confusion was left in place and recorded as a follow-up. This is that follow-up.

## Goals / Non-Goals

**Goals:**
- The same row offers the same actions regardless of which tab shows it.
- Every dialog in the app traps focus and dismisses the same way.
- No collection endpoint answers a redirect.

**Non-Goals:**
- Not changing `CargaModal`'s state machine, steps, props or copy. This replaces the shell only.
- Not adding a detail view to the Historial tab — just the attachment control the sibling tabs already have.
- Not touching item-level routes (`/api/x/{id}`), which never redirected.

## Decisions

### D1: Register both path forms rather than disabling redirects

FastAPI can be told not to redirect (`redirect_slashes=False`), but that turns `/api/pagos/` into a 404 and would break the frontend, which calls the trailing-slash form in several places. Declaring the collection route on both `""` and `"/"` makes both paths answer directly.

*Alternatives considered:*
- **`redirect_slashes=False` and fix every frontend call site.** Rejected: it converts a silent foot-gun into a loud outage, and makes correctness depend on nobody ever typing the other form again.
- **Leave the redirect and document it.** Rejected — that is what was done last time, and it cost a multi-day debugging detour.

Only the collection routes are affected. Item routes carry a path parameter and never had the ambiguity.

### D2: `CargaModal` keeps its own layout inside a Radix shell

Radix supplies `Root`/`Portal`/`Overlay`/`Content`, the focus trap, `Esc`, backdrop dismissal and the portal. Everything inside `Content` — the header, the step body, the footer, the `max-h-[90dvh]` cap from C-23 — is carried over as-is.

The modal currently guards dismissal (`canClose` is false while processing). Radix dismissal must respect that: `onOpenChange` has to consult the same guard, or a user could `Esc` out mid-extraction, which the hand-rolled version deliberately prevented.

*Alternative considered:* leaving it hand-rolled since no user has complained. Rejected because the accessibility gap is real and the modal is the one most likely to grow — but the risk is acknowledged in the proposal and mitigated by refusing to edit existing tests.

### D3: The existing test suite is the contract for the migration

The ~105 tests around `CargaModal` describe its behaviour. If the migration is behaviour-preserving they all pass untouched. **Any test that needs editing is evidence the behaviour changed** and must be surfaced, not silently adjusted. This is the whole safety mechanism for D2 — without it, "green suite" would only mean the tests were bent to fit.

## Risks / Trade-offs

- **The Radix migration regresses focus, `Esc` or the step machine** → the untouched-suite rule (D3) is the detector; any edit demanded by the migration is reported.
- **`Esc` during processing becomes possible** → explicitly guarded via `onOpenChange`, and worth a dedicated test since the hand-rolled version prevented it on purpose.
- **Registering two paths doubles the OpenAPI operation list** → use the same handler for both and mark one `include_in_schema=False` so the generated types and docs stay single-valued; otherwise `openapi-typescript` would emit duplicates.
- **Ownership rules must be untouched by the routing change** → the existing 404-on-foreign tests cover this and must stay green.

## Open Questions

- Should the Historial tab eventually get the full detail dialog rather than just an attachment control? Out of scope; this only restores parity with the sibling tabs.
