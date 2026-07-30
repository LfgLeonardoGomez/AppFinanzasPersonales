## Context

Three independent frontend/backend gaps in the cuenta-corriente view (C-13), grouped because all three touch the same three files (`TablaFacturasConEstado.tsx`, `PagosRegistrados.tsx`, `CuentaCorrientePage.tsx`) and share one new shared component.

- **Item A**: `TablaFacturasConEstado.tsx:109-123` renders `archivo_url` as `<a target="_blank">`. `cloudinary_signer.py` allows `("pdf", "jpg", "png")` for the factura preset — the link can be a PDF, not just an image, so a lightbox-only viewer would be wrong.
- **Item B**: `Pago.comprobante_url` (`app/models/pago.py:47`) is persisted at upload time (`CargaModal.tsx:289-333`, `buildCreatePayload.ts:80-91`) but never reaches the frontend's Pagos tab, because that tab is fed by `historial` (`CuentaCorrientePage.tsx:87-90`) and `EntradaHistorial` (`app/schemas/cuenta_corriente.py:56-72`) has no URL field.
- **Item C**: `_build_historial` (`proveedor_service.py:269-318`) sorts ASC by `(fecha, created_at, id)` **and** computes `saldo_acumulado` in the same pass. The frontend renders that array verbatim. Reversing on the backend would require either re-deriving `saldo_acumulado` in reverse (duplicate logic, new bug surface) or computing it forward and reversing the *list* after — at which point the reversal might as well happen in the one place that already has the array: the frontend.

## Goals / Non-Goals

**Goals:**
- Preview factura and comprobante files (image or PDF) without leaving the PWA.
- Surface the already-persisted `comprobante_url` in the Pagos tab.
- Let the user see the most recent historial entry first by default, with a toggle back to chronological order.
- Do all three without touching `_build_historial`'s ordering, its 12 existing tests, or the `saldo_acumulado` algorithm.

