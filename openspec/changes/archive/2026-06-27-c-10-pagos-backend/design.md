# Design: c-10-pagos-backend

## Context

C-08 (facturas-backend) is archived. It defines the FIFO estado algorithm (RN-FIFO) which depends on a payment pool aggregated by proveedor. C-06 stubbed `PagoRepository` with a single `list_by_proveedor` method, and C-08's `FacturaService` already consumes it for the FIFO pool. C-08 also stubbed `POST /api/pagos` inline in the router with a minimal `PagoCreate` and `PagoResponse` defined locally — no service, no ownership helper, no other endpoints.

This change graduates the stub into a full CRUD capability: real schemas, a real `PagoService` enforcing RN-PAG-*, the missing `GET`/`PATCH`/`DELETE` endpoints, and tests that prove the `Pago` model and the FIFO consumer stay isolated. The output is what C-11 (frontend) and C-12 (cuenta-corriente) will read and mutate.

The change must keep the same shape as C-06/C-08 so the next change (C-12) can extend `ProveedorService.get_cuenta_corriente` without touching the payment surface.

## Goals / Non-Goals

**Goals:**

- Complete CRUD for `Pago` over `GET /api/pagos`, `POST /api/pagos`, `GET /api/pagos/{id}`, `PATCH /api/pagos/{id}`, `DELETE /api/pagos/{id}`.
- Enforce RN-PAG-01..05 in the service layer (no `factura_id`, `monto > 0`, `fecha` not future UTC-3, `metodo` from enum, soft delete + edit recompute via re-aggregation).
- Guarantee multi-tenant isolation: every read filters by `usuario_id`; foreign or soft-deleted pagos return 404, never 403.
- Reuse the existing `PagoRepository.list_by_proveedor` from C-06 so the FIFO pool consumer in `FacturaService` keeps working without changes.
- Replace the C-08 inline `PagoCreate`/`PagoResponse` with proper schemas in `app/schemas/pago.py`.
- Provide a test suite that exercises the full RN-PAG-* surface against a real Postgres, including the C-08 FIFO pool contract (soft-deleted pago is excluded from the pool).

**Non-Goals:**

- Building the cuenta-corriente view (C-12).
- Frontend (C-11).
- IA extraction (C-14).
- Cancellations, reversals, or any per-factura linking (explicitly out of MVP per `05_reglas_de_negocio.md`).
- Changing the existing `facturas-api` spec.

## Decisions

### D1 — `Pago` schemas live in `app/schemas/pago.py`, not inline in the router

The C-08 stub defined `PagoCreate` and `PagoResponse` as `BaseModel` inside `app/routers/pagos.py`. This change moves them to `app/schemas/pago.py` alongside `factura.py` and `proveedor.py` to keep the architectural pattern consistent. The router imports from the schemas module and the inline definitions are removed.

### D2 — `PagoCreate` and `PagoUpdate` MUST NOT declare `factura_id` (RN-PAG-01)

`PagoCreate` declares exactly: `proveedor_id` (UUID, required), `monto` (Decimal, `gt=0`), `fecha` (date), `metodo` (MetodoPago enum), `comprobante_url` (Optional[str]). **No `factura_id`** anywhere — neither in the schema nor in the model. Pydantic's default is to **ignore** unknown fields; to make RN-PAG-01 actually enforceable from the wire, the schemas set `model_config = ConfigDict(extra="forbid")`. A test asserts that posting `{"proveedor_id": ..., "factura_id": ...}` returns 422.

### D3 — Service-layer authorization: `_get_owned_pago(usuario_id, pago_id) -> Pago`

Mirrors C-08's `_get_owned_factura` pattern. Raises `HTTPException(404, detail="Pago not found")` when:

- the row does not exist,
- `pago.deleted_at is not None`, or
- `pago.usuario_id != usuario_id`.

Foreign and soft-deleted pagos are indistinguishable from non-existent ones (D-06 — no enumeration). This helper is the single place that reads a `Pago` by id from the service layer.

### D4 — Service-layer validation beyond Pydantic (defense in depth)

Pydantic validates `monto > 0`, `metodo` from enum, and `fecha` as a date. The service layer re-validates:

- `monto > 0` (in case a future field bypasses Pydantic).
- `fecha <= today(UTC-3)` via `zoneinfo.ZoneInfo("America/Argentina/Buenos_Aires")` — Pydantic alone can't know "today" in the right zone.
- `Pago.usuario_id == Proveedor(of that pago).usuario_id` (RN: invariant from `04_modelo_de_datos.md`). If the `Proveedor` belongs to another user, the service returns 404.
- The `proveedor` is not soft-deleted.

Pydantic failures → 422. Service validation failures → 404 (foreign/missing proveedor) or 422 (future date / non-positive amount).

### D5 — `crear` sets `origen=MANUAL`; IA path is in C-14

The service stamps `origen=OrigenDocumento.MANUAL` on create. C-14 will introduce a `VisionExtractor.extraer_pago` that returns a `PropuestaPago` and a separate "confirm" endpoint that the frontend uses; that path is out of scope here. The schema accepts no `origen` field — the service controls it, the user cannot override it (mirrors C-08's D for Factura).

### D6 — `listar(usuario_id, proveedor_id?, page)` paginates and orders by fecha DESC, created_at DESC

The list is ordered by `fecha DESC, created_at DESC, id DESC` so the most recent payment surfaces first — same UX direction as C-08's invoice list. Pagination uses the existing page-size constant (default 50, configurable per request). When `proveedor_id` is provided, the list is filtered to that supplier; otherwise it covers the user's full payment history. Soft-deleted pagos are excluded.

### D7 — `actualizar` is patch semantics: all fields optional

`PagoUpdate` makes every field optional (`monto`, `fecha`, `metodo`, `comprobante_url`). `proveedor_id` is **not** changeable in PATCH — re-linking a pago to a different supplier would corrupt the FIFO pool's history. If a user wants to re-attribute a payment, the correct flow is delete + create. Only fields explicitly set (non-None) are applied. Same validators as `PagoCreate` for any provided value.

### D8 — `eliminar` is soft delete; the row stays, the FIFO pool re-aggregates

`PagoRepository.soft_delete(id)` sets `deleted_at = utcnow()`. The row remains in the DB; foreign keys stay valid. The next call to `PagoRepository.list_by_proveedor(..., include_deleted=False)` — which C-08's `FacturaService` already uses for the FIFO pool — automatically excludes it. This is exactly the same soft-delete semantics as `proveedor` and `factura` (D-04 in `09_decisiones_y_supuestos.md`). No cascade, no compensation logic. The endpoint returns 204 No Content on success; 404 if foreign or already soft-deleted.

### D9 — Router stays thin; no business logic in the router

Each handler:

1. Resolves the `current_user` from `Depends(get_current_user)`.
2. Calls the matching `PagoService` method with `current_user.id` as the first arg.
3. Commits the session on mutations.
4. Maps the service result to the Pydantic response schema.

The router does **not** check ownership, validate dates, compute balances, or filter — it only translates HTTP ↔ service. If the service raises `HTTPException`, FastAPI handles the response. This mirrors C-08 D8 and C-06 D7.

### D10 — Cloudinary preset endpoint extended for `tipo=comprobante`

The existing `GET /api/cloudinary/preset-firmado?tipo=...` endpoint (created in C-08) is extended to accept `tipo=comprobante` in addition to `tipo=factura` and `tipo=avatar`. Same validation contract: PDF/jpg/png, max 10 MB, signed upload preset, URL returned to the client. This is an additive change inside the same endpoint — no new endpoint, no new router file. The Cloudinary call itself is **already** mocked in tests (it was set up in C-08 with the `MockCloudinaryClient`); this change just adds a branch.

### D11 — Composite index on `pago` for FIFO pool queries

A new Alembic migration adds `ix_pago_usuario_proveedor_deleted_fecha` on `(usuario_id, proveedor_id, deleted_at, fecha)`. This is the exact shape the C-08 FIFO pool already queries (`list_by_proveedor` filters by `usuario_id` + `proveedor_id` + `deleted_at IS NULL`, ordered by `fecha`). The table itself was created in migration 0001 (C-02) — this migration only adds the index, no schema changes.

### D12 — No `Factura` changes

The `factura` table, `Factura` model, `FacturaRepository`, `FacturaService`, and the FIFO algorithm are **untouched**. The only consumer of `PagoRepository` is `FacturaService.listar` (which calls `list_by_proveedor` to build the pool), and that method signature is preserved verbatim.

### D13 — Schemas set `extra="forbid"` so the wire cannot smuggle `factura_id`

Pydantic v2 by default silently drops unknown fields. To make RN-PAG-01 enforceable from the outside (i.e., a malicious or careless client cannot bypass the schema by sending `factura_id`), all input schemas (`PagoCreate`, `PagoUpdate`) set `model_config = ConfigDict(extra="forbid")`. A test verifies that submitting `{"proveedor_id": ..., "factura_id": "<uuid>"}` returns 422 with a clear Pydantic error. This is the schema-level enforcement; the absence of the column on the model is the model-level enforcement.

## Layer interaction

```
Router (pagos.py)
  → PagoService (pago_service.py)
      → PagoRepository (CRUD + list_by_proveedor for FIFO pool)
      → ProveedorRepository (for ownership check on create)
      → PagoRepository.get / soft_delete (for own resource)
```

The `FacturaService` (already in C-08) calls `PagoRepository.list_by_proveedor(usuario_id, proveedor_id)` to build the FIFO pool. This change does not alter that call path.

## Key invariants enforced in this layer

| Invariant | Where enforced |
|---|---|
| `factura_id` not in model | `Pago` SQLModel has no such column (C-02) |
| `factura_id` not in schema | `PagoCreate` / `PagoUpdate` declare no such field |
| `factura_id` not in payload | `extra="forbid"` on input schemas returns 422 |
| `monto > 0` | Pydantic `Field(gt=0)` + service re-check |
| `fecha` not future | Service uses `zoneinfo.ZoneInfo("America/Argentina/Buenos_Aires")` |
| `metodo` in enum | Pydantic enum binding + service no-op (enum binding is enough) |
| `usuario_id` from session | Service takes `usuario_id` arg; router passes `current_user.id` |
| Proveedor ownership | Service fetches proveedor, checks `proveedor.usuario_id == usuario_id` |
| Soft delete invisible to FIFO | `PagoRepository.list_by_proveedor` filters `deleted_at IS NULL` by default |
| Foreign resource → 404 | `_get_owned_pago` raises 404, never 403 |
| Router thin | No validation, no auth, no computation in router |

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| A future change accidentally adds `factura_id` to the `Pago` SQLModel | Code review checklist (C-08 already documents this) + test asserting `Pago` model has no `factura_id` attribute via `hasattr` / `getattr` reflection |
| Cloudinary preset endpoint becomes a god-function with many `tipo` branches | Keep the dispatch small (`if tipo == "comprobante"` … `elif tipo == "factura"` … `elif tipo == "avatar"`); types live in a single `Literal["comprobante","factura","avatar"]` query param so OpenAPI documents them |
| Pagination shape differs from C-08 | Reuse the exact same `page` query param + 50-row default + `total` field response shape from C-08's `FacturaListItem` page so the frontend can use the same hook pattern in C-11 |
| Soft-deleting a pago is silently invisible to the user | C-08 already handles this for facturas; we mirror the same pattern. Tests cover "soft delete excludes from FIFO pool" end-to-end so the next change (C-12) can trust the contract |
| `monto` with too many decimals rounds weirdly | Pydantic + Postgres `numeric(12,2)` both enforce 2 decimals; service does not perform arithmetic, only stores the value |
| Migration is added on top of an already-archived C-08 | Document the dependency explicitly in the migration file header so a future `alembic downgrade` does not delete rows |
| Service raises 404 vs 422 ambiguity | Documented: foreign/missing → 404 (security baseline, no enumeration); bad input (monto, fecha, metodo, unknown field) → 422 |

## Open Questions

- **Q-PAG-01 (🟢):** Should the list response also include the `proveedor_nombre` to avoid a join from the frontend? — C-08's `FacturaListItem` does **not** include it, so for consistency this change does not either. If C-11 needs it, it can be added in a follow-up spec change.
- **Q-PAG-02 (🟢):** Should `comprobante_url` accept any HTTPS URL or strictly Cloudinary URLs? — For the MVP, accept any non-empty string (the Cloudinary preset is the controlled path; nothing else can sign a URL today). Document this in the schema's `Field(description=...)`.
