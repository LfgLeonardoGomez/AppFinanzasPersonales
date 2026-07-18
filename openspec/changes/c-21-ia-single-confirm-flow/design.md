## Context

The IA-vision load flow was built in C-14 (backend extractor) and C-15 (frontend modal). C-15 deliberately made `PropuestaIAModal` a **pre-fill-only** surface (D-19, RN-IA-04 frontend): the modal reads the image, the user confirms, and control falls back to the big manual form (`FacturaForm` / `PagoForm`), which fires the real `POST` on its own submit. That was a safe first cut, but in practice it forces **two confirmations across two different UIs** and throws away two things the IA already produced: the image it read (never persisted as comprobante) and the supplier name it detected (not matched, so the user retypes/searches it).

Current concrete state (verified in code):

- `PropuestaIAModal.tsx` — `onConfirm(propuesta, selectedProveedor)` closes the modal; the parent sets `iaPrefill` and switches to `mode='form'`. The picked `File` is **not** carried through the confirm. Supplier selection uses the shared `SupplierSearch` with `value=null` (no auto-match; RN-IA-06 read strictly).
- `PropuestaFacturaFields.tsx` — renders `SupplierSearch` (value null) + a "Detectado por IA: X" hint. `PropuestaPagoFields.tsx` — **has no supplier control at all** (the pago modal never selected a supplier; the pago form did).
- `FacturaFormPage.handleSuccess` → `navigate('/proveedores/${saved.proveedor_id}')` (redirect already correct). `PagoFormPage.handleSuccess` → `navigate('/pagos')` (wrong target).
- `FileUploadField.tsx` — the reference upload flow: `useCloudinaryPreset(tipo)` → `fetch(https://api.cloudinary.com/v1_1/{cloud}/auto/upload, FormData{file, upload_preset, api_key, timestamp, signature})` → `secure_url`.
- `SupplierSearch.tsx` — **already** supports inline creation with `useCreateProveedor.mutate({ nombre, categoria: 'OTRO' })` when there are no matches. `useBuscarProveedores(nombre)` (enabled ≥ 2 chars) backs the search; `buscarProveedores` calls `GET /api/proveedores/buscar?nombre=`.
- `useCreateFactura` / `useCreatePago` — take `FacturaCreate` / `PagoCreate`; `PagoCreate` has no `factura_id` (`extra="forbid"` on the backend). Both already invalidate the cuenta-corriente cache on success.
- Backend `rate_limit_ia.py` — module constants `_IA_RATE_MAX_REQUESTS = 10`, `_IA_RATE_WINDOW_SECONDS = 3600`, read directly inside `rate_limit_ia`. `config.py` uses a read-through `_SettingsProxy` (C-16 D-1): every `settings.X` re-reads `os.environ`.

Constraints: TS strict, no `any`; invariants (no persisted saldo/estado; pago never links to factura; `usuario_id` filtering in the service layer → 404; IA proposes / human confirms; Pydantic validation authoritative; Cloudinary + vision mocked in tests; Postgres real via testcontainers; TDD).

## Goals / Non-Goals

**Goals:**
- One confirmation for the IA path: the modal creates the resource (factura or pago) directly.
- Auto-match the detected supplier against the user's own suppliers; offer inline creation when there's no match — all inside the modal.
- Persist the IA-read image as the comprobante (`archivo_url` / `comprobante_url`).
- Redirect to `/proveedores/:id` after creating (fix the pago gap).
- Make the IA rate limit configurable by env with a comfortable MVP default (~60/hour).
- Factor the modal so factura and pago share the terminal-create logic.

**Non-Goals:**
- Changing the extraction endpoints or their contract (RN-IA-04: extraction still never persists).
- Changing the manual path (mode selector → form stays exactly as-is).
- Removing the big form (it remains the manual entry point and the edit surface).
- Multi-file upload, PDF-through-IA, or any new backend persistence for facturas/pagos (payloads are the existing C-08/C-10 shapes).
- Redis-backed rate limiting (still in-memory, single-instance MVP).

## Decisions

### D1 — Terminal modal owns the create; supersede C-15 "modal doesn't POST"

The modal becomes terminal for the IA path. On "Confirmar", the modal (not the form) fires `useCreateFactura` / `useCreatePago`. Rationale: the whole point is one confirm in one UI; routing back to the form is exactly the friction we're removing.