**Non-Goals:**
- Not building a generic file-upload or file-management feature — this is preview-only, reusing URLs that already exist.
- Not adding a dedicated `/api/pagos`-backed query to the Pagos tab (that would be a bigger change and the historial-based derivation is explicitly documented as an intentional C-13 decision in `PagosRegistrados.tsx`'s header comment — this change respects it and threads one more field through the same pipe).
- Not persisting a user's asc/desc preference (session-only `useState`, resets on navigation — no new backend field, no localStorage).
- Not changing `TablaFacturasConEstado`'s filter logic, `PagosRegistrados`'s fecha/monto columns, or any route.

## Decisions

### D1: `ArchivoPreviewDialog` is a new shared component, not two feature-local ones

Both Item A and Item B need "open a URL, show it in-app, handle image vs PDF, always offer an external-tab fallback." Building it once in `src/shared/components/ArchivoPreviewDialog/` and consuming it from `TablaFacturasConEstado` and `PagosRegistrados` avoids duplicating the format-detection logic and the dialog viewport-fit boilerplate. It follows the exact controlled-dialog shape already established by `ProveedorDialog` (`Dialog.Root open/onOpenChange`, `Dialog.Portal`, sr-only `Title`/`Description`) rather than inventing a new modal pattern.

**Alternative considered**: a `useArchivoPreview()` hook returning `{ open, url, show, hide }` plus a single app-level dialog mounted once near the router root. Rejected for this change's scope — it would require threading dialog state through context or a store, which is a bigger structural change than two small tables each owning one local `useState<{url,title}|null>`. Revisit if a third consumer appears.

### D2: Format detection by file extension, not `Content-Type` sniffing

Cloudinary URLs for all three presets (avatar/factura/comprobante) end in `.pdf`, `.jpg`, or `.png` (`cloudinary_signer.py`'s `_*_ALLOWED_FORMATS`), so a same-origin-safe, network-free `url.split('?')[0].toLowerCase().endsWith('.pdf')` check is sufficient and requires no HEAD request, no CORS concern, no loading state for the classification itself (the `<img>`/embedded-viewer element still has its own load state, unrelated to classification).

**Alternative considered**: fetch the URL and read `Content-Type`. Rejected — adds a network round-trip and CORS surface for zero benefit given Cloudinary's URLs are extension-predictable by construction (the upload preset enforces `allowed_formats`).

### D3: Always render the external-tab fallback link, unconditionally

Embedded PDF rendering (`<iframe>`/`<object>` pointed at a PDF URL) is unreliable inside mobile PWA "standalone" webviews — some refuse to render PDF at all, silently showing a blank frame. Rather than trying to detect that failure, the dialog always shows "Abrir en pestaña nueva" next to the embedded preview, for both PDF and image branches (images render reliably everywhere, but the fallback link costs nothing and keeps the two branches structurally symmetric, which simplifies the component and its tests).

### D4: `EntradaHistorial.archivo_url` is one field, not two (`comprobante_url` for PAGO / a separate name for FACTURA)

The proposal's background note flagged this as a decision point. Using one generically-named field (`archivo_url`, matching `FacturaConEstado.archivo_url`'s existing name) rather than two type-specific fields (e.g. `comprobante_url` only on PAGO rows) keeps `EntradaHistorial` a single flat shape the frontend can read uniformly (`h.archivo_url`) regardless of `h.tipo`, and keeps the historial response self-sufficient for a future consumer that only fetches `historial` (e.g. an export view) without needing to cross-reference `facturas_con_estado` by id. The cost is one duplicated string per FACTURA row (already in memory from the same query — no new query, no N+1) against the benefit of one field name instead of two and no discriminated-union branching in schema consumers.

**Alternative considered**: `comprobante_url: Optional[str]` present only on `PAGO` rows, omitting the field (or leaving it structurally absent) on `FACTURA` rows since `facturas_con_estado` already exposes `archivo_url` for those. Rejected — Pydantic models are not naturally row-type-conditional without a discriminated union (`Literal["FACTURA"]` / `Literal["PAGO"]` submodels), which is a bigger schema change than this fix warrants, and the frontend would need a `tipo`-branching read instead of a flat one.

### D5: The asc/desc toggle lives in `CuentaCorrientePage`, not `HistorialCronologico`

`HistorialCronologico` stays a dumb renderer (per its existing doc comment: "no recomputation, no re-ranking"). `CuentaCorrientePage` already owns `historial` as a prop and already derives `pagos` from it via `useMemo` (`CuentaCorrientePage.tsx:87-90`) — adding a second `useMemo` for the display-ordered historial is the same pattern, not a new one. This also keeps the toggle control next to the "Historial cronológico" heading, which is rendered by the page, not the table.

**The reversal MUST be `[...historial].reverse()` on a shallow copy — never `.sort()` with a comparator, and never a recompute of `saldo_acumulado`.** `.reverse()` is an O(n) structural flip that cannot touch any row's own fields; a comparator-based re-sort invites a future "helpful" rewrite that resorts by `fecha` descending and silently decouples row order from the `saldo_acumulado` the backend computed for the ASC walk, corrupting the exact invariant Item C exists to preserve. A comment at the call site says this explicitly, because — per the task background — this is exactly the kind of code a future refactor "cleans up" and quietly breaks.

### D6: Default is `desc` (newest-first), matching the user's explicit ask

`useState<'asc' | 'desc'>('desc')`. The backend order (`asc`) is unchanged and remains the API contract's documented order (RN-HIST); `desc` is purely a display default computed client-side.

## Risks / Trade-offs

- **[Risk] A future edit reintroduces client-side recomputation of `saldo_acumulado`** → Mitigated by: the reversal is a single `.reverse()` on a copy with an explanatory comment (D5); a dedicated regression test (`cuenta-corriente/CuentaCorrientePage.test.tsx`) asserts that every row's rendered `saldo_acumulado` is identical between `asc` and `desc` modes for the same underlying entry — a `.sort()`-based regression would change row-to-value pairing and fail that test immediately.
- **[Risk] PDF embedding fails silently in some PWA webviews** → Mitigated by D3 (always-visible fallback link); not testable in jsdom (no real PDF rendering), so the test coverage is: the fallback link element exists and has the correct `href` regardless of format branch.
- **[Trade-off] `archivo_url` duplicated on FACTURA historial rows** → Accepted per D4; the cost is one already-in-memory string, not a query.
- **[Risk] `npm run generate-types` requires the API reachable at `localhost:8000`** → If unavailable at implementation time, `api.d.ts` is hand-edited to add the one new optional field on `EntradaHistorial`, called out explicitly in the apply report; the hand-edit is minimal enough (one line) that drift risk is low, and a follow-up regeneration once the API is reachable will produce an identical diff.

## Migration Plan

No database migration. `Factura.archivo_url` and `Pago.comprobante_url` already exist and are populated at upload time — this change only threads existing columns through an existing endpoint's response schema. Deploy is a single coordinated frontend+backend release (the frontend types depend on the backend schema field); no backward-compatibility window is needed because the field is additive and optional (`Optional[str] = None`), so an old frontend against a new backend, or a new frontend against an old backend, both degrade gracefully (missing field renders as absent link / `undefined`, which the frontend already treats as falsy).
