# Proposal: c-12-cuenta-corriente-backend

## Why

C-08 (facturas-backend, archived 2026-06-21) ships the FIFO estado algorithm in `FacturaService._compute_estado_fifo` (RN-FIFO) and the `Factura` SQLModel with `FacturaItem`. C-10 (pagos-backend, archived 2026-06-27) ships the `Pago` SQLModel, the `PagoRepository.list_by_proveedor` already used by the FIFO pool, and the `PagoService` enforcing RN-PAG-01 (no `factura_id`). The cuenta-corriente **is** the product: a single supplier-facing view that says "le debés $X, estas son las facturas (con estado), así evolucionó la deuda en el tiempo". Today the data is in the DB but no endpoint assembles it. The frontend (C-13) is **fully blocked** until this view exists, and so is the manual-flow production target (CHANGES.md declares the product functional "from C-13"). This change delivers the missing endpoint by composing — not duplicating — the already-shipped C-06 saldo aggregate, the C-08 FIFO algorithm, and the C-10 pago CRUD. **Nothing derived is persisted; everything is computed on-demand in the service layer** (RN-SALDO, RN-FIFO, RN-HIST).

## What Changes

- New file `app/schemas/cuenta_corriente.py` with three Pydantic response schemas: `FacturaConEstado` (mirrors `FacturaResponse` without `items` — adds `estado: EstadoFactura`); `EntradaHistorial` (`tipo: Literal["FACTURA","PAGO"]`, `fecha: date`, `monto: Decimal`, `saldo_acumulado: Decimal`, plus `factura_id` or `pago_id` to identify the row); `CuentaCorrienteResponse` (`proveedor_id: UUID`, `saldo: Decimal`, `facturas_con_estado: list[FacturaConEstado]`, `historial: list[EntradaHistorial]`).
- Extend `app/services/proveedor_service.py` with a new public method `get_cuenta_corriente(usuario_id, proveedor_id) -> CuentaCorrienteResponse` that orchestrates (1) ownership check, (2) reuse of the existing `ProveedorRepository.get_saldo_por_proveedor` aggregate for `saldo` (RN-SALDO, no N+1), (3) reuse of the existing `_compute_estado_fifo` from `app/services/factura_service.py` for FIFO estado assignment (no algorithm duplication), (4) build the chronological `historial` (RN-HIST) by merging active facturas and active pagos for the proveedor, ordering by `(fecha ASC, created_at ASC, id ASC)`, and computing `saldo_acumulado` row by row.
- Add a new endpoint to the existing `app/routers/proveedores.py`: `GET /api/proveedores/{proveedor_id}/cuenta-corriente` → `CuentaCorrienteResponse` (200) / 404 (foreign / missing / soft-deleted supplier) / 401 (unauthenticated). The route is declared **after** `/buscar` and **before** `/{proveedor_id}` to avoid path shadowing (mirrors C-06 router note).
- A new pure helper `_build_historial(facturas, pagos) -> list[EntradaHistorial]` lives inside `proveedor_service.py` (or a small `cuenta_corriente_helpers.py` if it grows) — no DB access, fully unit-testable.
- No Alembic migration. **No `saldo` or `estado` column is added** to `proveedor` or `factura`. The endpoint is a read-only composition of already-stored data.
- New tests under `tests/test_cuenta_corriente_*.py` against real Postgres: schema validation, service-level FIFO/saldo/historial math, integration test against the HTTP endpoint, multi-tenant isolation (cross-user → 404), edge cases (no facturas, no pagos, supplier with only movimientos in one direction, pool excedido producing `saldo < 0`, deterministic tiebreak under identical `fecha_emision`).

## Capabilities

### New Capabilities

- `cuenta-corriente-backend`: The HTTP API that returns, per supplier, the on-demand `{ saldo, facturas_con_estado, historial }` triple computed from the active `Factura` and `Pago` rows. Enforces RN-SALDO (sign convention: positivo=deuda, cero=al día, negativo=a favor), RN-FIFO (PENDIENTE/PARCIAL/PAGADA via the existing FIFO algorithm, no SQL `WHERE estado`), and RN-HIST (merged chronological list with row-by-row `saldo_acumulado`). All authorization and all computation live in the service layer; nothing derived is persisted.

