# Tasks — c-21-ia-single-confirm-flow

> TDD strict. Backend: `.venv/Scripts/python.exe -m pytest` on host, Postgres via testcontainers, vision/Cloudinary mocked. Frontend: Vitest + jsdom + MSW inside the web container. Write the failing test FIRST for every behavior.

## 1. Backend — configurable IA rate limit (ia-vision-backend)

- [x] 1.1 RED: add tests asserting `Settings` exposes `IA_RATE_MAX_REQUESTS` (default 60) and `IA_RATE_WINDOW_SECONDS` (default 3600), both `> 0`, read live from `os.environ` (mirror `TestSettingsProxyLiveEnvReads` in `tests/test_config.py`).
- [x] 1.2 GREEN: add the two `Field`s to `app/core/config.py` `Settings` with the defaults and `gt=0` validation.
- [x] 1.3 RED: rewrite/extend the rate-limit tests (`tests/` covering `rate_limit_ia`) to drive the limit via env — set `IA_RATE_MAX_REQUESTS` low (e.g. 2) and assert the (max+1)th request returns 429; assert defaults allow 60 in an hour; keep the keyed-by-`usuario_id`, sliding-window, and 401-does-not-consume scenarios green.
- [x] 1.4 GREEN: change `app/core/rate_limit_ia.py` to read `settings.IA_RATE_MAX_REQUESTS` / `settings.IA_RATE_WINDOW_SECONDS` at evaluation time (via the C-16 read-through proxy) instead of module constants; keep exports/test helpers working (source from settings). TRIANGULATE with a second env value.
- [x] 1.5 Document `IA_RATE_MAX_REQUESTS` and `IA_RATE_WINDOW_SECONDS` in `.env.example`. DONE: entraron con defaults 60/3600 en `facturas-proveedores-api/.env.example` (commit 8904551) y se documentaron también en el `.env.example` raíz de docker-compose.
- [x] 1.6 Run the backend suite; confirm no pre-existing rate-limit/config test broke unexpectedly (only the intentionally-updated ones changed).

## 2. Frontend — shared upload + confirm-create factoring (ia-vision-frontend)

- [x] 2.1 RED: unit test a shared `uploadToCloudinary(file, preset)` helper (Cloudinary mocked via MSW) — success returns `secure_url`; HTTP/`error` response rejects.
- [x] 2.2 GREEN: extract the raw upload logic from `FileUploadField.tsx` into the shared helper; refactor `FileUploadField` to call it (existing FileUploadField tests must stay green — SAFETY NET first).
- [x] 2.3 RED: unit test a pure `buildCreatePayload(tipo, propuesta, proveedorId, url)` — factura → `{ proveedor_id, fecha_emision, monto_total, numero?, archivo_url, origen: 'IA' }` (only non-null fields); pago → `{ proveedor_id, monto, fecha, metodo, comprobante_url, origen: 'IA' }` with NO `factura_id`. Triangulate with null fields omitted.
- [x] 2.4 GREEN: implement `buildCreatePayload` in the ia-vision feature.
- [x] 2.5 RED: unit test the auto-match utility — normalized-exact unique match returns the supplier; partial/multiple/none returns null (drive `buscarProveedores` via MSW). Normalization = lowercase + strip accents + trim (mirror RN-VINC).
- [x] 2.6 GREEN: implement the auto-match utility/hook reusing `useBuscarProveedores` / `buscarProveedores`.

## 3. Frontend — modal becomes terminal (ia-vision-frontend, factura path)

