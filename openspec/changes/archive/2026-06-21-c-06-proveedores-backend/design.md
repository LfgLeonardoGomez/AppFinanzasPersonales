## Context

C-02 (`core-data-models`, archived) already shipped:
- `app/models/proveedor.py` — the `Proveedor` SQLModel (`SoftDeleteMixin + TimestampUUIDMixin`), with `nombre` (max 120, not unique), `cuit`, `telefono`, `categoria` (`CategoriaProveedor`, default `OTRO`), `notas`, `deleted_at`.
- `app/repositories/base_repository.py` — generic `get / list / create / update / soft_delete`. `list` already filters `deleted_at IS NULL` and accepts equality filters; `soft_delete` sets `deleted_at = now()` and preserves the row.
- `app/repositories/proveedor_repository.py` — already exposes `get_saldo_por_proveedor(usuario_id) -> dict[uuid, Decimal]`, a single-query LEFT-JOIN-of-subqueries aggregate (RN-SALDO) returning `0.00` for suppliers with no movements.
- `alembic/versions/20240001_..._0001` — creates `usuario`, `proveedor`, `factura`, `factura_item`, `pago` plus indexes including `ix_proveedor_usuario_deleted (usuario_id, deleted_at)`. `factura` and `pago` tables therefore **already exist**.
- `alembic/versions/20240002_..._0002` — refresh_token; current head is `0002`.
- C-03 (archived) shipped `app/core/deps.py::get_current_user` returning the authenticated `Usuario`, and the router pattern in `app/routers/auth.py` (router owns the transaction `commit`; service raises HTTPExceptions; service holds all business logic).

Constraints (project hard rules): `saldo`/`estado` never persisted; authorization + saldo computation in the **service** layer only; everything filtered by `usuario_id` with foreign resources returning **404 not 403**; Pydantic validates everything; amounts `numeric(12,2)` ARS, `Decimal` never float; tests on **real Postgres** (testcontainers), external services mocked. Governance for this change is **MEDIO**.

## Goals / Non-Goals

**Goals:**
- A complete, ownership-isolated supplier CRUD HTTP API with on-demand `saldo`.
- Paginated listing orderable by `nombre` or by the computed `saldo`, with balances resolved in a **single aggregate query** (no N+1).
- Name search endpoint for RN-VINC linkage (normalized, returns all matches).
- CUIT validation in the backend.
- A sequential `0003` migration adding a normalized-name index.
- Reuse the existing `get_saldo_por_proveedor` aggregate; do not duplicate balance logic.

**Non-Goals:**
- FIFO invoice state (RN-FIFO) and the full cuenta-corriente view (C-12). This change only computes the scalar `saldo`, not per-invoice state.
- Any invoice/payment endpoints (C-08/C-10). We only read `factura`/`pago` rows through the aggregate.
- Frontend (C-07).
- Hard delete, multi-currency, IVA.

## Decisions

### D1 — Reuse the existing aggregate; add a single combined listing query

`get_saldo_por_proveedor` already computes balances correctly in one query but returns only `{proveedor_id: saldo}` for **all** active suppliers (no pagination, no supplier fields). For the listing we need supplier rows + balance + pagination + ordering.

**Decision:** add `list_by_usuario(usuario_id, page, order_by, page_size=20)` to `ProveedorRepository`. It builds **one** statement that selects the `Proveedor` columns plus the saldo expression, using the same two pre-aggregated subqueries (`factura_sums`, `pago_sums`) `LEFT JOIN`-ed to `proveedor`, filtered by `usuario_id` and `deleted_at IS NULL`, with `ORDER BY` + `LIMIT/OFFSET` applied in SQL. The scalar `get_saldo_por_proveedor` is kept and reused by the service for single-supplier reads (`GET /{id}`, after create/update) so balance logic exists in exactly one shape.

*Alternative considered:* fetch the page of suppliers, then call `get_saldo_por_proveedor` and zip in Python. Rejected for `order_by=saldo` — you cannot paginate by a value you compute after fetching the page; correct saldo-ordering requires the aggregate inside the ordered/limited query.

### D2 — saldo aggregation SQL shape (no N+1)

Pattern (mirrors the existing `get_saldo_por_proveedor`):

