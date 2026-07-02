## Context

The C-14 spec (`openspec/specs/ia-vision-backend/spec.md`) and the C-15 frontend proposal (`openspec/changes/c-15-ia-vision-frontend/proposal.md` OPEN QUESTION 1) both assert that the existing manual `POST /api/facturas` and `POST /api/pagos` endpoints stamp `origen=IA` when the IA confirmation path persists a vision-extracted document. The C-15 frontend takes Path A (no `origen` from the client) for its initial ship and files a follow-up hotfix (this change) so the C-15 flow can opt in to Path B later without re-architecting the backend.

**Diagnosis (verified in code on 2026-06-28):**

| File | Line | Current state |
|---|---|---|
| `facturas-proveedores-api/app/schemas/factura.py` | 58-76 (`FacturaCreate`) | No `origen` field declared. Pydantic v2 default `extra="ignore"` → client-sent `origen` is silently dropped. |
| `facturas-proveedores-api/app/schemas/pago.py` | 35-60 (`PagoCreate`) | No `origen` field declared. `model_config = ConfigDict(extra="forbid")` at line 54 → client-sent `origen` would return 422. |
| `facturas-proveedores-api/app/services/factura_service.py` | 273 | `origen=OrigenDocumento.MANUAL` hardcoded inside `FacturaService.crear()`. |
| `facturas-proveedores-api/app/services/pago_service.py` | 169 | `origen=OrigenDocumento.MANUAL` hardcoded inside `PagoService.crear()`. |

`OrigenDocumento` is already imported in both schema files (line 26 of `factura.py`, line 29 of `pago.py`), so no new import is needed. The enum lives in `app/models/enums.py:26-30` with `MANUAL` and `IA` values.

## Goals / Non-Goals

**Goals:**
- Enable the C-15 frontend to send `origen: 'IA'` on the create payload and have the value persisted as-is on `Factura.origen` / `Pago.origen`.
- Preserve 100% backward compatibility: clients that omit `origen` get exactly the same `MANUAL` row as before.
- Keep the `OrigenDocumento` enum unchanged.
- Add 3 test cases per create endpoint (persists / defaults / rejects invalid).
- TDD: red → green → triangulate, no implementation without a failing test.

**Non-Goals:**
- New endpoints (the existing `POST /api/facturas` and `POST /api/pagos` are reused).
- Schema migration (the `origen` column already exists; C-08/C-10 created it).
- Changes to other endpoints (`FacturaUpdate`, `PagoUpdate`, listing, get, delete) — `origen` stays immutable post-create.
- New validation rules beyond Pydantic's enum check on the type annotation.
- Changes to `OrigenDocumento` enum members.
- Frontend changes (C-15, separate change, depends on this one).
- Backfilling historical rows (`UPDATE factura SET origen='IA' WHERE ...`) — out of scope; the IA tracking only applies to documents created after the C-15 frontend opt-in.

## Decisions

### D-1: Add `origen` as `Optional[OrigenDocumento] = None` to both create schemas

**Why this over a non-Optional required field with no default:** backward compatibility. The C-09 / C-11 frontend manual flows do NOT send `origen` (the backend always stamped `MANUAL`). Making it required would break the existing C-09 / C-11 callers immediately. With `Optional` + `= None`, the new behavior is opt-in: C-15 will start sending `origen='IA'`, the manual flow keeps omitting it, and the service falls back to `MANUAL` via `datos.origen or OrigenDocumento.MANUAL`.

**Why this over removing `extra="forbid"` from `PagoCreate`:** `extra="forbid"` is part of the triple-enforcement that prevents a client from smuggling `factura_id` (RN-PAG-01). Removing it would re-open a hole. Declaring `origen` as a known field is enough — `forbid` only rejects unknown fields, not optional known ones.

**Why this over a custom validator that strips `origen` from the payload and replaces with `MANUAL`:** the C-15 frontend explicitly wants to persist `IA`, not `MANUAL`. A strip-and-replace approach would not solve the actual problem.

### D-2: Services use `datos.origen or OrigenDocumento.MANUAL` (NOT `datos.origen if datos.origen is not None else MANUAL`)

**Why:** the `or` pattern is the idiomatic Python falsy check for `None` / missing. Both `OrigenDocumento.MANUAL` and `OrigenDocumento.IA` are truthy enum members, so `datos.origen or MANUAL` works for `None`, `MANUAL`, and `IA` correctly. The explicit `is not None` form is equivalent but noisier. There is no risk of an empty-string or zero-value `OrigenDocumento` member that the `or` would mishandle (enum values are non-empty strings).

### D-3: Tests cover all 3 paths (RED → GREEN → TRIANGULATE)

- **Path A — `origen='IA'` persists as `IA`** (the C-15 happy path).
- **Path B — `origen` omitted persists as `MANUAL`** (backward-compat regression guard for the C-09 / C-11 manual flow).
- **Path C — `origen='INVALID'` returns 422** (Pydantic enum validation; defense in depth so a typo in the C-15 payload surfaces a clear error).

The integration test `tests/test_factura_integration.py:170` (`assert data["origen"] == "MANUAL"`) and `tests/test_pago_integration.py:185` (same) act as regression guards for Path B at the HTTP layer.

### D-4: One existing test must be updated, not just added

`tests/test_pago_schemas.py:176-188` (`test_origen_rejected`) explicitly asserts that `PagoCreate(origen=IA)` raises a `ValidationError` because of `extra="forbid"`. After this change, `origen` becomes a known optional field, so the test no longer reflects the contract. The test is **replaced** (not deleted) with a positive parametrized test covering Paths A, B, C above. The corresponding test for `PagoUpdate` (`test_pago_schemas.py:287-292`) stays valid — `PagoUpdate` is NOT changed by this hotfix.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| A future change to `OrigenDocumento` (e.g., a new `IMPORTED` member) might require touching the schema annotations. | Documented in `tasks.md` as a follow-up consideration; type system will fail loudly on mismatch. |
| The C-09 / C-11 frontend manuals don't send `origen` and the C-15 frontend WILL. If the C-15 frontend mistakenly omits `origen`, the row is stamped `MANUAL` silently (no error). | Tests assert the C-15 happy path sends `origen='IA'`. The C-15 frontend proposal (Path B) explicitly documents this dependency. |
| A client that pre-existing sends `origen='IA'` on `FacturaCreate` (today it's silently dropped) will start getting `IA` rows post-deploy. | This is the **intended** behavior of the hotfix. No data corruption; the column was always meant to carry the value. |
| The `extra="forbid"` interaction — a misreading could lead to removing it. | `design.md` D-1 explicitly calls out that `forbid` is preserved. Reviewer should confirm `PagoCreate.model_config` line 54 is unchanged in the diff. |
| C-16 (test pollution) is in-flight. Running `test_factura_*` / `test_pago_*` mid-C-16 might surface flakiness unrelated to this change. | Tasks.md step 4 limits the regression run to the named buckets; the c-16 protected suite (`test_alembic_migration_0003.py`, `test_config.py`, `test_deps.py`) is the canonical regression gate. |

## Migration Plan

No migration. The `origen` column already exists in both `factura` and `pago` tables (added by C-08 / C-10). The change is purely application-layer:

1. Deploy backend with the 4-line fix.
2. The C-15 frontend can opt-in to sending `origen: 'IA'` on the create payload (separate change).
3. Rollback = revert the 4-line diff. The C-15 frontend still works (Path A) on the rolled-back backend.

No data backfill needed: documents created before the C-15 opt-in retain their `MANUAL` value, which is the correct historical record (they were not IA-loaded — the IA endpoint did not exist).
