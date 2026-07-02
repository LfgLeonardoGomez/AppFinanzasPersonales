# Design: c-12-cuenta-corriente-backend

## Context

C-08 (facturas-backend, archived 2026-06-21) shipped the FIFO estado algorithm in `app/services/factura_service.py::_compute_estado_fifo(facturas, pool) -> dict[UUID, EstadoFactura]`, a pure function that takes pre-FIFO-ordered facturas and a payment pool, and returns the estado map. C-08 also shipped `FacturaRepository.list_by_proveedor(usuario_id, proveedor_id)`, which returns active facturas in `(fecha_emision ASC, created_at ASC, id ASC)` order. C-10 (pagos-backend, archived 2026-06-27) shipped `PagoRepository.list_by_proveedor(usuario_id, proveedor_id, include_deleted=False)`, which returns active pagos for a proveedor. C-06 (proveedores-backend, archived 2026-06-21) shipped `ProveedorRepository.get_saldo_por_proveedor(usuario_id)`, a single aggregate query returning `{proveedor_id: saldo}` for the user's active suppliers, and `ProveedorService._get_owned(usuario_id, proveedor_id)`, the ownership-check helper that returns 404 for foreign / missing / soft-deleted suppliers.

This change composes those pieces into one endpoint: `GET /api/proveedores/{id}/cuenta-corriente`. The service method does the work; the router is a thin HTTP wrapper; the response is a single JSON document with three blocks. No migration, no new package, no persisted derived data.

## Goals / Non-Goals

**Goals:**

- One read-only endpoint that returns the supplier's `{saldo, facturas_con_estado, historial}` triple, computed entirely on demand.
- Reuse the existing FIFO algorithm in `factura_service.py` — no copy/paste, no parallel implementation, no chance of drift.
- Enforce RN-SALDO (sign convention), RN-FIFO (deterministic ordering, PENDIENTE / PARCIAL / PAGADA), and RN-HIST (chronological merge with row-by-row `saldo_acumulado`).
- Preserve the no-persistence invariant: no `saldo` column on `proveedor`, no `estado` column on `factura`, no cache table for the cuenta-corriente.
- Multi-tenant isolation enforced in the service layer: foreign / soft-deleted supplier → 404, never 403.
- Test the algorithm exhaustively against real Postgres: ordering determinism under identical timestamps, pool-zero / pool-exacto / pool-parcial / pool-excedido, mixed / empty supplier, multi-user isolation, HTTP integration end-to-end.

**Non-Goals:**

- Caching the computed triple (forbidden by RN-SALDO / RN-FIFO / RN-HIST).
- Mutating endpoints. The cuenta-corriente is a view.
- Pagination of the cuenta-corriente payload (out of scope for MVP volumes).
- Filtering the cuenta-corriente by date range or estado (the frontend will client-side filter; the endpoint returns the full state).
- Frontend (C-13), IA extraction (C-14 / C-15), and any change to the `Factura` / `Pago` / `Proveedor` tables or to the `FacturaService` / `PagoService` / `ProveedorService` CRUD methods.

## Decisions

### D1 — Reuse `_compute_estado_fifo` from `factura_service` (no duplication)

The cuenta-corriente view needs exactly the same FIFO algorithm that `FacturaService` already runs in `listar` / `get` / `crear` / `actualizar`. The algorithm is a pure function exported from `app.services.factura_service` (it is included in `__all__` precisely so other modules can call it). The new `ProveedorService.get_cuenta_corriente` imports it and calls it on the supplier's active facturas with the supplier's active pago pool. **No second implementation, no helper module, no copy/paste.** If a future change wants to lift the algorithm to a shared module (`app/services/_fifo.py`), that is a separate refactor — not this change.

### D2 — `saldo` computed via the existing single-aggregate query (no N+1)

`ProveedorRepository.get_saldo_por_proveedor(usuario_id)` returns a `{proveedor_id: Decimal}` map for the user's active suppliers in a single query with pre-aggregated `factura_sums` and `pago_sums` subqueries (no fan-out double-count, no N+1). The new method calls it, picks the one entry for the requested `proveedor_id`, and uses it. The C-08 listing endpoint reuses the exact same method; C-12 reuses it too. The end-to-end cuenta-corriente call resolves `saldo` in **one** SELECT — not one per factura, not one per pago.

