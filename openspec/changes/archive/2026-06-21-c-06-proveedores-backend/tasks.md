# Tasks — C-06 proveedores-backend

> TDD is active: for each behavior write the failing test first (RED), implement the minimum (GREEN), triangulate with a second case, then refactor. All DB tests run on real Postgres via testcontainers (conftest `pg_container`/`client`). External services are not involved in this change.

## 1. Schemas (Pydantic) — `app/schemas/proveedor.py`

- [x] 1.1 RED: write `tests/test_proveedor_schemas.py` asserting valid CUIT `"20-12345678-9"` passes and malformed `"20123456789"` raises a validation error on both `ProveedorCreate` and `ProveedorUpdate`; missing CUIT is accepted.
- [x] 1.2 GREEN: create `ProveedorCreate` (`nombre` required/non-empty, `cuit` optional with `field_validator` regex `^\d{2}-\d{8}-\d{1}$`, `telefono`, `categoria: CategoriaProveedor = OTRO`, `notas`); no `usuario_id` field.
- [x] 1.3 Add `ProveedorUpdate` (all fields optional for PATCH, same CUIT validator, no `usuario_id`).
- [x] 1.4 Add `ProveedorResponse` (`id`, `nombre`, `cuit`, `telefono`, `categoria`, `notas`, `saldo: Decimal`, `created_at`, `updated_at`; `model_config = {"from_attributes": True}`), `ProveedorListItem` (lean list row incl. `saldo: Decimal`), and `ProveedorDeleteResponse` (`id`, `tiene_dependencias: bool`).
- [x] 1.5 Triangulate CUIT edge cases (extra digits, wrong separators, empty string vs None) and confirm `saldo` typed as `Decimal` (never float).

## 2. Repository — extend `app/repositories/proveedor_repository.py`

- [x] 2.1 RED: write `tests/test_proveedor_repository.py` seeding 2 users with a mix of suppliers/invoices/payments; assert `list_by_usuario` returns only the caller's active suppliers, each with correct `saldo = SUM(facturas activas) − SUM(pagos activos)`, computed in a SINGLE aggregate query (one supplier with both invoices+payments must NOT double-count).
- [x] 2.2 GREEN: implement `list_by_usuario(usuario_id, page, order_by, page_size=20)` building one statement: pre-aggregated `factura_sums`/`pago_sums` subqueries `LEFT JOIN`-ed to `proveedor`, filtered by `usuario_id` + `deleted_at IS NULL`, saldo as a labeled expression, with `LIMIT/OFFSET` (reuse the pattern in existing `get_saldo_por_proveedor`).
- [x] 2.3 Add ordering: `order_by="nombre"` → `func.lower(Proveedor.nombre)` ASC; `order_by="saldo"` → order by the saldo expression alias DESC. Triangulate with a dataset where name-order and saldo-order differ.
- [x] 2.4 Add thin `create(usuario_id, data)`, `update(entity, data)`, `soft_delete(id)` wrappers over `BaseRepository` (or reuse base directly from the service); add `search_by_nombre(usuario_id, normalized)` using `func.lower(nombre) like %q%` scoped to user + active.
- [x] 2.5 Add `tiene_dependencias(proveedor_id)` helper: `EXISTS` active `factura` OR active `pago` for that `proveedor_id`. Test true/false branches.
- [x] 2.6 REFACTOR: ensure no business logic leaked into the repo (pure data access); keep saldo math in one shape.

## 3. Service — `app/services/proveedor_service.py`

- [x] 3.1 RED: write `tests/test_proveedor_service.py` (real Postgres) covering: `listar` returns active suppliers with saldo and excludes soft-deleted; `crear` sets `usuario_id` from the session and ignores any payload-supplied id; `actualizar`/`get` on a FOREIGN supplier raises 404 (never 403); `eliminar` soft-deletes, preserves the row+FKs, and returns `tiene_dependencias`.
- [x] 3.2 GREEN: implement `ProveedorService(session)` with `listar(usuario_id, page, order_by)`, `crear(usuario_id, datos)`, `get(usuario_id, proveedor_id)`, `actualizar(usuario_id, proveedor_id, datos)`, `eliminar(usuario_id, proveedor_id)`, `buscar_por_nombre(usuario_id, nombre)` — normalizing the search term (lowercase, trim).
- [x] 3.3 Implement ownership check as a private helper: fetch by id, raise `HTTPException(404)` if missing, soft-deleted, or `usuario_id != current`. Use it in get/actualizar/eliminar.
- [x] 3.4 Compute on-demand saldo for single-supplier responses via the existing `get_saldo_por_proveedor` (or a per-id variant); re-validate CUIT format in the service. Triangulate isolation with ≥2 users and a soft-deleted-supplier read → 404.
- [x] 3.5 REFACTOR: confirm all authorization + saldo logic lives in the service (not router, not repo); raise HTTPExceptions (router stays thin).

## 4. Router — `app/routers/proveedores.py`

- [x] 4.1 RED: write `tests/test_proveedor_integration.py` (FastAPI `client`, authenticated via login cookie) for: unauthenticated request → 401; `POST` → 201 with `saldo=0.00`; `GET /` paginated and `order_by=nombre|saldo`; invalid `order_by` → 422; `GET/PATCH/DELETE /{id}` happy path; foreign id → 404; `GET /buscar?nombre=` returns normalized matches for the caller only.
- [x] 4.2 GREEN: implement `APIRouter(prefix="/api/proveedores", tags=["proveedores"])` with `Depends(get_current_user)`; endpoints `GET /` (`page: Query(ge=1)=1`, `order_by: Literal["nombre","saldo"]="nombre"`), `POST /`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`, `GET /buscar`. Router calls the service, commits the session (mirror `auth.py`), returns response models.
- [x] 4.3 Use `Annotated` for params/deps; one HTTP operation per function; declare response models (`ProveedorResponse`, `list[ProveedorListItem]`, `ProveedorDeleteResponse`). Place `/buscar` route so it is not shadowed by `/{id}`.
- [x] 4.4 Register the router in `app/main.py` (`app.include_router(...)`). Triangulate: confirm `/api/proveedores/buscar` resolves to search, not to `{id}`.

## 5. Migration `0003` — normalized name index

- [x] 5.1 RED: extend the alembic migration test (pattern from `tests/test_alembic_migration.py`) to assert: after `upgrade head` the head is `0003` and an index over `(usuario_id, lower(nombre))` exists on `proveedor`; `downgrade` drops it and returns to `0002`; no `saldo`/`estado` column appears.
- [x] 5.2 GREEN: create `alembic/versions/20240003_0003_proveedor_nombre_index.py` with `revision="0003"`, `down_revision="0002"`; `upgrade` creates `ix_proveedor_usuario_nombre_lower` on `["usuario_id", sa.text("lower(nombre)")]`; `downgrade` drops it.
- [x] 5.3 Verify `alembic upgrade head` chains 0001→0002→0003 cleanly on the testcontainers DB.

## 6. Verification

- [x] 6.1 Run the full backend suite on real Postgres (`pytest`); ensure no pre-existing test regressed and all new tests pass.
- [x] 6.2 Confirm invariants hold: no persisted `saldo`/`estado`; saldo via single GROUP BY (no N+1); foreign resource → 404 not 403; CUIT validated in backend; amounts `Decimal`/`numeric(12,2)`.
- [x] 6.3 Mark every task `[x]` and record any deviation; update `CHANGES.md` C-06 checkbox only at archive time.
