# Proposal: c-24-archivo-viewer-and-historial

## Why

Three usability gaps found in the cuenta-corriente view (C-13) while testing the MVP with real invoices and payments.

**1. "Ver archivo" leaves the PWA.** `TablaFacturasConEstado.tsx:109-123` renders `archivo_url` as a plain `<a target="_blank">`. `cloudinary_signer.py` accepts `("pdf", "jpg", "png")` for the factura preset, so this link can point at either an image or a PDF — but the app never previews either, it just hands the user off to a new browser tab (or, on some mobile PWA install modes, silently fails to open one at all). A quick "does this invoice look right" check should not require leaving the app.

**2. Payment receipts are invisible even though they're saved.** `CargaModal.tsx:289-333` uploads a comprobante to Cloudinary for every pago and `Pago.comprobante_url` has held that URL since the initial migration — the image is not lost. But the "Pagos" tab (`PagosRegistrados.tsx`) is fed by the cuenta-corriente `historial`, and `EntradaHistorial` (`app/schemas/cuenta_corriente.py`) never carries a URL field, so there is nothing to render. The data exists; the response contract just never threads it through.

**3. The historial reads oldest-first with no way to change it.** `HistorialCronologico` renders `historial` in the exact backend order, which is ASC by `(fecha, created_at, id)` because `_build_historial` computes `saldo_acumulado` in that same pass (RN-HIST). For a supplier with any history, the most recent movement — the one the user almost always wants to check first — is the last row, off-screen below older ones.

## What Changes

- **New shared `ArchivoPreviewDialog`.** A Radix `Dialog` (matching the existing `ProveedorDialog` pattern) that previews a factura or comprobante URL in-app: renders an `<img>` for image formats, an embedded viewer for `.pdf`, and always shows an "Abrir en pestaña nueva" fallback link (mobile PWA webviews sometimes refuse to render embedded PDFs). Capped at `max-h-[90dvh]` with an internal scroll container — no dialog in this codebase currently caps its height, so this establishes the pattern rather than assuming it.
- **`TablaFacturasConEstado`'s "Ver archivo" becomes a button that opens the dialog** instead of a plain external link. **BREAKING** for the existing test contract: it changes accessible role from `link` to `button` (the file itself does not change — only how the user reaches it).
- **`PagosRegistrados` gains an "Archivo" column** with the same in-app viewer, wired to a new `archivo_url` field threaded onto `EntradaHistorial` for `PAGO` rows (sourced from `Pago.comprobante_url`, already persisted — no migration). For symmetry and so the historial response is self-sufficient, `FACTURA` rows also carry their `archivo_url` (sourced from `Factura.archivo_url`, already returned by `facturas_con_estado` — the duplication is one already-fetched string, not a new query).
- **`CuentaCorrientePage` reverses the historial for display only**, defaulting to newest-first, with an asc/desc toggle near the "Historial cronológico" heading. The backend order and the `saldo_acumulado` computation are untouched — reversing a copy of an already-computed array cannot corrupt the running balance, and the change is explicitly scoped to display, not to the `_build_historial` pure function or its 12 existing tests.

## Capabilities

### New Capabilities
- `archivo-viewer`: shared in-app preview dialog for factura/comprobante URLs (image or PDF), used from both the facturas and pagos tabs of cuenta-corriente.

### Modified Capabilities
- `cuenta-corriente-backend`: `EntradaHistorial` gains an optional `archivo_url` field (Historial requirement, Pydantic response schema requirement).
- `cuenta-corriente-frontend`: `TablaFacturasConEstado`'s file link becomes an in-app preview trigger; `PagosRegistrados` gains an Archivo column; `HistorialCronologico`'s display order becomes user-toggleable (newest-first default) without touching the response order or `saldo_acumulado`.

## Impact

- **Affected code**: `facturas-proveedores-web/src/shared/components/ArchivoPreviewDialog/` (new), `src/features/cuenta-corriente/components/TablaFacturasConEstado.tsx`, `src/features/cuenta-corriente/components/PagosRegistrados.tsx`, `src/features/cuenta-corriente/CuentaCorrientePage.tsx`, `src/shared/api/api.d.ts`; `facturas-proveedores-api/app/schemas/cuenta_corriente.py`, `app/services/proveedor_service.py`; plus new/updated tests in both suites.
- **Not affected**: no Alembic migration (`Pago.comprobante_url` and `Factura.archivo_url` already exist), no change to `_build_historial`'s ordering or the `saldo_acumulado` algorithm, no change to `TablaFacturasConEstado`'s filter logic, no change to `PagosRegistrados`'s existing fecha/monto columns.
- **Risk**: low-medium. The highest-risk piece is the frontend historial reversal — it must never recompute or re-sort by value, only reverse a copy of the array the backend already ordered and balanced; this is covered by a dedicated regression test asserting `saldo_acumulado` values survive reversal unchanged. The `TablaFacturasConEstado` role change from `link` to `button` is an intentional, called-out break of an existing test assertion, not an accidental regression.
