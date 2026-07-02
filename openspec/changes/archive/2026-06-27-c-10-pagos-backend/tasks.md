# Tasks: c-10-pagos-backend

## Task 1 — Schemas (`app/schemas/pago.py`)

- [x] 1.1 Write `test_pago_schemas.py` (RED): test `PagoCreate` validation
  - `monto <= 0` rejected by Pydantic (422)
  - `metodo` not in enum rejected by Pydantic
  - `comprobante_url` optional, default `None`
  - payload with `factura_id` rejected by `extra="forbid"` (422)
  - payload with any other unknown field rejected (422)
  - `PagoUpdate` with no fields is valid (PATCH semantics)
  - `PagoUpdate` with `proveedor_id` rejected (forbid)
  - `PagoUpdate` with `monto <= 0` rejected
  - `PagoUpdate` with `factura_id` rejected (forbid)
- [x] 1.2 Create `app/schemas/pago.py` (GREEN):
  - `PagoCreate` with `model_config = ConfigDict(extra="forbid")`; fields: `proveedor_id: UUID`, `monto: Decimal = Field(gt=0)`, `fecha: date`, `metodo: MetodoPago`, `comprobante_url: str | None = None`
  - `PagoUpdate` with `model_config = ConfigDict(extra="forbid")`; all fields optional
  - `PagoResponse` with full pago fields (no `factura_id`)
  - `PagoListItem` with lean row (id, proveedor_id, monto, fecha, metodo, origen, created_at)
- [x] 1.3 Triangulate: test that response schemas serialize Decimal as string (Pydantic v2 default) and UUID as string; test that `origen` is always `MANUAL` in `PagoResponse` after `crear`

## Task 2 — Repository (`app/repositories/pago_repository.py`)

- [x] 2.1 Write `test_pago_repository.py` (RED): test the expanded `PagoRepository`
  - `list_by_usuario(usuario_id, page)` returns paginated active pagos, ordered by `fecha DESC, created_at DESC, id DESC`
  - `list_by_usuario(usuario_id, page, proveedor_id=...)` filters by proveedor
  - `get(id)` returns the row regardless of `deleted_at` (caller decides)
  - `create(...)` persists with all fields including `origen=MANUAL` and returns the entity
  - `update(entity, ...)` updates only provided fields
  - `soft_delete(id)` sets `deleted_at` and preserves the row
  - `list_by_proveedor(usuario_id, proveedor_id, include_deleted=False)` (already exists from C-06) still excludes soft-deleted pagos — this is the contract the C-08 FIFO pool depends on
- [x] 2.2 Expand `PagoRepository` (GREEN): add `list_by_usuario(usuario_id, proveedor_id=None, page=1, page_size=50) -> tuple[list[Pago], int]`, ensure existing `list_by_proveedor` filters `deleted_at IS NULL` by default
- [x] 2.3 Triangulate: test that soft-deleted pagos are NOT returned by `list_by_proveedor` (C-08 FIFO pool contract); test that soft-deleted pagos ARE excluded by `list_by_usuario`; test user isolation (user B's pagos never appear in user A's listing)

## Task 3 — Service (`app/services/pago_service.py`)

- [x] 3.1 Write `test_pago_service.py` (RED): test `PagoService` end-to-end against real Postgres
  - `crear(usuario_id, datos)`:
    - valid payload → persisted with `usuario_id` from arg, `origen=MANUAL`
    - `proveedor_id` owned by other user → 404
    - `proveedor_id` soft-deleted → 404
    - `fecha` in future → 422
    - `monto <= 0` → 422 (defense in depth, Pydantic also catches it)
    - `metodo` not in enum → 422
  - `listar(usuario_id, proveedor_id=None, page=1)`:
    - returns only caller's active pagos
    - filters by `proveedor_id` when provided
    - excludes soft-deleted
    - paginated correctly
  - `get(usuario_id, pago_id)`:
    - own pago → returned
    - foreign pago → 404
    - soft-deleted pago → 404
  - `actualizar(usuario_id, pago_id, datos)`:
    - PATCH subset of fields
    - foreign pago → 404
    - `monto <= 0` → 422
    - future `fecha` → 422
  - `eliminar(usuario_id, pago_id)`:
    - own pago → soft-deleted, returns nothing
    - foreign pago → 404
    - already-deleted pago → 404
    - end-to-end: a pago that is soft-deleted is no longer visible to `FacturaService`'s FIFO pool
- [x] 3.2 Implement `PagoService` (GREEN):
  - `_get_owned_pago(usuario_id, pago_id) -> Pago` raises 404 on missing/foreign/soft-deleted
  - `_validate_proveedor_ownership(usuario_id, proveedor_id) -> Proveedor` raises 404 on missing/foreign/soft-deleted
  - `_validate_fecha_not_future(fecha) -> None` raises 422 if `fecha > today(UTC-3)` via `zoneinfo.ZoneInfo("America/Argentina/Buenos_Aires")`
  - `_validate_monto_positive(monto) -> None` raises 422 if `monto <= 0`
  - `crear(usuario_id, datos)` runs the validators in order, stamps `origen=MANUAL`, calls `PagoRepository.create`
  - `listar(usuario_id, proveedor_id=None, page=1)` delegates to repository, returns `(items, total)`
  - `get(usuario_id, pago_id)` uses `_get_owned_pago`
  - `actualizar(usuario_id, pago_id, datos)` uses `_get_owned_pago`, applies only non-None fields, re-validates `monto` and `fecha` if provided
  - `eliminar(usuario_id, pago_id)` uses `_get_owned_pago`, calls `PagoRepository.soft_delete`