- The page passes the create mutation into the modal (the page owns the hook so it can also react to success and redirect). Concretely: `PropuestaIAModal` gains callbacks/props for "create and report the created resource" rather than "return the proposal to the parent". Simplest shape: `onCreated(created: FacturaResponse | PagoResponse)` replaces the current `onConfirm(propuesta, proveedor)`; the page's `onCreated` does the redirect. The modal internally builds the payload and calls the injected mutation.
- **Alternative considered:** keep `onConfirm` returning the proposal and have the page create. Rejected: the page would need to also own the image upload and supplier-create orchestration that naturally lives where the proposal state and the picked `File` already are (inside the modal). Keeping the orchestration in one place (the modal) is cleaner and keeps the page a thin router.
- RN-IA-04 is preserved because it constrains the **extraction endpoint**, not the human confirm. The design note and KB (D-26) must state this explicitly so a future reader doesn't think we regressed the invariant. The C-15 regression test that asserted "the modal's confirm does NOT POST" is **intentionally inverted** by this change and must be rewritten to assert the modal's confirm DOES POST exactly once (with `origen: 'IA'`).

### D2 — Factor a shared `useConfirmIALoad` hook (or reducer extension) for factura+pago symmetry

The create flow is identical in shape for both types: upload image → build payload → mutate → report created. Only three things differ: endpoint/mutation, the payload field names (`archivo_url` vs `comprobante_url`, `monto_total`+`numero`+`fecha_emision` vs `monto`+`fecha`+`metodo`), and the Cloudinary `tipo` (`'factura'` vs `'comprobante'`). 

Decision: extract a `tipo`-parameterized helper (a hook `useConfirmIALoad(tipo)` returning `{ confirm(propuesta, proveedor, file), isPending, error }`, or a small pure `buildCreatePayload(tipo, propuesta, proveedorId, url)` plus a thin orchestration). The modal calls it; the two `PropuestaXFields` components stay presentational. This keeps the pago path a true mirror of the factura path with no copy-paste divergence.

- **Alternative considered:** two separate confirm handlers inline in the modal. Rejected: duplicates the upload + error handling; drift risk (exactly the class of bug D-24/enum-drift showed).

### D3 — Image upload reuses the `FileUploadField` mechanism, extracted to a shared function

Extract the raw upload (preset → `fetch` to Cloudinary → `secure_url`) into a reusable async function (e.g. `uploadToCloudinary(file, preset)` in a shared module) that both `FileUploadField` and the modal call. The preset is fetched with `useCloudinaryPreset(tipo)` (already shared between facturas and pagos). Upload happens **on confirm** (not on pick) so a cancelled modal costs no upload. On upload failure the modal stays open and shows the error; no create fires.

