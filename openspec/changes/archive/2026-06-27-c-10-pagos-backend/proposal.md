# Proposal: c-10-pagos-backend

## Why

C-08 (facturas-backend) is archived and ships the `factura` table, the `Factura` SQLModel, and the FIFO estado computation that depends on a **payment pool** per supplier. The supplier balance (RN-SALDO) and the cuenta-corriente experience (C-12) cannot exist until payments are first-class, isolated, and queryable. The frontend (C-11) and the cuenta-corriente backend (C-12) are blocked until this API exists. C-06 already established the `Pago` SQLModel and a minimal `PagoRepository` (used by C-08's FIFO pool aggregation), and a stub `routers/pagos.py` with only `POST /api/pagos`. This change delivers the **complete CRUD** for payments — including a service layer that enforces every RN-PAG-* invariant — so the FIFO algorithm has a real, isolated data source to draw from, and C-12 can build the cuenta-corriente view on top.

## What Changes

- Add `app/schemas/pago.py` with `PagoCreate`, `PagoUpdate`, `PagoResponse`, `PagoListItem` — schemas **must not** declare or accept a `factura_id` field; any payload that tries to send one is rejected at the Pydantic layer (RN-PAG-01).
- Expand `PagoRepository` with `list_by_usuario(usuario_id, proveedor_id?, page)` (paginated, scoped to active pagos), `get`, `create`, `update`, `soft_delete`. Reuses the existing `list_by_proveedor` already used by the FIFO pool in C-08.
- Create `app/services/pago_service.py` with `crear`, `listar`, `get`, `actualizar`, `eliminar`. All authorization and validation live in the service layer (not router, not repository). Soft-deleted pagos are invisible to FIFO pool aggregation.
- Expand `app/routers/pagos.py` to full CRUD: `GET /api/pagos?proveedor_id&page`, `POST /api/pagos`, `GET /api/pagos/{id}`, `PATCH /api/pagos/{id}`, `DELETE /api/pagos/{id}`. Replace the C-08 stub `PagoCreate`/`PagoResponse` inline models with imports from `app/schemas/pago.py`.
- Register the router in `app/main.py` (idempotent — already mounted by C-08's stub).
- Extend the existing `GET /api/cloudinary/preset-firmado` endpoint to accept `tipo=comprobante` (for the future C-11 frontend) with the same validation as `tipo=factura` (PDF/jpg/png, ≤ 10 MB).
- Add Alembic migration adding the composite index `(usuario_id, proveedor_id, deleted_at, fecha)` on `pago` to keep FIFO pool queries fast as data grows.
- Add test coverage: schema rejects `factura_id`, Pydantic rejects `monto <= 0`, service rejects future `fecha`, ownership isolation (user B → 404 on user A's pago), soft-delete keeps the row but excludes it from FIFO, edit/delete does not break cuenta-corriente invariants because nothing derived is persisted.

## Capabilities

### New Capabilities

- `pagos-backend`: The HTTP API for payment management — full CRUD with on-demand validation against `proveedor` ownership, no `factura_id` field anywhere (RN-PAG-01), service-layer authorization (foreign resource → 404), and an isolated pool of active pagos that the FIFO algorithm in C-08 / C-12 can consume without re-implementing ownership checks.

### Modified Capabilities

<!-- None. C-08's `facturas-api` spec does not change — this change adds a NEW capability
     and does not modify the `factura` table, the `Factura` SQLModel, or the FIFO
     algorithm. The cloudinary preset endpoint extension is an additive enhancement,
     not a requirement change in the existing capability. -->

## Impact

- **Repo**: `facturas-proveedores-api` (backend). No frontend change — consumed by C-11 and C-12.
- **New code**:
  - `app/schemas/pago.py` — Pydantic schemas (Create, Update, Response, ListItem).
  - `app/services/pago_service.py` — `PagoService` with authorization + validation.
  - `alembic/versions/<ts>_pago_indices.py` — composite index on `pago`.
  - `tests/test_pago_*.py` — schema, repository, service, integration tests against real Postgres.
- **Modified code**:
  - `app/repositories/pago_repository.py` — adds `list_by_usuario` and the rest of the CRUD surface (extends the existing `list_by_proveedor` used by C-08's FIFO pool).
  - `app/routers/pagos.py` — replaces inline Pydantic models with schema imports; adds the missing endpoints; delegates to `PagoService`.
- **Reused code**:
  - `Pago` SQLModel (C-02), `PagoRepository.list_by_proveedor` (C-06, used by `FacturaService` for the FIFO pool in C-08).
  - `ProveedorService` ownership pattern (C-06 / C-08) for the `_get_owned_pago` helper.
  - `BaseRepository.get/update/soft_delete` (C-02) — no business logic, no auth.
  - `_TZ_AR` UTC-3 helper pattern from C-08.
- **Dependencies**: C-06 (proveedores-backend) for the supplier ownership check; C-08 (facturas-backend, archived) for the `FacturaService` FIFO consumer that now reads from the real `Pago` pool. No new Python packages.
- **Governance**: ALTO — same as C-08 (multi-tenant scoping on every read, service-layer authorization, isolation of derived data, no `factura_id` in payload or schema).

## Out of scope

- Cuenta-corriente view (C-12) — depends on this change but is its own change.
- Pagos frontend (C-11) — depends on this change.
- IA extraction for pagos (C-14) — same `VisionExtractor` interface, separate change.
- Cancellations, reversals, or partial-payment linking — none in the MVP; the KB explicitly states "edición libre" (RN-PAG-05).

## Dependencies satisfied

- C-02 (core-models): `Pago` SQLModel exists with the exact fields required.
- C-06 (proveedores-backend): `ProveedorRepository` ownership pattern established; `PagoRepository` stub exists.
- C-08 (facturas-backend): the `FacturaService` already calls `PagoRepository.list_by_proveedor(usuario_id, proveedor_id)` to build the FIFO pool — once the repository is expanded, that call still works.

## Hard rules (non-negotiable)

1. **NEVER** persist `estado` or `saldo` — always compute on-demand (D-01, RN-SALDO).
2. **NEVER** add a `factura_id` column to `Pago` or accept one in any schema (RN-PAG-01). Schemas reject unknown fields; tests assert this.
3. **NEVER** allow a Pago to reference a Proveedor owned by a different user — service layer validates ownership; foreign resource returns 404, never 403 (D-06).
4. **EVERY** service method takes `usuario_id` as an argument — no implicit "current user" inside the service. Router is the only place that calls `current_user.id`.
5. **FIFO pool** in C-08 already filters by `deleted_at IS NULL`; soft-deleting a pago does not corrupt estado — but tests MUST verify the invariant end-to-end.
6. **Tests** use real Postgres (testcontainers). External services (Cloudinary) mocked. No SQLite.
7. **`fecha`** validated as `≤ today` in `America/Argentina/Buenos_Aires` (UTC-3, no DST) at the service layer — Pydantic accepts any date; service rejects future dates with HTTP 422.
8. **`monto`** validated as `> 0` by Pydantic (`Field(gt=0)`) AND re-validated by the service as a defense-in-depth measure.
9. **HTTP semantics**: `POST` → 201; `GET` → 200; `PATCH` → 200; `DELETE` → 204; auth failure → 401; foreign resource → 404; validation failure → 422.