- [x] 3.3 Triangulate (MANDATORY):
  - Service-level test: create pago + factura for same proveedor; soft-delete the pago; assert `FacturaService.listar` (the C-08 consumer) no longer applies the pago to the FIFO pool — invoice estado correctly recomputes
  - Service-level test: create pago, foreign user GETs → 404
  - Service-level test: create pago, attempt to PATCH with `proveedor_id` → service-layer ignore (Pydantic rejects at schema first, but verify service is defensive)
  - Service-level test: edit a pago's `monto`; assert the next `FacturaService.listar` reflects the new monto in the pool

## Task 4 — Migration (`alembic/versions/<ts>_pago_indices.py`)

- [x] 4.1 Write `test_alembic_migration_pago_indices.py` (RED): assert the index `ix_pago_usuario_proveedor_deleted_fecha` exists after upgrade, removed after downgrade
- [x] 4.2 Create the migration file (GREEN): adds the composite index on `pago(usuario_id, proveedor_id, deleted_at, fecha)`; `downgrade` drops the index. No table changes, no column changes.
- [x] 4.3 Triangulate: run upgrade + downgrade + upgrade again (idempotency check); verify no `estado` / `saldo` / `factura_id` column appears on `pago`

## Task 5 — Router (`app/routers/pagos.py`) + wire into `app/main.py`

- [x] 5.1 Write `test_pago_integration.py` (RED): HTTP integration tests against real Postgres via FastAPI TestClient
  - Unauthenticated → 401
  - `POST /api/pagos` → 201 with full `PagoResponse` body
  - `POST /api/pagos` with `factura_id` in payload → 422
  - `POST /api/pagos` with future `fecha` → 422
  - `POST /api/pagos` with `monto <= 0` → 422
  - `POST /api/pagos` with foreign `proveedor_id` → 404
  - `GET /api/pagos` → list with `total` field
  - `GET /api/pagos?proveedor_id=<own>` → filtered list
  - `GET /api/pagos?proveedor_id=<foreign>` → 404
  - `GET /api/pagos/{id}` (own) → 200
  - `GET /api/pagos/{id}` (foreign) → 404
  - `PATCH /api/pagos/{id}` → 200, fields updated
  - `PATCH /api/pagos/{id}` with `factura_id` → 422
  - `PATCH /api/pagos/{id}` (foreign) → 404
  - `DELETE /api/pagos/{id}` → 204
  - `DELETE /api/pagos/{id}` (foreign) → 404
  - `DELETE /api/pagos/{id}` (already soft-deleted) → 404
- [x] 5.2 Rewrite `app/routers/pagos.py` (GREEN):
  - Remove the inline `PagoCreate` / `PagoResponse` BaseModels from the C-08 stub
  - Import from `app.schemas.pago` and `app.services.pago_service`
  - Add endpoints:
    - `GET /api/pagos?proveedor_id&page` → `list[ PagoListItem]` + `total`
    - `POST /api/pagos` → 201, `PagoResponse`
    - `GET /api/pagos/{id}` → 200, `PagoResponse`
    - `PATCH /api/pagos/{id}` → 200, `PagoResponse`
    - `DELETE /api/pagos/{id}` → 204
  - Use the `Annotated` style with `CurrentUser` / `DbSession` aliases (mirrors `facturas.py` / `proveedores.py`)
  - Router stays thin: dependency → service call → commit (for mutations) → schema mapping
- [x] 5.3 Verify router is registered in `app/main.py` (C-08 already mounts it; confirm path and tag)
- [x] 5.4 Triangulate: end-to-end test that the integration with the existing C-08 `FacturaService` still works (create factura + pago for the same proveedor; assert `GET /api/facturas` returns the factura with the correct `estado`)

## Task 6 — Cloudinary preset endpoint extension (`GET /api/cloudinary/preset-firmado?tipo=comprobante`)

- [x] 6.1 Write `test_cloudinary_preset_comprobante.py` (RED): test the new branch
  - `GET /api/cloudinary/preset-firmado?tipo=comprobante` → 200 with the same response shape as `tipo=factura` and `tipo=avatar`
  - `GET /api/cloudinary/preset-firmado?tipo=desconocido` → 422
  - Authenticated request (the endpoint requires session); unauthenticated → 401
- [x] 6.2 Extend the existing endpoint in `app/routers/cloudinary.py` (or wherever C-08 put it) to accept `tipo=comprobante` (GREEN). Cloudinary call is **already** mocked — only the dispatch branch is new.
- [x] 6.3 Triangulate: verify the existing `tipo=factura` and `tipo=avatar` paths still work after the change

## Review Workload Forecast

- **Estimated changed lines**: ~700 (schemas, repository, service, router, migration, tests)
- **Chained PRs recommended**: No — single coherent backend feature slice, mirrors C-08's shape
- **400-line budget risk**: Medium-High — recommend splitting into two PRs:
  - **PR-A**: Task 1 (schemas) + Task 4 (migration) + Task 6 (Cloudinary branch) — small, additive
  - **PR-B**: Task 2 (repository) + Task 3 (service) + Task 5 (router + integration) — the CRUD core
- **Breaking surface**: the inline `PagoCreate` / `PagoResponse` in `routers/pagos.py` are removed; the C-08 stub's `POST /api/pagos` response shape is preserved (same fields, same order), so the C-08 integration test still passes after the rewrite
- **C-12 (cuenta-corriente-backend) unblocked**: this change exposes the full `Pago` CRUD and a stable service interface; C-12 can extend `ProveedorService.get_cuenta_corriente` to consume the same `PagoRepository.list_by_proveedor` already used by the C-08 FIFO pool
