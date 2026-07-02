# Tasks: c-12-cuenta-corriente-backend

> **Strict TDD discipline.** Every task follows: 0. Safety Net (only when modifying a file), 1. Understand, 2. RED (write a failing test that fails for the right reason), 3. GREEN (minimum code to pass), 4. TRIANGULATE (add ≥1 more case per behavior, watch all pass), 5. REFACTOR (keep tests green), 6. Mark complete.
>
> Test layers in this change:
> - **Unit** (no DB): Pydantic schema validation.
> - **Service** (real Postgres via testcontainers): FIFO + saldo + historial math, ownership, edge cases.
> - **Integration** (FastAPI `TestClient`): HTTP 200 / 401 / 404, end-to-end response shape.
>
> Fixtures: reuse `tests/conftest.py::pg_container`, `db_url`, `env_vars`, `client`. Reuse the user / proveedor / factura / pago factory patterns from `tests/test_factura_service.py` and `tests/test_pago_service.py` (no copy/paste — extract helpers to `tests/_factories.py` if they grow, but for this change inlining is fine).

## Task 1 — Schemas (`app/schemas/cuenta_corriente.py`)

- [x] 1.1 Write `tests/test_cuenta_corriente_schemas.py` (RED): test the three response schemas
  - `CuentaCorrienteResponse` validates a fully-populated payload (all three blocks, signed saldo, mixed historial)
  - `CuentaCorrienteResponse` validates a payload with empty `facturas_con_estado` and empty `historial`
  - `FacturaConEstado` validates with all fields including `estado` (PENDIENTE / PARCIAL / PAGADA)
  - `FacturaConEstado` has NO `items` field and NO `items_sum_mismatch` field (use `model_fields` introspection — these fields MUST be absent)
  - `EntradaHistorial` validates with `tipo="FACTURA"`, `tipo="PAGO"`
  - `EntradaHistorial` rejects `tipo` outside the literal set
  - `EntradaHistorial` rejects negative `monto` (Pydantic constraint — use `Field(gt=0)`)
  - `EntradaHistorial.saldo_acumulado` accepts positive, zero, and negative
  - `CuentaCorrienteResponse.model_validate(result)` works on a service-layer data class (from_attributes=True on the schemas)
  - `FacturaConEstado` and `EntradaHistorial` set `from_attributes=True`
  - Run pytest: tests fail because the file does not exist (`ModuleNotFoundError: app.schemas.cuenta_corriente`).
- [x] 1.2 Create `app/schemas/cuenta_corriente.py` (GREEN): three classes with the shapes from `design.md` §"Pydantic schema shape — D5 in detail". `from_attributes=True` on all three. `EntradaHistorial.monto = Field(gt=0, ...)`. Use `Literal["FACTURA", "PAGO"]` for `tipo`. Run pytest: all schema tests pass.
- [x] 1.3 Triangulate (MANDATORY): add tests for the **boundary values** of `saldo` — `Decimal("0.00")`, `Decimal("0.01")`, `Decimal("-0.01")`, large amounts (e.g., `Decimal("99999999.99")`); for `FacturaConEstado` test that `fecha_vencimiento` and `archivo_url` are optional; for `EntradaHistorial` test that `fecha_emision` (from a factura) and `fecha` (from a pago) round-trip correctly as `date` not `datetime`. Run pytest: all pass.
- [x] 1.4 Refactor: confirm no field uses `float`; all amounts are `Decimal`; UUID serialization is via Pydantic v2 defaults.

## Task 2 — `_build_historial` helper (pure function, no DB)

- [x] 2.1 Write `tests/test_cuenta_corriente_historial_helper.py` (RED): test the pure merge function
  - Empty facturas + empty pagos → `[]`
  - One factura, no pagos → one entry, `tipo=FACTURA`, `saldo_acumulado=monto`
  - One pago, no facturas → one entry, `tipo=PAGO`, `saldo_acumulado=-monto`
  - Two facturas (F1=1000 on day 1, F2=500 on day 2) + one pago (P1=300 on day 1.5) → `[F1(1000, 1000), P1(300, 700), F2(500, 1200)]`
  - Two rows with the same `fecha` are ordered by `(created_at ASC, id ASC)` deterministically
  - Three rows, mixed types, with saldo_acumulado row-by-row adding facturas and subtracting pagos
  - The function takes plain Python dataclasses / pydantic models with `.id`, `.monto` or `.monto_total`, `.fecha` or `.fecha_emision`, `.created_at` (facturas) — it does NOT need ORM entities (pure function, no DB)
  - Run pytest: tests fail because the function does not exist.
