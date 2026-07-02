# Proposal: c-08-facturas-backend

## What

Implement the invoices (facturas) backend for the `facturas-proveedores-api` FastAPI service.
This includes: Pydantic schemas, an expanded FacturaRepository, the FacturaService with FIFO
estado computation, the `/api/facturas` router, one Alembic migration, and full test coverage.

## Why

C-06 (proveedores-backend) is archived and C-02 (core-models) established the Factura/FacturaItem
SQLModel entities. The frontend (C-09) is blocked until this API exists. This change delivers
the core business value: recording invoices and deriving their PENDIENTE/PARCIAL/PAGADA state
via the FIFO algorithm defined in RN-FIFO.

## Scope

### Backend repo: `facturas-proveedores-api`

**Schemas** (`app/schemas/factura.py`):
- `FacturaCreate`: proveedor_id (UUID), fecha_emision (date, not future UTC-3),
  monto_total (Decimal > 0), numero (str, optional), fecha_vencimiento (date, optional),
  archivo_url (str, optional), items (list[FacturaItemCreate], optional)
- `FacturaItemCreate`: descripcion (str), cantidad (Decimal > 0), precio_unitario (Decimal >= 0)
- `FacturaUpdate`: all fields optional (PATCH semantics), same validators
- `FacturaResponse`: full factura + estado: EstadoFactura + items: list[FacturaItemResponse]
- `FacturaListItem`: lean row with estado
- `EstadoFactura` enum: PENDIENTE / PARCIAL / PAGADA

**Repository** (`app/repositories/factura_repository.py`):
Extend the existing stub with:
- `list_by_usuario(usuario_id, proveedor_id?)` — active facturas, FIFO order
- `get_with_items(id)` — fetch factura + items
- `create_with_items(data, items)` — UoW atomic create (factura + items)
- `update_with_items(entity, data, new_items)` — replace items atomically
- `soft_delete(id)` — cascade-delete items in the same transaction

**Service** (`app/services/factura_service.py`):
- `listar(usuario_id, proveedor_id?, estado_filtro?, fecha_desde?, fecha_hasta?)`:
  Fetches all active facturas (optionally scoped to one proveedor). Computes FIFO estado
  per proveedor IN MEMORY (RN-FAC-09: NEVER filters by estado in SQL). Applies optional
  estado/fecha filters in Python AFTER computing.
- `crear(usuario_id, datos)`: validates proveedor ownership, fecha_emision not future
  (UTC-3), monto_total > 0, items_sum warning (non-blocking). Sets origen=MANUAL.
- `get(usuario_id, factura_id)`: ownership check, returns factura with computed estado.
- `actualizar(usuario_id, factura_id, datos)`: ownership check, applies PATCH update.
- `eliminar(usuario_id, factura_id)`: soft-delete; items cascade.
- FIFO helper `_compute_estado_fifo(facturas, pagos_pool)` — pure function, testable.

**Router** (`app/routers/facturas.py`):
- `GET /api/facturas?proveedor_id&page&estado&fecha_desde&fecha_hasta`
- `POST /api/facturas` → 201
- `GET /api/facturas/{id}`
- `PATCH /api/facturas/{id}`
- `DELETE /api/facturas/{id}`

**Migration** (`alembic/versions/20240004_0004_factura_indices.py`):
Add composite index `(usuario_id, proveedor_id, deleted_at, fecha_emision)` on `factura`
(the table already exists from migration 0001; this migration adds the optimized index).

## Out of scope

- Cloudinary preset endpoint (separate concern, C-09 can extend it).
- Pagos backend (C-10).
- Frontend (C-09).
- IA extraction (C-14).

## Dependencies satisfied

- C-02 (core-models): Factura, FacturaItem, Pago SQLModel entities exist.
- C-03 (auth-backend): get_current_user, get_db, UnitOfWork patterns established.
- C-06 (proveedores-backend): ProveedorRepository reused for ownership check.

## Hard rules (non-negotiable)

1. NEVER persist `estado` or `saldo` — always compute on-demand.
2. NEVER link Pago to Factura (`factura_id` must not exist).
3. Foreign resource → 404 (never 403). Auth in service layer only.
4. FIFO applied in memory AFTER SQL fetch, never in SQL WHERE clause.
5. Tests use real Postgres (testcontainers). External services mocked.