```
factura_sums = SELECT proveedor_id, COALESCE(SUM(monto_total),0) AS total_facturas
               FROM factura WHERE usuario_id=:u AND deleted_at IS NULL
               GROUP BY proveedor_id            -- subquery
pago_sums    = SELECT proveedor_id, COALESCE(SUM(monto),0) AS total_pagos
               FROM pago    WHERE usuario_id=:u AND deleted_at IS NULL
               GROUP BY proveedor_id            -- subquery

SELECT proveedor.*,
       (COALESCE(factura_sums.total_facturas,0) - COALESCE(pago_sums.total_pagos,0)) AS saldo
FROM proveedor
LEFT JOIN factura_sums ON proveedor.id = factura_sums.proveedor_id
LEFT JOIN pago_sums    ON proveedor.id = pago_sums.proveedor_id
WHERE proveedor.usuario_id=:u AND proveedor.deleted_at IS NULL
ORDER BY <name|saldo> LIMIT :page_size OFFSET :offset
```

Pre-aggregating in subqueries (rather than `JOIN factura/pago` then `GROUP BY proveedor`) avoids the fan-out double-count that happens when a supplier has both invoices and payments. This is the single-query guarantee the spec requires.

### D3 — Ordering by the computed saldo

`saldo` is a derived expression, not a column, so naive `ORDER BY saldo` referencing a model attribute is impossible and `WHERE saldo > x` is invalid. **Decision:** order by the **expression alias** built in the same SELECT. In SQLAlchemy, bind the computed expression to a labeled column (`.label("saldo")`) and pass that labeled element to `.order_by()` — Postgres accepts ordering by a select-list alias. Default direction for `order_by=saldo` is **descending** (largest debt first, the useful product default per Flujo 6). `order_by=nombre` orders by `func.lower(Proveedor.nombre)` ascending (see D4). `order_by` is constrained to the literal set `{nombre, saldo}` by a Pydantic `Literal`/enum at the router so no raw string reaches SQL (no injection, predictable plan).

### D4 — Search normalization and the index

RN-VINC normalizes to lowercase + trim (accents handled at the application layer for the MVP). **Decision:** the repository search filters with `func.lower(Proveedor.nombre).like(f"%{normalized}%")` (or `ilike`), scoped to `usuario_id` and `deleted_at IS NULL`. To keep this index-friendly, migration `0003` creates an **expression index on `(usuario_id, lower(nombre))`**:

```
op.create_index("ix_proveedor_usuario_nombre_lower", "proveedor",
                ["usuario_id", sa.text("lower(nombre)")])
```

An expression index on `lower(nombre)` is chosen over a column collation (`COLLATE "C"`/ICU) because it is portable, requires no DB-level collation setup in the testcontainers image, and directly serves both case-insensitive search and `order_by=nombre`. A leading-`%` `LIKE` cannot use a b-tree prefix, but for the small per-user supplier counts of an MVP this is acceptable; the composite `(usuario_id, lower(nombre))` still narrows by tenant and supports the equality/anchored-prefix and ordering cases. Accent-insensitivity beyond `lower()` (e.g. `unaccent`) is deferred — noted as an open question rather than pulling in a Postgres extension now.

### D5 — Ownership isolation → 404, in the service layer

The service fetches by id via the repo `get`, then checks `entity.usuario_id == current_user.id` **and** `deleted_at is None`; on mismatch or missing it raises `HTTPException(404)`. Never 403 — a 403 would confirm the resource exists for another tenant (enumeration leak). This mirrors the `saas-multi-tenant` rule ("foreign resource is indistinguishable from non-existent") and the project hard rule #3. The router never performs this check; it only wires `Depends(get_current_user)`, calls the service, and commits.

### D6 — Delete returns `tiene_dependencias`, never blocks

