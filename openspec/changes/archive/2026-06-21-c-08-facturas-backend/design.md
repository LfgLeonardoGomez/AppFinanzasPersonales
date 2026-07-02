# Design: c-08-facturas-backend

## Architecture decisions

### D1 — FIFO is a pure in-memory function
`_compute_estado_fifo(facturas: list[Factura], pool: Decimal) -> dict[uuid.UUID, EstadoFactura]`

Receives ALL active facturas for a proveedor (ordered by `fecha_emision ASC, created_at ASC, id ASC`
— deterministic per RN-FIFO-01), the aggregated payment pool (a single Decimal), and returns
a mapping of `factura_id → estado`. This is a pure function with no DB access, making it
trivially testable and reusable from `listar`, `get`, and the future cuenta-corriente service.

### D2 — Payment pool sourced from a single aggregate query
`FacturaRepository` does not compute the payment pool. The service layer calls
`PagoRepository.list_by_proveedor(usuario_id, proveedor_id)` to fetch active pagos,
then sums their montos in Python. This keeps repositories as pure data access and
avoids cross-repo aggregates inside a single repository.

### D3 — listar works across all of a user's suppliers when proveedor_id is None
When `proveedor_id` is None, the service fetches all active facturas for the user
(`FacturaRepository.list_by_usuario`), groups them by proveedor_id in Python, fetches the
payment pool for each distinct proveedor, and computes FIFO per group. This avoids N+1:
one SQL for all facturas + one SQL per distinct proveedor for payments (bounded by
the number of distinct proveedores in the result set, not the number of facturas).

### D4 — Items replaced atomically on update
On `actualizar`, old items are deleted (hard delete — FacturaItem has no soft delete)
and new items are inserted in the same flush. The caller (router) commits after service returns.
This mirrors the create pattern and prevents orphaned items.

### D5 — fecha_emision validated against UTC-3
`America/Argentina/Buenos_Aires` is UTC-3 year-round (no DST). The check is:
`fecha_emision <= date.today() in UTC-3`, implemented with `zoneinfo.ZoneInfo("America/Argentina/Buenos_Aires")`.
This validation lives in the service layer (not only Pydantic), consistent with D7 of C-06.

### D6 — monto_total vs items sum: warning, not block
If `sum(item.cantidad * item.precio_unitario) != monto_total`, the service logs a warning
and proceeds normally (RN-FAC-04). The response includes a boolean `items_sum_mismatch`
so the frontend can display a non-blocking warning.

### D7 — Ownership check reuses ProveedorService pattern
`_get_owned_factura(usuario_id, factura_id) -> Factura` raises 404 if the factura is missing,
soft-deleted, or its `usuario_id != usuario_id arg`. Foreign resource → 404 (security baseline).

### D8 — Router stays thin
Router: dependency injection → call service method → commit → map to schema.
No business logic, no authorization, no calculations in the router.

### D9 — Migration adds optimized index
Migration `0004` adds `ix_factura_usuario_proveedor_deleted_emision` on
`(usuario_id, proveedor_id, deleted_at, fecha_emision)`. The table and its basic indexes
already exist from migration 0001. This composite index optimizes FIFO queries.

## Layer interaction

```
Router (facturas.py)
  → FacturaService (factura_service.py)
      → FacturaRepository (for factura + item CRUD)
      → PagoRepository (for FIFO pool aggregation)
      → ProveedorRepository (for ownership verification)
      → _compute_estado_fifo() (pure function)
```

## Key invariants enforced in this layer

| Invariant | Where enforced |
|---|---|
| estado not persisted | Model has no estado column; service computes on-demand |
| saldo not persisted | Not relevant to Factura; proveedor saldo computed in C-06 |
| factura_id not on Pago | PagoRepository never queries by factura_id |
| usuario_id from session | Service takes usuario_id arg; router passes current_user.id |
| fecha_emision not future | Service validates in UTC-3 (D5) |
| monto_total > 0 | Pydantic schema + service layer |
| FIFO filter in Python | Service fetches all facturas, filters estado in Python (RN-FAC-09) |
| Foreign resource → 404 | _get_owned_factura raises 404, never 403 |