- **Ordering:** upload first, then create. If the create fails validation (422), the image is already in Cloudinary (orphaned) — acceptable for the MVP (same as today's form flow, where a failed create also orphans an uploaded file). Documented as a known trade-off, not worth a cleanup job at MVP scale.
- **Alternative considered:** send the raw file to the backend and let it upload. Rejected: the whole app uses the signed-preset direct-to-Cloudinary pattern; introducing a backend upload path just for IA would fork the architecture.

### D4 — Auto-match: frontend, normalized-exact only, pre-select as a changeable suggestion

On entering `proposal`, if `proveedor_nombre` is non-null, query `buscarProveedores(proveedor_nombre)` and pre-select **only** on a unique normalized-exact match (lowercase, strip accents, trim — mirror RN-VINC's normalization). Partial/"contains" matches are shown as suggestions (via the existing `SupplierSearch`) but NOT auto-selected, to avoid picking the wrong supplier. The pre-selection is presented as changeable.

- This satisfies RN-IA-06 (match is a frontend responsibility; the human still confirms and can override). RN-IA-06's spec text in C-15 said the modal starts with `value=null` "even on exact match"; **this change supersedes that** for the auto-match (it's the user's own data, and the human still confirms). KB RN-IA-06 wording must be updated to reflect "frontend pre-matches; human confirms/overrides".
- The pago modal must gain a supplier control (today `PropuestaPagoFields` has none). Add `SupplierSearch` + the same auto-match to the pago fields so both types select a supplier in the modal.
- **Alternative considered:** auto-select on any (including partial) match. Rejected: high false-positive risk with "contains" matching; a wrong supplier corrupts the cuenta corriente.

### D5 — Inline supplier creation reuses `SupplierSearch`'s existing create path

`SupplierSearch` already creates inline with `{ nombre, categoria: 'OTRO' }` when there are no matches. The modal's "Crear «X»" is the same capability surfaced with the detected name pre-filled and editable. Reuse `useCreateProveedor`; on success set it as `selectedProveedor`. No new API. `ProveedorCreate` only requires `nombre` (verified: `categoria?` defaults, all else optional).

### D6 — Rate limit configurable via settings, read at evaluation time

Add to `Settings`: `IA_RATE_MAX_REQUESTS: int = Field(default=60, gt=0)` and `IA_RATE_WINDOW_SECONDS: int = Field(default=3600, gt=0)`. `rate_limit_ia` reads `settings.IA_RATE_MAX_REQUESTS` / `settings.IA_RATE_WINDOW_SECONDS` at call time (the C-16 proxy makes each access live), replacing the module constants. Keep the module-level names exported for the test helpers but source them from settings, or update the tests to set env vars. Document the two vars in `.env.example`.

- **Why read at call time, not import:** the C-16 D-1 contract forbids freezing settings at import; the limiter must read through the proxy so tests (and prod) can change the value via `os.environ` without `cache_clear()`. The existing C-14 rate-limit tests set counts of 10 — they must be updated to drive the limit via env (e.g. set `IA_RATE_MAX_REQUESTS` low) rather than assuming the constant.
- Default 60/hour: comfortable for a single-user MVP, still bounds runaway external-API spend.

### D7 — Redirect after create is uniform

Both create paths (manual form and IA modal) navigate to `/proveedores/${created.proveedor_id}` with a success message. Factura already does this in `handleSuccess`; pago's `handleSuccess` changes from `/pagos` to `/proveedores/${saved.proveedor_id}`. The IA modal reports the created resource up to the page, which performs the same redirect.

## Risks / Trade-offs

- **[Inverting the C-15 "modal does not POST" regression test]** → The C-15 suite explicitly asserts the modal's confirm makes no POST. That test now encodes the OLD behavior and will fail by design. Mitigation: in the same task that makes the modal terminal, rewrite that test to assert exactly one POST with `origen: 'IA'`, and add a note referencing D-26. Do NOT delete the RN-IA-04 backend "no DB writes during extraction" test — that invariant stands.
- **[Perceived RN-IA-04 regression]** → A reviewer may read "modal now POSTs" as breaking the invariant. Mitigation: KB D-26 + design D1 state that RN-IA-04 governs the extraction endpoint, which is unchanged; the human confirm creating the resource was always allowed.
- **[Orphaned Cloudinary upload on failed create]** → Upload precedes create; a 422 leaves the image unreferenced. Mitigation: accept for MVP (matches current form behavior); the modal stays open so the user usually corrects and re-confirms (re-upload → second orphan is possible but rare). No cleanup job at MVP scale.
- **[Auto-match false positive]** → Pre-selecting the wrong supplier corrupts the ledger. Mitigation: normalized-**exact**, unique-match only; always changeable; human confirms.
- **[Pago modal gains a supplier control it never had]** → New UI surface in `PropuestaPagoFields`; must match the factura fields' a11y and test contracts. Mitigation: reuse `SupplierSearch` and mirror the factura tests.
- **[Rate-limit test coupling]** → C-14 tests assume the hardcoded 10. Mitigation: update them to drive the limit via env; this is a safety-net update, flagged as a pre-existing-test change, not a silent break.

## Migration Plan

No data migration. Deploy is code-only. Backend: add the two settings (defaults keep behavior comfortable even if env unset) and `.env.example` docs. Frontend: ship the terminal modal. Rollback: revert the change; the extraction endpoints, payload shapes, and DB schema are untouched, so rollback is a pure code revert with no data implications.

## Open Questions

- None blocking. The three product decisions (rate limit configurable + ~60/hr default; inline supplier create with name-only, categoria OTRO, editable; applies to facturas AND pagos) are already decided by the user. Implementation-level choice between "hook `useConfirmIALoad`" vs "pure `buildCreatePayload` + inline orchestration" (D2) is left to the apply phase; either satisfies the specs.