`eliminar()` soft-deletes (reusing `BaseRepository.soft_delete`) and, before/after, queries whether the supplier has **active** invoices or payments (`EXISTS` on `factura`/`pago` where `proveedor_id = id AND deleted_at IS NULL`). It returns a small result object `{proveedor, tiene_dependencias: bool}`. The router maps this into the response; the UI uses it to honor RN-PROV-04 (confirm modal) but the backend never refuses the delete. Dependencies are computed against the state *before* the soft-delete of the supplier (the supplier's own `deleted_at` does not cascade to its invoices/payments — they remain active rows).

### D7 — Schemas and the saldo field

`app/schemas/proveedor.py`:
- `ProveedorCreate`: `nombre` (required, non-empty), `cuit` (optional, regex-validated via `field_validator`), `telefono`, `categoria` (default `OTRO`), `notas`. No `usuario_id`.
- `ProveedorUpdate`: all of the above optional (PATCH semantics); same CUIT validator; no `usuario_id`.
- `ProveedorResponse`: full supplier + `saldo: Decimal` + `created_at`/`updated_at`; `model_config = {"from_attributes": True}`.
- `ProveedorListItem`: the row shape for listing (id, nombre, cuit, categoria, saldo, …) — kept distinct so the list payload can stay lean.
- `ProveedorDeleteResponse`: `{ id, tiene_dependencias: bool }`.

CUIT regex `^\d{2}-\d{8}-\d{1}$` lives in the schema validators (primary enforcement) and is re-checked in the service to satisfy "validate in service/schema" without trusting the frontend.

### D8 — Pagination shape

1-based `page` (Pydantic `Query(ge=1, default=1)`), fixed `page_size` (e.g. 20) translated to `OFFSET (page-1)*page_size`. A total count can be returned later; for the MVP the listing returns the page items (and optionally a `has_next` flag derived by fetching `page_size+1`). Keep it minimal; the frontend (C-07) only needs ordered pages.

## Risks / Trade-offs

- **[Leading-`%` search cannot use a prefix index]** → For MVP supplier counts (tens per user) a tenant-scoped scan is cheap; the `(usuario_id, lower(nombre))` index still bounds work per tenant. Trigram/`unaccent` is a future optimization behind the same method signature.
- **[`order_by=saldo` correctness with mixed data]** → The pre-aggregated-subquery + `LEFT JOIN` shape (D2) prevents the invoice×payment fan-out double-count; explicitly tested with a supplier that has both invoices and payments, one with only invoices, one with only payments, one with neither (saldo `0.00`).
- **[Accent-insensitivity gap]** → `lower()` does not strip accents; "José" vs "jose" won't match. Acceptable for MVP per RN-VINC's lowercase+trim baseline; flagged as Open Question.
- **[Cross-tenant leak]** → Mitigated by the service-layer `usuario_id` filter on every path and 404-on-foreign. No RLS at the DB layer in the MVP (single shared connection, app-layer enforcement) — consistent with the rest of the codebase; tests assert isolation with ≥2 users.
- **[Migration drift]** → `0003` must chain `down_revision = "0002"`; a wrong parent breaks `upgrade head`. The migration test (existing `test_alembic_migration.py` pattern) asserts upgrade→downgrade round-trips and that head is `0003`.
- **[Decimal vs float]** → Balances come back from Postgres as `Decimal`; schemas type `saldo` as `Decimal` so no float coercion happens. `numeric(12,2)` preserved end to end.

## Migration Plan

1. Add `app/schemas/proveedor.py`, then `app/services/proveedor_service.py`, then `app/routers/proveedores.py`; register the router in `app/main.py`.
2. Extend `ProveedorRepository` with `list_by_usuario` and thin `create/update/soft_delete` wrappers (reusing `BaseRepository`); keep `get_saldo_por_proveedor`.
3. Author migration `0003` (`down_revision="0002"`) creating `ix_proveedor_usuario_nombre_lower`; `downgrade` drops it.
4. Run `alembic upgrade head` against the testcontainers Postgres in the test setup; tests verify the index and round-trip.
5. **Rollback:** `alembic downgrade 0002` drops only the new index; no table or column is altered, so rollback is safe and data-preserving. Reverting the API is a code revert plus router de-registration.

## Open Questions

- **Accent-insensitive search:** do we add Postgres `unaccent` (extension) for RN-VINC, or keep lowercase+trim only for the MVP? (Leaning: defer; lowercase+trim now.)
- **Pagination metadata:** does C-07 need a `total`/`page_count`, or is `has_next` enough? (Leaning: `has_next` via `page_size+1` fetch to avoid a second count query.)
- **Default `saldo` ordering direction:** descending (largest debt first) is assumed the product default for Flujo 6 — confirm with the frontend slice if the toggle should expose both directions.