- [x] 3.1 SAFETY NET: run the existing `PropuestaIAModal` / factura-page IA tests and capture the baseline; identify the C-15 test that asserts "confirm does NOT POST".
- [x] 3.2 RED: rewrite that regression test to assert the modal's single "Confirmar" (factura) fires exactly one `POST /api/facturas` with `origen: 'IA'`, `archivo_url` = uploaded `secure_url`, and `proveedor_id` = selected supplier; and that the manual `FacturaForm` is NOT rendered on the IA path. Add a code comment referencing D-26 (RN-IA-04 governs extraction, not the human confirm).
- [x] 3.3 RED: test that the picked `File` is carried through confirm and uploaded (Cloudinary mocked) before the create fires; upload failure keeps the modal open and fires no create.
- [x] 3.4 GREEN: change `PropuestaIAModal` to be terminal — on confirm: upload image → `buildCreatePayload` → call injected `useCreateFactura` → report created via `onCreated`. Replace `onConfirm(propuesta, proveedor)` with `onCreated(created)`; thread the `File` from `ImagenPicker`/`extracting` state into confirm.
- [x] 3.5 RED: test a 422 from `POST /api/facturas` keeps the modal open showing the error (no close, no redirect).
- [x] 3.6 GREEN: handle the create error state in the modal.
- [x] 3.7 GREEN: update `FacturaFormPage` — pass `useCreateFactura` into the modal; `onCreated` redirects to `/proveedores/${created.proveedor_id}` (already the form behavior); the IA path no longer sets `mode='form'`. Manual path unchanged. REFACTOR; keep edit-mode and manual-mode tests green.

## 4. Frontend — auto-match + inline supplier create in the modal (ia-vision-frontend)

- [x] 4.1 RED: test `PropuestaFacturaFields` pre-selects the supplier on a normalized-exact unique match (Confirmar enabled) and shows it as changeable.
- [x] 4.2 RED: test that no/partial match shows a "Crear «X»" inline action with the detected name editable; confirming it calls `useCreateProveedor` with `{ nombre, categoria: 'OTRO' }` and sets the created supplier as selected (no navigation).
- [x] 4.3 RED: test the user can override the auto-match (clear + pick a different supplier); null `proveedor_nombre` leaves selection empty and Confirmar disabled.
- [x] 4.4 GREEN: wire auto-match + inline create into `PropuestaFacturaFields` (reuse `SupplierSearch`'s create path / `useCreateProveedor`). TRIANGULATE across match/no-match/override.

## 5. Frontend — pago path (mirror of factura) (ia-vision-frontend + pagos-frontend)

- [x] 5.1 RED: add a `SupplierSearch` + auto-match to `PropuestaPagoFields` (today it has none) — mirror the factura field tests (match pre-selects, no-match inline-creates, override works).
- [x] 5.2 GREEN: implement supplier control + auto-match in `PropuestaPagoFields`.
- [x] 5.3 RED: rewrite the C-15 pago regression test to assert the modal's single "Confirmar" (pago) fires exactly one `POST /api/pagos` with `origen: 'IA'`, `comprobante_url` = uploaded url, `proveedor_id` = selected, and NO `factura_id` (RN-PAG-01); manual `PagoForm` not rendered on the IA path.
- [x] 5.4 RED: test the read image uploads with `tipo='comprobante'` and becomes `comprobante_url`.
- [x] 5.5 GREEN: make the pago branch of `PropuestaIAModal` terminal via the shared confirm helper (`useCreatePago`).
- [x] 5.6 RED: test `PagoFormPage` create success (manual AND IA) redirects to `/proveedores/${created.proveedor_id}` (not `/pagos`).
- [x] 5.7 GREEN: fix `PagoFormPage.handleSuccess` (manual) to redirect to `/proveedores/${saved.proveedor_id}`; wire `useCreatePago` + `onCreated` redirect into the modal for the IA path. Manual/edit paths unchanged.

## 6. KB + docs

- [x] 6.1 Update `knowledge-base/05_reglas_de_negocio.md`: RN-IA-04 (clarify: extraction endpoint never persists; the human confirm inside the modal now creates the resource), RN-IA-06 (frontend pre-matches the supplier; human confirms/overrides), RN-IA-07 (rate limit configurable by env, default ~60/hour). Reflect the single-confirm flow.
- [x] 6.2 Add `knowledge-base/09_decisiones_y_supuestos.md` D-26: single-confirm IA flow — modal terminal (creates resource), auto-match + inline supplier create, image persisted, rate limit configurable; explicitly supersedes the C-15 "modal no POST" decision (D-19 UX note updated accordingly). Note RN-IA-04 backend invariant is intact.

## 7. Verification

- [x] 7.1 Run the full backend suite (`.venv/Scripts/python.exe -m pytest`) — all green, including the updated rate-limit/config tests.
- [x] 7.2 Run the full frontend suite (Vitest) in the web container — all green, including the inverted modal regression tests and the frontend-lint regression guard.
- [x] 7.3 `openspec validate c-21-ia-single-confirm-flow` passes; confirm the delta specs match what was implemented.
