## Why

C-02 delivered the `Proveedor` model, the `BaseRepository`, and a balance-aggregate query (`get_saldo_por_proveedor`), but there is still no way for an authenticated user to manage their suppliers over HTTP. Suppliers are the root of the entire business domain: every invoice and payment hangs off a `proveedor_id`, and the supplier list (ordered by computed balance) plus the name-search endpoint (RN-VINC) are prerequisites for C-07 (frontend), C-08 (invoices) and C-10 (payments). This change builds the supplier CRUD API with on-demand balance computation and strict per-user isolation, unblocking the whole downstream backend chain.

## What Changes

- Add the **supplier service layer** (`proveedor_service.py`): ownership-checked CRUD that returns **404** (never 403) for foreign resources, computes `saldo` on-demand by joining the repository aggregate, applies CUIT format validation, and reports `tiene_dependencias` on delete so the router/UI can decide whether to confirm (RN-PROV-04).
- Extend the **supplier repository** (`proveedor_repository.py`): add `list_by_usuario(usuario_id, page, order_by)` that returns the page of active suppliers **with their saldo in a single GROUP BY query** (no N+1), ordering by `nombre` or by the computed `saldo` aggregate; plus thin `create`/`update`/`soft_delete` wrappers over the existing base methods. The existing `get_saldo_por_proveedor` aggregate is reused, not rewritten.
- Add the **supplier router** (`proveedores.py`): `GET /api/proveedores` (paginated, `order_by=nombre|saldo`), `POST`, `GET /{id}`, `PATCH /{id}`, `DELETE /{id}`, and `GET /api/proveedores/buscar?nombre=` for RN-VINC linkage. All endpoints are guarded by `get_current_user`.
- Add the **supplier Pydantic schemas** (`proveedor.py`): `ProveedorCreate`, `ProveedorUpdate`, `ProveedorResponse` (includes `saldo: Decimal`), `ProveedorListItem`. CUIT regex validation `^\d{2}-\d{8}-\d{1}$` lives here and in the service.
- Add **Alembic migration `0003`**: a composite index `(usuario_id, LOWER(nombre))` (or collation-aware equivalent) to support normalized name search and `order_by=nombre`. Sequential after the existing `0001`/`0002`.
- Add **tests on real PostgreSQL** (testcontainers): full CRUD, soft delete preserves FKs, listing-by-saldo correct with mixed invoice/payment data, cross-user isolation → 404, and CUIT validation (valid/invalid).

No application behavior is removed and there are no breaking changes — this is additive on top of C-02. The invariant that `saldo` and `estado` are **never persisted** is preserved.

## Capabilities

### New Capabilities
- `proveedores-api`: HTTP API and service layer for supplier management — paginated/ordered listing with on-demand balance, create/read/update/soft-delete with per-user isolation (404 on foreign resource), CUIT validation, name search for RN-VINC linkage, and the supporting `(usuario_id, LOWER(nombre))` index migration.

### Modified Capabilities
<!-- None. core-data-models already specifies the Proveedor model and the saldo aggregate query; this change consumes those contracts without changing their requirements. The repository extension (list_by_usuario) is new behavior layered on top, captured under the new proveedores-api capability, not a requirement change to core-data-models. -->

## Impact

- **New code**: `app/services/proveedor_service.py`, `app/routers/proveedores.py`, `app/schemas/proveedor.py`, `alembic/versions/20240003_0003_proveedor_nombre_index.py`, `tests/test_proveedor_*.py`.
- **Modified code**: `app/repositories/proveedor_repository.py` (add `list_by_usuario` + thin CRUD wrappers; existing `get_saldo_por_proveedor` reused), `app/main.py` (register the new router).
- **APIs**: six new endpoints under `/api/proveedores`, all requiring an `access_token` cookie.
- **Dependencies**: none new — reuses `get_current_user` (C-03), `BaseRepository` (C-02), and the existing aggregate query. Alembic head moves from `0002` to `0003`.
- **Forward dependency note**: the saldo aggregate references `factura` and `pago` tables. Those tables already exist from migration `0001` (C-02), so the LEFT JOIN is safe today even though the invoice/payment **features** (C-08/C-10) are not yet built; for empty tables the aggregate naturally yields `0.00`.
- **Downstream**: unblocks C-07 (proveedores-frontend), and indirectly C-08/C-10 which depend on supplier existence and the search endpoint.
