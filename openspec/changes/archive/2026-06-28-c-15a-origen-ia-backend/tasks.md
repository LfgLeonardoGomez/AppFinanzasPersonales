## 1. TDD RED — failing tests for `origen=IA` persistence

- [ ] 1.1 Add 3 failing tests in `tests/test_factura_schemas.py` (`TestFacturaCreate` class): `origen='IA'` accepted and parsed, `origen` omitted defaults to `None` on the schema (service stamps `MANUAL` — covered by service test), `origen='INVALID'` raises `ValidationError`.
- [ ] 1.2 Add 3 failing tests in `tests/test_factura_service.py` (`TestFacturaServiceCrear` or equivalent): `crear` with `origen='IA'` in the schema persists `OrigenDocumento.IA`; `crear` without `origen` persists `OrigenDocumento.MANUAL`; the existing `test_creates_factura_with_origen_manual` still passes (regression guard for the C-09 manual flow).
- [ ] 1.3 Replace the existing `test_origen_rejected` in `tests/test_pago_schemas.py:176` (the test asserts `PagoCreate` rejects `origen` via `extra="forbid"` — that contract is changing). New test: parametrized over the same 3 cases as 1.1 (`IA` / omitted / `INVALID`).
- [ ] 1.4 Add 3 failing tests in `tests/test_pago_service.py` mirroring 1.2 for the `Pago` create flow.
- [ ] 1.5 Add 1 regression test: `tests/test_pago_schemas.py::test_factura_id_rejected_extra_forbid` (line 133) and `test_any_unknown_field_rejected` (line 148) MUST still pass after the change — they guard `extra="forbid"` and the new `origen` field does not weaken that contract. Add a new test `test_origen_field_known_after_change` asserting that `origen` IS a declared field of `PagoCreate` (so `forbid` only rejects truly unknown fields).
- [ ] 1.6 Run the new tests in isolation. All 3 + 3 + 3 + 3 + 1 cases must FAIL (or raise) before any code is written. Document the failure mode (e.g., `PagoCreate` raises `extra_forbidden` on `origen=IA`; `FacturaCreate` silently drops it).

## 2. TDD GREEN — make the 4-line fix

- [ ] 2.1 `app/schemas/factura.py`: add `origen: OrigenDocumento | None = None` to `FacturaCreate` (1 line, after `archivo_url` on line 75). `OrigenDocumento` is already imported (line 26) — no new import.
- [ ] 2.2 `app/schemas/pago.py`: add `origen: OrigenDocumento | None = None` to `PagoCreate` (1 line, after `comprobante_url` on line 60). `OrigenDocumento` is already imported (line 29) — no new import. **Do NOT touch `model_config = ConfigDict(extra="forbid")` on line 54.**
- [ ] 2.3 `app/services/factura_service.py` line 273: change `origen=OrigenDocumento.MANUAL` to `origen=datos.origen or OrigenDocumento.MANUAL`.
- [ ] 2.4 `app/services/pago_service.py` line 169: same change as 2.3.
- [ ] 2.5 Re-run the new tests from step 1. All must PASS. Diff: 4 lines of code change + the new tests.

## 3. TDD TRIANGULATE — edge cases

- [ ] 3.1 Confirm `origen=OrigenDocumento.MANUAL` explicitly is accepted (not just `None` default). The `or` pattern on the service side handles `MANUAL` correctly (it's truthy); add a parametrized case to the test if not already covered.
- [ ] 3.2 Confirm `FacturaUpdate` and `PagoUpdate` still reject `origen` (they do — no field declared). No code change; just assert the existing `test_origen_rejected_in_update` (pago) and any factura-update equivalent still pass.
- [ ] 3.3 Confirm the existing integration tests `tests/test_factura_integration.py:170` and `tests/test_pago_integration.py:185` (`assert data["origen"] == "MANUAL"`) still pass — they are the HTTP-level regression guards for the C-09 / C-11 manual flows that don't send `origen`.

## 4. Regression — full test run on affected buckets

- [ ] 4.1 Run `pytest tests/test_factura_schemas.py tests/test_factura_service.py tests/test_factura_integration.py tests/test_factura_repository.py -v` from `facturas-proveedores-api/`. All previously-passing tests must still pass. New tests from step 1 must pass.
- [ ] 4.2 Run `pytest tests/test_pago_schemas.py tests/test_pago_service.py tests/test_pago_integration.py tests/test_pago_repository.py -v`. All previously-passing tests must still pass. New tests from step 1 must pass. The replaced `test_origen_rejected` is now `test_origen_persists_or_defaults_or_rejects_invalid` (or similar) and must pass.
- [ ] 4.3 Run the C-16 protected suite: `pytest tests/test_alembic_migration_0003.py tests/test_config.py tests/test_deps.py -v`. All 22 tests must still pass.

## 5. Final validation

- [ ] 5.1 `openspec validate c-15a-origen-ia-backend` from the repo root. Must report `Change 'c-15a-origen-ia-backend' is valid`.
- [ ] 5.2 Diff sanity check: confirm exactly 4 production-code lines changed across 4 files. No imports added (all 3 touched files already import `OrigenDocumento`). No `extra="forbid"` change. No new tests beyond the 3+3+3+3+1 cases from step 1. No accidental scope creep into `FacturaUpdate` / `PagoUpdate` / read endpoints.

## 6. Archive

- [ ] 6.1 `openspec archive c-15a-origen-ia-backend --yes --skip-specs` from the repo root. Verify the delta specs for `facturas-api` and `pagos-backend` are merged into `openspec/specs/facturas-api/spec.md` and `openspec/specs/pagos-backend/spec.md`. Verify the archived change is in `openspec/changes/archive/2026-06-28-c-15a-origen-ia-backend/`. Verify `openspec list --json` shows 0 active changes.