### Modified Capabilities

- `proveedores-api`: the existing `ProveedorService` is **extended** with one new public method, `get_cuenta_corriente`. The `GET /api/proveedores/{id}` contract, the `saldo` field on the supplier responses, and the soft-delete + `tiene_dependencias` behavior are unchanged. The supplier listing (`GET /api/proveedores`) is unaffected. Only one new sub-route is added. No requirement of the existing `proveedores-api` spec changes — a delta spec is **not** required (the addition is additive and isolated to a new sub-resource, `/{id}/cuenta-corriente`, which is the new capability's contract).

## Impact

- **Repo**: `facturas-proveedores-api` (backend). No frontend change — consumed by C-13.
- **New code**:
  - `app/schemas/cuenta_corriente.py` — three Pydantic response schemas (Pydantic v2, `from_attributes=True` on the data classes that wrap ORM entities).
  - `tests/test_cuenta_corriente_schemas.py` — schema-level validation.
  - `tests/test_cuenta_corriente_service.py` — service-level math (FIFO, saldo, historial) against real Postgres.
  - `tests/test_cuenta_corriente_integration.py` — HTTP integration via `TestClient`.
- **Modified code**:
  - `app/services/proveedor_service.py` — adds `get_cuenta_corriente(...)` and a private `_build_historial(...)` helper. Imports `_compute_estado_fifo` from `app.services.factura_service` (re-uses the exact same algorithm; no copy/paste).
  - `app/routers/proveedores.py` — adds `GET /{proveedor_id}/cuenta-corriente` (declared between `/buscar` and `/{proveedor_id}` to avoid route shadowing; `Annotated` style; thin handler that delegates to the service).
- **Reused code** (no new Python packages):
  - `FacturaRepository.list_by_proveedor` (C-08) — already returns facturas in FIFO order.
  - `PagoRepository.list_by_proveedor` (C-06, used by C-08 FIFO pool) — returns active pagos for a proveedor.
  - `_compute_estado_fifo(facturas, pool)` (C-08) — pure function; imported by the new service method.
  - `ProveedorRepository.get_saldo_por_proveedor` (C-06) — single aggregate query (no N+1).
  - `_get_owned` ownership helper (C-06) — used for the supplier authorization check.
  - `get_current_user` and `get_db` dependencies (C-03) — wired in the router.
- **Dependencies**: C-06 (proveedores-backend) for the supplier ownership check and saldo aggregate; C-08 (facturas-backend) for the FIFO algorithm; C-10 (pagos-backend) for the active pago list. **No new Python packages** and **no Alembic migration**.
- **Governance**: ALTO — multi-tenant scoping on every read, service-layer authorization, no derived data persisted, deterministic FIFO ordering, isolation between users. The hard rules below are non-negotiable.

## Out of scope

- **Frontend cuenta-corriente view (C-13)** — depends on this change; will consume the new endpoint.
- **IA extraction (C-14 / C-15)** — separate changes; nothing in this change touches `VisionExtractor` or `origen=IA`.
- **Pagination of the cuenta-corriente payload** — MVP volumes per supplier are small (single user's cuenta-corriente per supplier). If a supplier ever has >500 facturas, the next change can add `?limit=&offset=` to this endpoint; out of scope here.
- **Filtering the cuenta-corriente by date range / estado** — the endpoint returns the full state for the proveedor. The frontend (C-13) will client-side filter if it needs to. Adding server-side filters would couple the endpoint to a "view" the user has not asked for.
- **Cancellations, reversals, or any per-factura linking** — explicitly out of MVP per `05_reglas_de_negocio.md` (RN-PAG-05). The cuenta-corriente is a **view**, not a mutating endpoint.
- **Cache of the computed triple** — explicitly forbidden (RN-SALDO / RN-FIFO: "nunca se persiste"). If a performance issue surfaces in the future, the resolution is a request-scoped memoization inside the service call, not a database cache.
- **Changes to the `factura` table, the `pago` table, the `proveedor` table, the `FacturaService`, the `PagoService`, or any existing spec.** This change is additive: one new method, one new route, three new schemas, one new test module set.

## Dependencies satisfied

- **C-06 (proveedores-backend, archived)** — `ProveedorService._get_owned` and `ProveedorRepository.get_saldo_por_proveedor` are the two pieces the new method reuses.
- **C-08 (facturas-backend, archived)** — `FacturaService._compute_estado_fifo` is the exact algorithm the new method imports. The C-08 contract that `FacturaRepository.list_by_proveedor` returns rows in FIFO order is preserved.
- **C-10 (pagos-backend, archived)** — `PagoRepository.list_by_proveedor(include_deleted=False)` is the single source of active pagos for the FIFO pool and the historial. RN-PAG-01 (no `factura_id` on `Pago`) means the cuenta-corriente view can build its list without a join to `factura`.

## Patterns mirrored (archive references)

- **C-08 service** (`openspec/changes/archive/2026-06-21-c-08-facturas-backend/`) — FIFO algorithm, ownership check via `_get_owned_X`, the `_TZ_AR` UTC-3 helper pattern, the `FacturaConEstado` data class.
- **C-10 service** (`openspec/changes/archive/2026-06-27-c-10-pagos-backend/`) — `_get_owned_X` raises 404 (not 403), the `Annotated` style + `CurrentUser` / `DbSession` aliases, the `model_config = ConfigDict(extra="forbid")` discipline (for input schemas — not needed here since the cuenta-corriente endpoint has no payload, but the precedent stands).
- **C-06 router** (`openspec/changes/archive/2026-06-21-c-06-proveedores-backend/`) — `/buscar` declared before `/{id}` to avoid path shadowing; the new sub-route `/{proveedor_id}/cuenta-corriente` is placed after `/buscar` and before `/{proveedor_id}` for the same reason.

## Hard rules (non-negotiable)

1. **NEVER** persist `saldo` or `estado` — always compute on-demand (RN-SALDO, RN-FIFO, RN-HIST). No column is added to `proveedor` or `factura`. If a future change suggests caching the result or persisting a `saldo` snapshot, reject it. Tests assert the absence of these columns on the relevant tables.
2. **NEVER** allow a user to read the cuenta-corriente of a supplier owned by another user — service-layer ownership check via `_get_owned`; foreign / soft-deleted supplier returns **404**, never 403.
3. **FIFO is reused, never duplicated.** The new method imports `_compute_estado_fifo` from `app.services.factura_service` and calls it on the supplier's active facturas with the supplier's active pago pool. Any future change to the algorithm happens in one place.
4. **FIFO ordering is deterministic:** `fecha_emision ASC, created_at ASC, id ASC` for facturas; `fecha ASC, created_at ASC, id ASC` for the historial merge. The repository methods already return rows in that order (C-08 / C-10). Tests assert the ordering under identical timestamps.
5. **Authorization and computation live in the service layer.** The router calls `svc.get_cuenta_corriente(current_user.id, proveedor_id)` and maps the result to the response schema. The router has no business logic.
6. **No `factura_id` anywhere** (RN-PAG-01) — the cuenta-corriente is the **view** that proves this rule end-to-end: payments are aggregated into a pool, never attached to a factura. The implementation must not introduce a join from `pago` to `factura`.
7. **Tests use real Postgres** (testcontainers, per `tests/conftest.py`). No SQLite. External services (Cloudinary, vision model) are out of scope for this change.
8. **HTTP semantics:** `GET` → 200 with full `CuentaCorrienteResponse`; auth failure → 401; foreign/missing/soft-deleted supplier → 404; never 403. The endpoint has no body and no mutation, so 422 is not a possible response.
9. **`saldo` convention** (from `05_reglas_de_negocio.md`): `saldo > 0` → deuda; `saldo == 0` → al día; `saldo < 0` → saldo a favor (crédito). The endpoint returns the raw signed `Decimal`; the frontend (C-13) interprets the sign. Tests assert the sign for several input combinations.

</content>
