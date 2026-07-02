# Proposal: c-15a-origen-ia-backend

## Why

The C-14 spec (`openspec/specs/ia-vision-backend/spec.md`) and C-15 proposal (`openspec/changes/c-15-ia-vision-frontend/proposal.md` OPEN QUESTION 1) both promise that the existing manual `POST /api/facturas` and `POST /api/pagos` endpoints stamp `origen=IA` when the IA confirmation path persists a vision-extracted document. **That contract is NOT implemented.** `FacturaCreate` and `PagoCreate` do not declare an `origen` field, the services hardcode `origen=OrigenDocumento.MANUAL`, and `PagoCreate` would actively reject any client-sent `origen` because of `extra="forbid"`. This 4-line backend hotfix closes the gap so the C-15 frontend can persist the `origen=IA` flag correctly, letting analytics and future filters distinguish IA-loaded documents from manual ones.

## What Changes

- **`app/schemas/factura.py`**: add `origen: OrigenDocumento | None = None` to `FacturaCreate`. Pydantic v2 default is `extra="ignore"`, so the field is silently accepted once declared; backward compatible (existing clients that omit it still get `MANUAL` via the service default).
- **`app/schemas/pago.py`**: add `origen: OrigenDocumento | None = None` to `PagoCreate`. **`model_config = ConfigDict(extra="forbid")` is preserved** — once `origen` is a known field, `forbid` only rejects truly unknown fields (the existing triple-enforcement for `factura_id` / `usuario_id` / `id` / `proveedor_id` stays intact).
- **`app/services/factura_service.py`**: in `FacturaService.crear()` (line 273), replace `origen=OrigenDocumento.MANUAL` with `origen=datos.origen or OrigenDocumento.MANUAL`. The fallback preserves the C-08 invariant that clients that do not send `origen` get `MANUAL`.
- **`app/services/pago_service.py`**: in `PagoService.crear()` (line 169), same change as above.
- **Tests**: add 3 cases per create endpoint (factura and pago): `origen='IA'` persists, `origen` omitted defaults to `MANUAL`, `origen='INVALID'` returns 422 (Pydantic enum validation). The existing `test_origen_rejected` test for `PagoCreate` is replaced — `PagoUpdate`'s `origen` rejection stays valid (no schema change there).

## Capabilities

### Modified Capabilities

- `facturas-api`: 1 ADDED requirement — the create endpoint SHALL honor the `origen` field from the request body and fall back to `MANUAL` when omitted.
- `pagos-backend`: 1 ADDED requirement — same contract for the `Pago` create endpoint.

## Impact

- **Repo**: `facturas-proveedores-api/` only. Frontend `facturas-proveedores-web/` is **NOT touched** (the C-15 frontend change ships separately and depends on this hotfix).
- **Code**: 4 lines of code change (1 field per schema + 1 service call per service), plus 1 import line each if `OrigenDocumento` is not already in scope (it is — verified).
- **Tests**: ~30-50 lines added (3 cases × 2 endpoints; parametrized). One existing test (`test_pago_schemas.py::test_origen_rejected`) is updated to reflect the new contract.
- **Schema migration**: NONE. The `origen` column already exists in `factura` and `pago` tables (created by earlier C-08/C-10 migrations) and is already populated by the service layer.
- **Dependencies**: NONE. No new packages, no env vars.
- **Other endpoints**: NOT touched. `FacturaUpdate`, `PagoUpdate`, listing, and read endpoints are unchanged. `origen` remains immutable post-create (consistent with the existing `OrigenDocumento.MANUAL` stamping pattern — `RN-PAG-04` and `RN-FAC-08`).
- **Backward compatibility**: 100% additive. Clients that omit `origen` get exactly the same `MANUAL` row as before. Clients that send `origen='IA'` now get `IA` instead of getting a 422 (PagoCreate) or a silent `MANUAL` (FacturaCreate).
- **Risk**: low. The change is opt-in (only fires when the client sends `origen`), and the default path is identical to today's behavior. No new validation rules, no new error responses, no new env vars.
