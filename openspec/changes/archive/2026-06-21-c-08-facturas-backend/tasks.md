# Tasks: c-08-facturas-backend

## Task 1 — Schemas (`app/schemas/factura.py`)

- [x] 1.1 Add `EstadoFactura` enum (PENDIENTE/PARCIAL/PAGADA) to `app/models/enums.py`
- [x] 1.2 Write `test_factura_schemas.py` (RED): test `FacturaCreate` validation
  (monto_total <= 0 rejected, fecha_emision future rejected via Pydantic, items optional)
- [x] 1.3 Create `app/schemas/factura.py` with all schemas (GREEN):
  `FacturaItemCreate`, `FacturaCreate`, `FacturaItemResponse`, `FacturaResponse`,
  `FacturaListItem`, `FacturaUpdate`
- [x] 1.4 Triangulate: test update (all-optional), test items sum mismatch field in response

## Task 2 — Repository (`app/repositories/factura_repository.py`)

- [x] 2.1 Write `test_factura_repository.py` (RED): test `list_by_usuario`, `get_with_items`,
  `create_with_items`, `update_with_items`, `soft_delete` cascade
- [x] 2.2 Implement expanded `FacturaRepository` (GREEN): replace stub with full methods
- [x] 2.3 Triangulate: test that soft_delete does NOT hard-delete items (items remain);
  test FIFO ordering (`fecha_emision ASC, created_at ASC, id ASC`);
  test user isolation (user B cannot see user A's facturas)

## Task 3 — FIFO algorithm (pure function in `app/services/factura_service.py`)

- [x] 3.1 Write `test_fifo_algorithm.py` (RED): pure-function tests for `_compute_estado_fifo`
  - Case: pool=0 → all PENDIENTE
  - Case: pool >= sum(facturas) → all PAGADA + leftover saldo a favor
- [x] 3.2 Implement `_compute_estado_fifo(facturas, pool)` in service module (GREEN)
- [x] 3.3 Triangulate (MANDATORY):
  - Case: pool covers first invoice fully + partially covers second → [PAGADA, PARCIAL, PENDIENTE]
  - Case: deterministic tiebreak by created_at when fecha_emision equal
  - Case: pool covers exactly monto_total of one invoice → PAGADA (not PARCIAL)
  - Case: single factura partial payment → PARCIAL

## Task 4 — FacturaService (`app/services/factura_service.py`)

- [x] 4.1 Write `test_factura_service.py` (RED): test `crear`, `listar`, `get`, `actualizar`, `eliminar`
  - `crear`: valid → saved with usuario_id from arg, origen=MANUAL
  - `crear`: proveedor belongs to other user → 404
  - `crear`: fecha_emision in future → 422
  - `crear`: monto_total = 0 → 422
- [x] 4.2 Implement `FacturaService` (GREEN): `crear`, `get`, `listar`, `actualizar`, `eliminar`
- [x] 4.3 Triangulate:
  - `listar` with `proveedor_id=None` → returns all user's facturas with FIFO estado
  - `listar` with `estado_filtro=PAGADA` → filtered in Python after FIFO (not SQL)
  - `listar` with `fecha_desde`/`fecha_hasta` → date range filter in Python
  - Foreign factura in `get` → 404
  - Soft-deleted factura in `get` → 404
  - Cross-user isolation: user B cannot get/update/delete user A's factura

## Task 5 — Migration (`alembic/versions/20240004_0004_factura_indices.py`)

- [x] 5.1 Write `test_alembic_migration_0004.py` (RED): assert index exists after upgrade,
  removed after downgrade
- [x] 5.2 Create migration file adding composite index (GREEN)
- [x] 5.3 Triangulate: run upgrade + downgrade + upgrade again (idempotency check)

## Task 6 — Router (`app/routers/facturas.py`) + wire into `main.py`

- [x] 6.1 Write `test_factura_integration.py` (RED): HTTP integration tests against real Postgres
  - Unauthenticated → 401
  - POST /api/facturas → 201 with estado in response
  - GET /api/facturas → list with estado
  - GET /api/facturas/{id} → full response with items + estado
  - PATCH /api/facturas/{id} → updated
  - DELETE /api/facturas/{id} → 204
  - Foreign id → 404
  - GET /api/facturas?estado=PAGADA → filtered (after FIFO in service)
- [x] 6.2 Create `app/routers/facturas.py` (GREEN)
- [x] 6.3 Register router in `app/main.py`
- [x] 6.4 Triangulate: test that estado filter works correctly end-to-end;
  test that items_sum_mismatch=True appears when items sum != monto_total

## Review Workload Forecast

- Estimated changed lines: ~600 (schemas, repository, service, router, migration, tests)
- Chained PRs recommended: No (single coherent backend change)
- 400-line budget risk: Medium — all in one PR is acceptable for a backend feature slice