### D3 — Historial is a pure-function merge

`historial` is a list of `EntradaHistorial` items, each tagged `tipo: Literal["FACTURA","PAGO"]`, with a `fecha`, a `monto` (always positive; the sign is implicit in `tipo`), and a `saldo_acumulado` (signed: positive=deuda, negative=a favor). The merge is a pure function `_build_historial(facturas, pagos) -> list[EntradaHistorial]`:

1. Tag every factura with `tipo=FACTURA, monto=factura.monto_total`.
2. Tag every pago with `tipo=PAGO, monto=pago.monto`.
3. Sort the merged list by `(fecha ASC, created_at ASC, id ASC)`. This is the same ordering the C-08 / C-10 repositories already produce when called individually, so the merge is just a Python sort of two already-ordered lists (an O(n + m) merge, not an O((n+m) log (n+m)) sort — see D9).
4. Walk the sorted list; `saldo_acumulado` is the running sum where facturas add (debe) and pagos subtract (haber). The final `saldo_acumulado` MUST equal the `saldo` returned by the aggregate query (cross-check invariant; see D10).

The helper has no DB access and is unit-testable with plain Python lists.

### D4 — FIFO ordering is deterministic; tiebreak by `(created_at, id)`

`FacturaRepository.list_by_proveedor` returns rows in `(fecha_emision ASC, created_at ASC, id ASC)`. The C-08 contract guarantees this ordering; the new method trusts it and passes the list straight into `_compute_estado_fifo`. For the historial merge, the tiebreak is `(fecha ASC, created_at ASC, id ASC)` — same shape, applied to the union of facturas and pagos. **The repository, not the service, is responsible for the ordering** — the service never re-sorts on `fecha_emision` alone, because that would break determinism on identical dates. A test creates three facturas with the same `fecha_emision` and asserts the order is the same as the insertion order (i.e., the `created_at` tiebreak fires).

### D5 — Schemas live in a new `app/schemas/cuenta_corriente.py`

Following the project convention (one schemas file per resource), the new schemas are co-located in `app/schemas/cuenta_corriente.py`:

- `FacturaConEstado`: same shape as `FacturaResponse` minus `items`, plus `estado: EstadoFactura`. `from_attributes=True` so `model_validate(FacturaConEstado_wrapper)` works on the service-layer data class.
- `EntradaHistorial`: `tipo: Literal["FACTURA","PAGO"]`, `id: UUID` (the underlying row's id — `factura_id` or `pago_id`), `fecha: date`, `monto: Decimal` (always positive), `saldo_acumulado: Decimal` (signed). `from_attributes=True`.
- `CuentaCorrienteResponse`: `proveedor_id: UUID`, `saldo: Decimal`, `facturas_con_estado: list[FacturaConEstado]`, `historial: list[EntradaHistorial]`. `from_attributes=True` so the router can `model_validate` the service result directly.

The schemas are **output-only**. The endpoint has no request body and no query parameters, so there is no `CuentaCorrienteCreate` / `CuentaCorrienteUpdate`, no `extra="forbid"` (that's for input payloads, RN-PAG-01), no validators beyond the type system.

### D6 — Service-layer authorization: reuse `_get_owned`

The new method calls `self._get_owned(usuario_id, proveedor_id)` (the existing C-06 helper) to enforce that the supplier exists, is not soft-deleted, and belongs to `usuario_id`. Any of the three failure conditions raises the same `HTTPException(404, "Proveedor not found")`. The router never sees a 403.

### D7 — Router is a thin wrapper, declared between `/buscar` and `/{proveedor_id}`

The C-06 router note ("`/buscar` declared before `/{id}` to avoid route shadowing") applies here too. The new route is `GET /{proveedor_id}/cuenta-corriente` — it must be declared **before** `GET /{proveedor_id}` in the router file. Pattern:

```python
@router.get(
    "/{proveedor_id}/cuenta-corriente",
    response_model=CuentaCorrienteResponse,
    summary="Get a supplier's current account (saldo, facturas con estado, historial)",
)
def get_cuenta_corriente(
    proveedor_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> CuentaCorrienteResponse:
    svc = ProveedorService(session)
    result = svc.get_cuenta_corriente(current_user.id, proveedor_id)
    return CuentaCorrienteResponse.model_validate(result)
```

`Annotated` style with the existing `CurrentUser` / `DbSession` aliases (mirrors `facturas.py` and `pagos.py`).

### D8 — No `session.commit()` in the endpoint

`get_cuenta_corriente` is read-only. The router does **not** call `session.commit()`. Only mutating endpoints commit. The C-06 / C-08 / C-10 mutating endpoints commit; this one does not.

### D9 — Performance: three queries, not N+1

The end-to-end endpoint issues exactly three SQL statements against the supplier:

1. `SELECT * FROM proveedor WHERE id = ? AND deleted_at IS NULL AND usuario_id = ?` — the ownership check. One row, one index seek.
2. `SELECT * FROM factura WHERE usuario_id = ? AND proveedor_id = ? AND deleted_at IS NULL ORDER BY fecha_emision, created_at, id` — for the FIFO list and the historial. Backed by the C-08 composite index `ix_factura_usuario_proveedor_deleted_emision`.
3. `SELECT * FROM pago WHERE usuario_id = ? AND proveedor_id = ? AND deleted_at IS NULL ORDER BY fecha, created_at, id` — for the pool and the historial. Backed by the C-10 composite index `ix_pago_usuario_proveedor_deleted_fecha`.

The `saldo` aggregate from C-06 is **not** re-issued; the running `saldo_acumulado` of the last historial row is the same value (see D10). The list-by-proveedor queries are pre-indexed by the C-08 and C-10 migrations. For a supplier with 100 facturas and 50 pagos, the endpoint does three cheap index-range scans and an in-memory merge — sub-millisecond on the small-data MVP scale. The merge of two sorted lists is `O(n + m)`, not an `O((n + m) log (n + m))` sort.

### D10 — Cross-check invariant: end-of-historial `saldo_acumulado` == `saldo`

The simplest possible correctness check, used as a test assertion: after building the historial, the `saldo_acumulado` of the **last** entry MUST equal the `saldo` value returned by the C-06 aggregate query for the same supplier. This catches off-by-one errors, sign flips, and the "factura counted twice" class of bugs. The test creates a supplier with 3 facturas and 2 pagos, builds the cuenta-corriente, and asserts `historial[-1].saldo_acumulado == result.saldo`.

### D11 — Sign convention on `saldo` and `saldo_acumulado`

Per `05_reglas_de_negocio.md` §RN-SALDO: `saldo = SUM(facturas activas.monto_total) − SUM(pagos activos.monto)`. Positive = deuda. Negative = saldo a favor. The endpoint returns the raw signed `Decimal` (Pydantic serializes Decimal as a string by default — the frontend parses it). The historial `saldo_acumulado` follows the same convention at every row, so the user can read the running balance from the last row.

### D12 — Data classes for service-layer wrapping (mirrors C-08 / C-06)

The service returns three things the response schema cannot model directly: a `Factura` ORM entity with an attached `estado`, an `EntradaHistorial`-shaped row, and a `saldo` Decimal. The C-08 precedent (`FacturaConEstado` data class in `factura_service.py`) is reused for the first. The second is built as a small frozen `@dataclass` named `EntradaHistorial` (or as a Pydantic model constructed inside `_build_historial` — see D13). The third is a bare `Decimal`. The router does the final `model_validate` from the service result to the Pydantic response.

### D13 — Historial entries built in-memory (no extra Pydantic model on the service side)

The cleanest shape: `_build_historial` returns a `list[dict]` (or a `list[NamedTuple]`) with the same field names as the Pydantic `EntradaHistorial`. The router then iterates and `EntradaHistorial.model_validate(...)`s each entry. This avoids the service importing a Pydantic schema (the service should be Pydantic-agnostic — same discipline as C-08's `_compute_estado_fifo` not importing `FacturaResponse`).

### D14 — Tests follow the C-08 / C-10 layering

Three test modules, mirroring the C-08 / C-10 pattern:

- `test_cuenta_corriente_schemas.py` — Pydantic validation (pure unit tests, no DB).
- `test_cuenta_corriente_service.py` — `ProveedorService.get_cuenta_corriente` against real Postgres: ownership, saldo, FIFO, historial, edge cases. Uses the same fixtures as `test_factura_service.py` (one user, one supplier, several facturas + pagos).
- `test_cuenta_corriente_integration.py` — HTTP end-to-end via `TestClient`: 200 with full body, 401 unauth, 404 foreign supplier, 404 missing supplier, 404 soft-deleted supplier, 200 with empty list when supplier has no movements.

Strict TDD: each task writes the test (RED), runs it, watches it fail for the right reason, writes the minimum code to pass (GREEN), then adds 1–2 more cases per behavior (TRIANGULATE), then refactors.

## Refactor strategy — D1 in detail

The C-08 `_compute_estado_fifo` function is **already a pure function** with **no side effects and no DB access**. It takes a list of facturas (which the caller has pre-ordered) and a pool `Decimal`, and returns a `{id: EstadoFactura}` dict. The new method calls it as-is:

```python
from app.services.factura_service import _compute_estado_fifo

def get_cuenta_corriente(self, usuario_id, proveedor_id) -> ...:
    proveedor = self._get_owned(usuario_id, proveedor_id)

    # 1. Saldo (RN-SALDO) — single aggregate query
    saldos = self._repo.get_saldo_por_proveedor(usuario_id)
    saldo = saldos.get(proveedor.id, Decimal("0.00"))

    # 2. Active facturas + active pagos (already in deterministic order)
    facturas = self._factura_repo.list_by_proveedor(usuario_id, proveedor.id)
    pagos = self._pago_repo.list_by_proveedor(usuario_id, proveedor.id)

    # 3. Pool for FIFO
    pool = sum((p.monto for p in pagos), Decimal("0"))

    # 4. FIFO estado assignment (re-uses C-08's pure function)
    estado_map = _compute_estado_fifo(facturas, pool)

    # 5. Build FacturaConEstado wrappers + historial
    facturas_con_estado = [FacturaConEstado(f, estado_map.get(f.id, EstadoFactura.PENDIENTE)) for f in facturas]
    historial = _build_historial(facturas, pagos)

    return CuentaCorrienteResult(proveedor.id, saldo, facturas_con_estado, historial)
```

`_compute_estado_fifo` is exported in `__all__` of `app.services.factura_service`, so the import is public and stable. The cross-module import is intentional: this is the right time to compose, not to refactor. A future change (post-MVP) might extract the FIFO function to `app/services/_fifo.py` to make the dependency graph cleaner; that is a separate concern, not this change.

## Determinism — D4 in detail

**Factura ordering (for FIFO):** `(fecha_emision ASC, created_at ASC, id ASC)`. Enforced by `FacturaRepository.list_by_proveedor`. Two facturas with the same `fecha_emision` resolve their order by `created_at`; if `created_at` is also identical (rare; UUIDv4 → UUIDv7 in C-02 makes this rarer over time), `id ASC` is the final tiebreak. The C-08 algorithm itself does not sort; it trusts the input order.

**Historial ordering (for RN-HIST):** `(fecha ASC, created_at ASC, id ASC)` applied to the union of facturas and pagos. Facturas use `fecha_emision` as their `fecha`; pagos use `fecha`. The merge is a stable sort by Python's tuple comparator, but since each input list is already ordered by the same key (facturas by `fecha_emision`, pagos by `fecha`), the merge is effectively a two-pointer walk.

**Why not order by `id` alone?** Because UUIDv4 is random. Without a `fecha` tiebreak, the cuenta-corriente would shuffle every time the endpoint is called. The whole point of the deterministic ordering is that two calls in a row return the same list.

**Why not order by `fecha` alone?** Because two rows with the same `fecha` would have an undefined order in PostgreSQL (the engine is free to return them in any order). The `created_at` and `id` tiebreaks pin the order to insertion order, which is what the user expects.

## Pydantic schema shape — D5 in detail

### `CuentaCorrienteResponse` (top-level)

```json
{
  "proveedor_id": "uuid",
  "saldo": "1234.56",
  "facturas_con_estado": [ /* FacturaConEstado[] */ ],
  "historial": [ /* EntradaHistorial[] */ ]
}
```

`saldo` is signed: `> 0` deuda, `== 0` al día, `< 0` a favor. Serialized as a string by Pydantic v2 (Decimal default).

### `FacturaConEstado`

```json
{
  "id": "uuid",
  "usuario_id": "uuid",
  "proveedor_id": "uuid",
  "numero": "001-1234",  // optional
  "fecha_emision": "2026-06-15",
  "fecha_vencimiento": "2026-07-15",  // optional
  "monto_total": "1500.00",
  "archivo_url": "https://res.cloudinary.com/...",  // optional
  "origen": "MANUAL",
  "estado": "PENDIENTE",  // PENDIENTE | PARCIAL | PAGADA — computed, not stored
  "created_at": "2026-06-15T10:30:00Z",
  "updated_at": "2026-06-15T10:30:00Z"
}
```

Mirrors `FacturaResponse` from C-08 with `items` and `items_sum_mismatch` **omitted** (the cuenta-corriente view does not need line items; the detalle page will fetch them separately). The `estado` field is the FIFO output.

### `EntradaHistorial`

```json
{
  "id": "uuid",  // id of the underlying row (factura or pago)
  "tipo": "FACTURA",  // FACTURA | PAGO
  "fecha": "2026-06-15",
  "monto": "1500.00",  // always positive
  "saldo_acumulado": "1500.00"  // signed; running balance at this row
}
```

`id` is the underlying row's id (factura or pago) so the frontend can deep-link. The `tipo` discriminator lets the frontend render facturas (debe) and pagos (haber) with different visuals (e.g., red/green chips).

## Layer interaction

```
Router (proveedores.py)
  → ProveedorService.get_cuenta_corriente(usuario_id, proveedor_id)
      → _get_owned(usuario_id, proveedor_id)        # 404 on foreign/missing/deleted
      → ProveedorRepository.get_saldo_por_proveedor  # one aggregate query (RN-SALDO)
      → FacturaRepository.list_by_proveedor          # FIFO-ordered active facturas
      → PagoRepository.list_by_proveedor             # active pagos (the pool + historial)
      → _compute_estado_fifo(facturas, pool)         # imported from factura_service (RN-FIFO)
      → _build_historial(facturas, pagos)            # pure helper, no DB (RN-HIST)
  → maps to CuentaCorrienteResponse (Pydantic)
```

## Key invariants enforced in this layer

| Invariant | Where enforced |
|---|---|
| No `saldo` column on `proveedor` | `Proveedor` model has no such column (C-02) |
| No `estado` column on `factura` | `Factura` model has no such column (C-02) |
| No `factura_id` on `pago` | `Pago` model has no such column (C-02 / RN-PAG-01) |
| Saldo sign convention (RN-SALDO) | C-06 aggregate `SUM(facturas) − SUM(pagos)`; service returns the raw signed Decimal |
| FIFO ordering (RN-FIFO-01) | `FacturaRepository.list_by_proveedor` returns `(fecha_emision ASC, created_at ASC, id ASC)` |
| FIFO pool = ALL active pagos (RN-FIFO-02) | `PagoRepository.list_by_proveedor(include_deleted=False)` |
| FIFO estado = PENDIENTE / PARCIAL / PAGADA | `_compute_estado_fifo` (pure function, re-used from C-08) |
| Historial chronological + saldo_acumulado (RN-HIST) | `_build_historial` (new pure function in this change) |
| Cross-check: end-of-historial saldo == saldo | Test assertion in `test_cuenta_corriente_service` |
| Foreign / missing / soft-deleted supplier → 404 | `_get_owned` raises 404 (never 403) |
| Auth required (401) | `get_current_user` dependency on the router |
| No persistence of derived data | No `session.commit()` in the router; no INSERT / UPDATE anywhere |
| Router thin | Dependency → service call → `model_validate` (no logic) |

## Edge cases tested

| Edge case | Expected |
|---|---|
| Supplier with no facturas and no pagos | 200 with `saldo = 0.00`, `facturas_con_estado = []`, `historial = []` |
| Supplier with only facturas (no pagos) | All facturas PENDIENTE; historial grows positively row by row; last `saldo_acumulado` == `saldo` |
| Supplier with only pagos (no facturas) | All pagos have no facturas to cover; `saldo < 0` (saldo a favor); historial stays ≤ 0; last `saldo_acumulado` == `saldo` |
| Pool == sum of all facturas | All PAGADA; `saldo = 0`; historial ends at 0 |
| Pool > sum of all facturas (pool excedido) | All PAGADA; `saldo < 0`; historial ends negative |
| Pool == one factura exactly (boundary) | That one factura PAGADA (not PARCIAL); cross-check `saldo` |
| Three facturas with identical `fecha_emision` | Order by `created_at` ASC; FIFO consumes the pool in that order; reproducible across calls |
| Facturas and pagos on the same date | Historial merges them by `(created_at, id)`; the saldo at that row reflects both sides |
| Foreign supplier (user B requests user A's supplier) | 404, no payload leak |
| Soft-deleted supplier | 404 (the `_get_owned` helper checks `deleted_at IS NULL`) |
| Unauthenticated | 401 from `get_current_user` dependency |

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Cross-module import from `proveedor_service` to `factura_service` creates a coupling | The import is a pure function with a stable signature; the alternative is duplicating the algorithm, which is worse. A future refactor to `app/services/_fifo.py` is possible but out of scope here. |
| Cross-check invariant (`historial[-1].saldo_acumulado == saldo`) catches drift if the C-06 aggregate and the C-08/C-10 lists ever diverge | The test asserts it; if it fails, the bug is in the aggregate or the list — not in the cuenta-corriente math. The fix is upstream. |
| `FacturaRepository.list_by_proveedor` ordering is the FIFO contract | The C-08 archive documents this; C-12 tests assume the same order; the test `test_cuenta_corriente_determinism` re-asserts it. |
| Pagination of the cuenta-corriente is not handled | Out of scope for MVP volumes; documented in the proposal. If a supplier ever has >500 rows, the next change adds `?limit=&offset=`. |
| Schema's `Decimal` serializes as a string (Pydantic v2 default) | Frontend (C-13) parses the string; tests assert the type is `Decimal` server-side and the JSON payload is a string. |
| Three SQL queries per call (one supplier, two list-by-proveedor) | The C-08 and C-10 composite indexes make each list-by-proveedor an index-range scan. Three queries for the full cuenta-corriente is acceptable for the MVP; no N+1. |
| New file `app/schemas/cuenta_corriente.py` is a third schemas module | The project already has `proveedor.py`, `factura.py`, `pago.py`. Adding `cuenta_corriente.py` follows the established pattern. |
| The endpoint is read-only but still goes through `get_db` (which yields a session) | Sessions are scoped to the request and are cheap; no optimization needed. |

## Open Questions

- **Q-CC-01 (🟢):** Should the response include `proveedor_nombre` so the frontend can render a header without a separate `GET /api/proveedores/{id}` call? — Recommend: **no**. The C-11 frontend pattern is to join from the detail page; the cuenta-corriente endpoint stays focused on the cuenta-corriente triple. If C-13 needs it, it can be added in a delta to this spec.
- **Q-CC-02 (🟢):** Should the historial include `created_at` and `id` for client-side stable sort? — The ordering of the response is server-side and deterministic; the frontend renders in the order received. Adding `created_at` / `id` is not needed unless the frontend wants to verify order client-side, which it does not.
- **Q-CC-03 (🟢):** When the supplier has many movimientos (e.g., >500), the response payload grows. — Out of scope for the MVP. The proposal documents this; the next change adds pagination if needed.

</content>