- [x] 2.2 Implement `_build_historial(facturas, pagos) -> list[dict]` (GREEN): a private module-level function in `app/services/proveedor_service.py` (or, if it feels misplaced, in a new `app/services/cuenta_corriente_helpers.py` — but for a 20-line function, inlining is fine). Returns a list of dicts with the same field names as `EntradaHistorial`. Uses Python's `sorted` with key `(fecha, created_at, id)`. Walks the list computing `saldo_acumulado` as a running sum. Run pytest: all tests pass.
- [x] 2.3 Triangulate (MANDATORY): add tests for **determinism under identical `fecha`** — create 3 rows with the same date and explicit `created_at` order, assert the output order is stable across two calls; add a test for **large lists** (1000 facturas + 1000 pagos alternating) to confirm the function scales (no `O(n²)` mistakes); add a test for **mixed signs at the boundary** (a pago of 0.01 that exactly cancels the previous factura's last 0.01). Run pytest: all pass.

## Task 3 — `ProveedorService.get_cuenta_corriente` (the orchestrator)

- [x] 3.1 Write `tests/test_cuenta_corriente_service.py` (RED): test the service method end-to-end against real Postgres
  - One user, one supplier, no movimientos → `CuentaCorrienteResult` (or dataclass) with `saldo=Decimal("0.00")`, empty lists
  - One user, one supplier, one factura 1500, no pagos → `saldo=1500.00`, one `FacturaConEstado` with `estado=PENDIENTE`, one historial entry with `saldo_acumulado=1500.00`
  - One user, one supplier, one factura 1000, one pago 300 → `saldo=700.00`, `estado=PARCIAL` (corrected from proposal: pool 300 < 1000 → 0<aplicado<monto_total → PARCIAL per RN-FIFO), historial `[FACTURA 1000 (1000), PAGO 300 (700)]`
  - One user, one supplier, one factura 1000, one pago 1500 → `saldo=-500.00`, `estado=PAGADA` (pool 1500 > 1000), historial `[FACTURA 1000 (1000), PAGO 1500 (-500)]`; `saldo < 0` (saldo a favor)
  - One user, one supplier, one factura 1000, one pago 1000 → `saldo=0.00`, `estado=PAGADA` (boundary), historial ends at 0
  - One user, one supplier, two facturas (F1=600, F2=400), one pago of 700 → FIFO: F1 PAGADA, F2 PARCIAL, `saldo=300.00`, historial `[F1 600 (600), F2 400 (1000), PAGO 700 (300)]`
  - **Cross-check invariant**: `historial[-1].saldo_acumulado == result.saldo` for the 5 non-empty scenarios above
  - Foreign supplier (user A's supplier requested by user B) → raises 404
  - Soft-deleted supplier (own supplier with `deleted_at` set) → raises 404
  - Missing supplier → raises 404
  - Determinism: two facturas with the same `fecha_emision` → the order matches the insertion order (created_at ASC) and is stable across two calls
  - Run pytest: tests fail because the method does not exist (`AttributeError`).
- [x] 3.2 Implement `ProveedorService.get_cuenta_corriente(usuario_id, proveedor_id) -> CuentaCorrienteResult` (GREEN): in `app/services/proveedor_service.py`. Reuses `_get_owned`, `self._repo.get_saldo_por_proveedor`, imports `FacturaRepository` and `PagoRepository` (instantiate fresh from the session), imports `_compute_estado_fifo` from `app.services.factura_service`, calls `_build_historial`. Returns a small dataclass `CuentaCorrienteResult(proveedor_id, saldo, facturas_con_estado, historial)` where `facturas_con_estado` is a list of `FacturaConEstado` data classes (mirroring the C-08 `FacturaConEstado` shape — same class can be reused, see step 3.4) and `historial` is a list of dicts (the Pydantic schema is built in the router). Run pytest: all tests pass.
- [x] 3.3 Triangulate (MANDATORY):
  - **Three-factura waterfall with partial pool**: F1=1000 day 1, F2=1000 day 2, F3=1000 day 3, pool=1500 → F1=PAGADA, F2=PARCIAL, F3=PENDIENTE; historial `[F1 1000 (1000), F2 1000 (2000), P3 1500 (500), F3 1000 (1500)]`. Cross-check: `1500 == saldo` (correct).
  - **Pool excedido**: pool=10000 with one factura 100 → `estado=PAGADA`, `saldo=-9900.00`, last historial entry `saldo_acumulado = -9900.00`.
  - **Pool at exactly the boundary of one factura**: pool=100, factura=100 → `estado=PAGADA` (not PARCIAL); `saldo=0.00`.
  - **Soft-deleted factura is excluded**: create one active factura + one soft-deleted factura; the soft-deleted one is NOT in `facturas_con_estado` and NOT in `historial`; the saldo reflects only the active one.
  - **Soft-deleted pago is excluded**: same pattern with pagos.
  - **Foreign supplier with movimientos**: even if user B has many facturas / pagos under a supplier of theirs, user A gets 404 and none of user B's data is in the response (cross-tenant test).
  - Run pytest: all pass.
- [x] 3.4 Refactor: confirm the `FacturaConEstado` data class from C-08 is reusable. If it is (same shape: `factura` + `estado`), import it from `app.services.factura_service` and reuse. If it is not (e.g., it requires `items` in the constructor), create a leaner local data class. Run pytest: all pass. **Decision: reused C-08 `FacturaConEstado` with empty `items=[]` and `items_sum_mismatch=False` defaults — the cuenta-corriente view omits these via the Pydantic schema (FacturaConEstado has no `items`/`items_sum_mismatch` fields declared).**
- [x] 3.5 Safety Net (only if Step 3.2 modified an existing file): re-run `pytest tests/test_proveedor_service.py tests/test_proveedor_integration.py tests/test_factura_service.py tests/test_factura_integration.py tests/test_pago_service.py tests/test_pago_integration.py` — the previous tests must still pass. The new method is additive; the old ones must not regress.

## Task 4 — Router endpoint (`GET /api/proveedores/{proveedor_id}/cuenta-corriente`)

- [x] 4.1 Write `tests/test_cuenta_corriente_integration.py` (RED): HTTP integration tests via `TestClient`
  - Unauthenticated → 401
  - Own supplier with mixed movimientos → 200, body has all three blocks, `facturas_con_estado` length matches expected, `historial[-1].saldo_acumulado == saldo`
  - Own supplier with no movimientos → 200, `saldo = "0.00"`, empty lists
  - Own supplier with pool excedido → 200, `saldo` is a negative decimal string
  - Foreign supplier (user B) → 404, no payload leak
  - Own soft-deleted supplier → 404
  - Missing supplier (random UUID) → 404
  - Body is JSON-parseable; `saldo` is a string (Pydantic v2 Decimal default)
  - Run pytest: tests fail because the route does not exist (404 from the catch-all route handler, or 405 method not allowed).
- [x] 4.2 Add the route to `app/routers/proveedores.py` (GREEN): declared **between** `/buscar` and `/{proveedor_id}` to avoid path shadowing. Uses `Annotated` style with the existing `CurrentUser` / `DbSession` aliases. Returns `CuentaCorrienteResponse.model_validate(result)`. **No** `session.commit()`. Run pytest: all pass.
- [x] 4.3 Triangulate (MANDATORY): test that the response is **stable across two calls** (no caching tricks — same input, same output); test that the route is documented in OpenAPI (`/docs` shows the new path with the correct summary and response schema); test that calling the endpoint with a `POST` or `PUT` returns 405 (method not allowed). Run pytest: all pass.
- [x] 4.4 Safety Net: re-run the full pre-existing router test suite (`pytest tests/test_proveedor_integration.py tests/test_factura_integration.py tests/test_pago_integration.py`) — no regression in `/buscar`, `/{proveedor_id}`, or any sibling route.

## Task 5 — No-persistence regression tests (project-wide invariant guards)

- [x] 5.1 Write `tests/test_cuenta_corriente_no_persistence.py` (RED): assert the hard rule
  - Introspect the `Proveedor` SQLModel — assert it has no `saldo` attribute / column
  - Introspect the `Factura` SQLModel — assert it has no `estado` attribute / column
  - Introspect the `Pago` SQLModel — assert it has no `factura_id` attribute / column (re-asserts C-10 invariant from the cuenta-corriente view)
  - Patch the `Session` (e.g., with a `before_flush` hook in the test) to capture any INSERT / UPDATE / DELETE; call the endpoint; assert no mutation was issued
  - Run pytest: the persistence-introspection tests pass (those are stable across calls); the mutation-capture test must currently fail (it does not exist). After the test exists, it passes.
- [x] 5.2 No code change required from this task — it is purely a **regression guard**. The test will fail loudly if a future change accidentally adds `saldo` / `estado` / `factura_id` columns. Run pytest: all pass.
- [x] 5.3 Triangulate: add a test that asserts the **service method** also issues no mutations (not just the router). The service is the canonical place; the router is a thin wrapper.

## Task 6 — Cross-spec sanity: re-run the full backend test suite

- [x] 6.1 Run `pytest -x` (or `pytest` with parallel if configured) on the **entire** `facturas-proveedores-api/tests/` directory. All pre-existing tests (C-02 through C-10) must still pass; the new C-12 tests must all pass. **Result: 539 passed, 2 pre-existing alembic migration failures (unrelated to C-12, confirmed by stashing C-12 work and re-running on clean C-10 master).**
- [x] 6.2 If anything regresses, fix it before marking the change complete. The C-12 method is additive — it must not break C-08 FIFO consumers or C-10 pago listings. **No regression. The 2 alembic failures predate C-12.**
- [x] 6.3 Run `openspec validate c-12-cuenta-corriente-backend` to confirm the change artifacts are well-formed (all four artifacts present, proposal references the right upstream archived changes, no dangling references). **Result: `Change 'c-12-cuenta-corriente-backend' is valid`.**

## Review Workload Forecast

- **Estimated changed lines**: ~600 (3 schemas, 1 service method + 1 helper, 1 router block, ~4 test modules)
- **Chained PRs recommended**: **No** — single coherent backend feature slice, mirrors the C-08 / C-10 shape. The change is read-only and additive, so the diff is reviewable in one pass.
- **400-line budget risk**: **Low**. The largest files are the test modules; the production code is small. The endpoint is read-only and has no migration, no auth change, and no business-logic invention — the algorithm is reused verbatim from C-08.
- **Breaking surface**: none. The endpoint is a new sub-route; no existing endpoint contract changes. The `FacturaConEstado` data class (if reused from C-08) is internal; the response schema is brand new.
- **C-13 (cuenta-corriente-frontend) unblocked**: this change exposes `GET /api/proveedores/{id}/cuenta-corriente` and the `CuentaCorrienteResponse` shape. C-13 can build the React page on top.
- **C-14 / C-15 (IA)**: unaffected. The cuenta-corriente view is the **view**; IA writes to `Factura` / `Pago` tables. When IA introduces an `origen=IA` row, the cuenta-corriente will include it automatically (it does not filter on `origen`).

## Definition of done (apply phase)

- [ ] All tasks 1–6 are checked off; all tests pass on real Postgres.
- [ ] The change introduces no `saldo` / `estado` / `factura_id` column anywhere (test 5.1 asserts this).
- [ ] The router file `app/routers/proveedores.py` lists the new route in the correct position (between `/buscar` and `/{proveedor_id}`); FastAPI OpenAPI docs (`/docs`) show the new endpoint with `CuentaCorrienteResponse` as the response model.
- [ ] No new Python package is added.
- [ ] No Alembic migration is added (no schema change).
- [ ] The full test suite is green; the C-12 test modules are part of the suite.
- [ ] `openspec validate c-12-cuenta-corriente-backend` reports no errors.
</content>
