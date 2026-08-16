## Why

C-35 shipped the customer ledger four days ago: the balance, the FIFO state of every fiado, the chronological history — and `POST /api/cobros`, the only way to record that a customer paid. None of it is reachable from the app. C-34 gave the shop a way to *create* debt (a `Venta` with `forma_pago = CUENTA_CORRIENTE`) and no way to ever see it again, let alone settle it. Today a fiado is a write-only operation.

This change is the other half. It is also the first screen where the shop reads a number that decides what to charge a person standing in front of them, so the number has to be the one the API computed and nothing else.

There is a second reason, inherited. C-35 made the customer balance a **signed** value that may legitimately go **negative** (D-58), because C-34 lets a charge be removed while the payments credited against it remain. C-36 is the first and only place a human ever sees that negative number. If this change "fixes" it by clamping at zero, the shop stops being able to account for money it actually took.

## What Changes

- **`src/features/clientes/` grows its pages.** C-34 created only `src/features/clientes/api/`; this change adds `ClientesPage` (the customer list, sortable by balance) and `ClienteDetailPage` (the customer's card: balance, fiados with their FIFO state, chronological history).
- **New client layer for the customer ledger** — `cuentaCorrienteClienteApi.ts` + hooks against `GET /api/clientes/{id}/cuenta-corriente`, with the same Decimal-string → `number` parse boundary the supplier ledger already uses.
- **New client layer for cobros** — `cobrosApi.ts` + `cobrosHooks.ts` against `POST /api/cobros`. No cobros list page and no `/cobros` route: a cobro is recorded from the customer's card only (D-34).
- **"Registrar cobro" from the customer's card**, with the pending balance shown as a visible ceiling on the amount (RN-CCC-04) and the action unavailable when there is nothing to collect. The client-side ceiling is usability; the backend's `422` — which states the remaining balance — is the guarantee, and it is surfaced verbatim.
- **`HistorialCronologico` is generalized, not duplicated.** Its table moves to `src/shared/components/HistorialTable/`, parameterized over the row-type vocabulary; the supplier's `HistorialCronologico` becomes a thin pre-configured wrapper so its call site and its tests are untouched. `SaldoBadge` is reused by import, unchanged. `TablaFacturasConEstado` is **not** generalized — see design.md D3.
- **Cache invalidation without touching the ventas feature**: the customer-account query key is nested under `CLIENTE_KEYS`, so C-34's existing `invalidateQueries({ queryKey: CLIENTE_KEYS.all })` on every fiado create/edit/delete already refreshes the account view. That invalidation was written in C-34 with a comment saying it existed for C-36; this change is what makes the comment true.
- **Hand-written types** for the customer ledger and cobros added to `src/shared/api/api.d.ts`, matching the style of the 60+ named types already there. `npm run generate-types` is **not** run (C-41 owns that).
- **Routes + navigation**: `/clientes`, `/clientes/:id`, and a `Clientes` entry in `AppLayout`'s nav.
- **The cobro submit path is shaped for C-43 from day one** — see "Coordination with C-43" below. No idempotency is implemented here.

**Out of scope**: idempotency for `POST /api/cobros` (C-43); editing or deleting a cobro (the backend supports both; no UI is proposed — a mis-entered cobro is corrected by the same delete-and-re-record path the backend prescribes for moving one between customers, and that surface has not been designed); aggregations and statistics (C-37/C-38); export (C-39); anything under `facturas-proveedores-api/`.

## Capabilities

### New Capabilities
- `cuenta-corriente-clientes-frontend`: the customer's account screen — the signed balance rendered honestly including the negative case, the fiados with their on-demand FIFO state, the chronological history with its running balance, and the "registrar cobro" action bounded by the pending balance.

### Modified Capabilities
- `clientes-frontend`: C-34's spec states that a customers list or detail page "is out of scope and belongs to C-36". This change adds the requirements for those pages — the list ordered by balance, and the detail card — to that capability. The autocomplete requirements are unchanged.

## Impact

**Frontend only** — `src/features/clientes/` (two pages, `components/`, three new modules under `api/`), `src/shared/components/HistorialTable/` (new), `src/features/cuenta-corriente/components/HistorialCronologico.tsx` (becomes a wrapper; behaviour and tests unchanged), `src/shared/api/api.d.ts`, `src/app/router.tsx`, `src/shared/components/AppLayout/AppLayout.tsx`. Nothing under `facturas-proveedores-api/` is touched.

**Contract facts found while reading the C-32/C-35 backend.** None blocks the change; each is resolved in design.md, and each is a place where an assumption carried over from the supplier side would be wrong:

1. **`GET /api/clientes/{id}` always reports `saldo: null`.** The balance is populated *only* by the plain listing endpoint, via a single aggregate query (`ClienteResponse.saldo: Optional[Decimal] = None`). The detail page therefore reads the name from one endpoint and the balance from another, and must never render `cliente.saldo` — a field that is structurally null on exactly the page where a balance is the point.
2. **`Cliente.saldo` is typed `string | null` on the wire**, while `Proveedor.saldo` is `number`. Sorting the list by balance is a parse, not a comparison.
3. **The customer ledger's vocabulary is deliberately different from the supplier's.** `ventas_con_estado` (not `facturas_con_estado`); `EstadoVentaFiada` is `PENDIENTE | PARCIAL | COBRADA` (not `PAGADA` — a customer's sale reported as "paid" would read as though the shop had paid it); history `tipo` is `VENTA | COBRO` (not `FACTURA | PAGO`). Components typed to the supplier's enums cannot be pointed at customer data.
4. **A fiado has no `numero`, no `fecha_vencimiento` and no `origen`.** `TablaFacturasConEstado` renders all three. Generalizing it would produce a table whose columns are half-optional.
5. **`MetodoCobro` has no `CUENTA_CORRIENTE`** — debt is not cancelled with debt — and no `MERCADOPAGO`. It is its own enum, not `MetodoPago` and not `FormaPago`.
6. **`GET /api/cobros` is paginated** (`{ items, total, page, page_size }`), unlike `GET /api/ventas`. This change never calls it: the history already carries every cobro, and reading them twice from two endpoints is how two numbers on one screen start disagreeing.
7. **`POST /api/cobros` rejects a payment for a customer with no live fiados**, not only one that exceeds the balance. A balance of `0` and a balance of `-500` are both "nothing to collect", and a form that renders in either state is a form that can only fail.

**Risk — the balance is read as a decision, not as information.** Everything else here is a list and a table over endpoints that already work. If the balance shown is stale, clamped, or recomputed client-side, someone charges the wrong person the wrong amount. Mitigated by: no client-side arithmetic on `saldo`, `estado` or `saldo_acumulado` anywhere in this change; a parse boundary that *throws* on a malformed decimal rather than coercing to `0`; and the account query refetching on every visit.

**Risk — the negative balance gets treated as a bug.** `SaldoBadge` already renders negatives as "a favor", so the mechanism exists. The danger is a well-meaning `Math.max(0, saldo)` added later. Mitigated by a spec requirement and a test that asserts the negative case renders as the real figure, and by design.md naming C-34's warning copy as the explanation the user was already given.

**Risk — the cobro form invites a duplicate.** `POST /api/cobros` does **not** deduplicate today, and C-42's 20s global Axios timeout turns a stalled request into an explicit error that invites retrying. This change ships the same interim ambiguous-outcome copy `PagoForm` and `FacturaForm` already carry (D-67): it points at the customer's history and never claims retrying is safe, because it is not. C-43 replaces that one paragraph.

**Coordination with C-43 (runs in parallel).** C-43's Fase B wires idempotency into this cobro submit flow. To keep that a two-line change rather than a refactor, `crearCobro` is written from the start as the single async function that owns `POST /api/cobros`, resolving to `{ cobro, replay }` — never a bare response — and the form already branches on `replay`. C-43 adds `getIdempotencyKey` / `confirmIdempotencyKey` and the header inside that one function, and swaps the ambiguous-outcome paragraph. Nothing in the hook, the form, or the tests changes shape. C-36 implements **no** idempotency itself, and touches **no** backend file; C-43 Fase A is backend-only and runs in an isolated worktree.

**Governance: MEDIO.** No auth, no isolation axis. But it is the surface through which money coming in gets recorded, and the first surface that displays a balance a person is charged against — so the cobro path and the balance rendering get checkpointed rather than waved through.
