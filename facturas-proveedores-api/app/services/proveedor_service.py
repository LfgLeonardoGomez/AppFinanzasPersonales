"""
ProveedorService — business logic for supplier management.

Design decisions implemented (C-06 design.md):
- D5: Ownership check in the SERVICE layer only — never in router or repo.
  Foreign resource is indistinguishable from non-existent (returns 404, never 403).
- D1/D2/D3: Paginated listing delegates to ProveedorRepository.list_by_usuario
  (single aggregate query — no N+1).
- D6: eliminar soft-deletes and returns tiene_dependencias (never blocks on deps).
- D7: CUIT re-validated in the service layer (in addition to Pydantic schema).
- saldo computed on-demand via repo.get_saldo_por_proveedor for single-supplier reads.

C-12 additions:
- get_cuenta_corriente composes the existing saldo aggregate (RN-SALDO),
  the C-08 FIFO algorithm (imported from factura_service), and the
  C-10 pago list into the on-demand triple {saldo, facturas_con_estado, historial}.
- _build_historial is a PURE FUNCTION (D3, D4) that merges active facturas
  and active pagos into a chronologically-ordered list with a running
  saldo_acumulado. No DB access; tested in isolation.

Hard rules enforced here:
- usuario_id is ALWAYS taken from the service arg, never from the payload.
- All authorization lives HERE; router just wires Depends(get_current_user).
- Raises HTTPException(404) on foreign or missing resource.
- NEVER persists saldo or estado.
- NO `factura_id` join from pago — the cuenta-corriente view is the proof
  that RN-PAG-01 holds end-to-end.
"""

import re
import uuid
from decimal import Decimal
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.factura import Factura
from app.models.pago import Pago
from app.models.proveedor import Proveedor
from app.repositories.factura_repository import FacturaRepository
from app.repositories.pago_repository import PagoRepository
from app.repositories.proveedor_repository import ProveedorRepository, ProveedorConSaldo
from app.schemas.proveedor import ProveedorCreate, ProveedorUpdate

_CUIT_REGEX = re.compile(r"^\d{2}-\d{8}-\d{1}$")

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Proveedor not found",
)


class ProveedorConSaldoResponse:
    """
    Combines a Proveedor ORM entity with its on-demand saldo.

    Used for single-supplier responses (GET /{id}, POST, PATCH) where
    we have a Proveedor entity but need to attach the scalar saldo from
    the aggregate. Delegates attribute access to the underlying entity
    so it can be used with ProveedorResponse.model_validate(obj).
    """

    def __init__(self, proveedor: Proveedor, saldo: Decimal) -> None:
        self._proveedor = proveedor
        self.saldo = saldo

    def __getattr__(self, name: str) -> Any:
        # Delegate all attribute access to the underlying Proveedor entity
        return getattr(self._proveedor, name)


class ProveedorService:
    """
    Business logic for supplier CRUD.

    All public methods take usuario_id as the first argument after self.
    The router passes get_current_user.id here — never from the request body.
    """

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repo = ProveedorRepository(session)
        self._factura_repo = FacturaRepository(session)
        self._pago_repo = PagoRepository(session)

    # ── Private helpers ────────────────────────────────────────────────────────

    def _get_owned(self, usuario_id: uuid.UUID, proveedor_id: uuid.UUID) -> Proveedor:
        """
        Fetch a supplier by id, verifying ownership and active status.

        Raises HTTPException(404) if:
        - Not found at all.
        - Belongs to a different user (enumeration leak prevention, D5).
        - Is soft-deleted.
        """
        entity = self._repo.get(proveedor_id)
        if (
            entity is None
            or entity.deleted_at is not None
            or entity.usuario_id != usuario_id
        ):
            raise _NOT_FOUND
        return entity

    def _get_saldo_for(self, usuario_id: uuid.UUID, proveedor_id: uuid.UUID) -> Decimal:
        """
        Get the on-demand saldo for a single supplier.

        Reuses the existing aggregate query, returns 0.00 if no movements.
        Normalizes the result to 2 decimal places so the JSON wire format
        is always `0.00` (not `0`) for consistency with numeric(12,2).
        """
        saldos = self._repo.get_saldo_por_proveedor(usuario_id)
        value = saldos.get(proveedor_id, Decimal("0.00"))
        return value.quantize(Decimal("0.01"))

    @staticmethod
    def _validate_cuit(cuit: Optional[str]) -> None:
        """Re-validate CUIT format in the service layer (D7, regla dura)."""
        if cuit is not None and not _CUIT_REGEX.match(cuit):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="CUIT must match the format NN-NNNNNNNN-N",
            )

    # ── Public API ─────────────────────────────────────────────────────────────

    def listar(
        self,
        usuario_id: uuid.UUID,
        page: int = 1,
        order_by: str = "nombre",
    ) -> list[ProveedorConSaldo]:
        """
        Return a paginated page of the user's active suppliers with saldo.

        Delegates entirely to the repository's single-aggregate query (D1/D2).
        """
        return self._repo.list_by_usuario(usuario_id, page=page, order_by=order_by)

    def crear(
        self,
        usuario_id: uuid.UUID,
        datos: ProveedorCreate,
    ) -> Proveedor:
        """
        Create a new supplier owned by usuario_id.

        Hard rule: usuario_id is ALWAYS taken from the arg, never from datos.
        CUIT re-validated in the service layer (D7).
        Returns the persisted Proveedor entity (not yet committed — caller commits).
        """
        self._validate_cuit(datos.cuit)

        proveedor = self._repo.create(
            usuario_id=usuario_id,
            nombre=datos.nombre,
            cuit=datos.cuit,
            telefono=datos.telefono,
            categoria=datos.categoria,
            notas=datos.notas,
        )
        return proveedor

    def get(
        self,
        usuario_id: uuid.UUID,
        proveedor_id: uuid.UUID,
    ) -> ProveedorConSaldoResponse:
        """
        Return a single supplier with its on-demand saldo.

        Raises 404 if the supplier does not belong to usuario_id or is deleted.
        """
        entity = self._get_owned(usuario_id, proveedor_id)
        saldo = self._get_saldo_for(usuario_id, proveedor_id)
        return ProveedorConSaldoResponse(entity, saldo)

    def actualizar(
        self,
        usuario_id: uuid.UUID,
        proveedor_id: uuid.UUID,
        datos: ProveedorUpdate,
    ) -> ProveedorConSaldoResponse:
        """
        Partially update a supplier owned by usuario_id.

        Only provided (non-None) fields are applied (PATCH semantics).
        Raises 404 on foreign or missing supplier.
        """
        entity = self._get_owned(usuario_id, proveedor_id)

        # Build the dict of fields to update (skip None values for PATCH)
        update_data = datos.model_dump(exclude_unset=True)
        if "cuit" in update_data:
            self._validate_cuit(update_data["cuit"])

        updated = self._repo.update(entity, **update_data)
        saldo = self._get_saldo_for(usuario_id, proveedor_id)
        return ProveedorConSaldoResponse(updated, saldo)

    def eliminar(
        self,
        usuario_id: uuid.UUID,
        proveedor_id: uuid.UUID,
    ) -> dict:
        """
        Soft-delete a supplier owned by usuario_id.

        - Checks ownership first (raises 404 on foreign/missing/deleted).
        - Checks tiene_dependencias BEFORE soft-delete (active rows).
        - Performs the soft-delete (sets deleted_at).
        - Never blocks on dependencies (RN-PROV-04).

        Returns: {"id": proveedor_id, "tiene_dependencias": bool}
        """
        entity = self._get_owned(usuario_id, proveedor_id)

        # Check dependencies against ACTIVE rows (before deleting the supplier)
        tiene_deps = self._repo.tiene_dependencias(proveedor_id)

        self._repo.soft_delete(proveedor_id)

        return {"id": entity.id, "tiene_dependencias": tiene_deps}

    def buscar_por_nombre(
        self,
        usuario_id: uuid.UUID,
        nombre: str,
    ) -> list[Proveedor]:
        """
        Search active suppliers by normalized nombre fragment.

        Normalizes the query (lowercase, strip) before delegating to the repo.
        Returns all matching active suppliers for the caller only.
        """
        normalized = nombre.lower().strip()
        return self._repo.search_by_nombre(usuario_id, normalized)


# ── C-12 — Cuenta corriente composition ─────────────────────────────────────


class _CuentaCorrienteResult:
    """
    Service-layer container for the on-demand cuenta-corriente triple.

    `facturas_con_estado` is a list of `FacturaConEstado` data wrappers
    (from `factura_service`) carrying the FIFO estado.
    `historial` is a list of plain dicts (Pydantic-agnostic; the router
    builds `EntradaHistorial` objects from these via `model_validate`).
    """

    def __init__(
        self,
        proveedor_id: uuid.UUID,
        saldo: Decimal,
        facturas_con_estado: list,
        historial: list[dict],
    ) -> None:
        self.proveedor_id = proveedor_id
        self.saldo = saldo
        self.facturas_con_estado = facturas_con_estado
        self.historial = historial


def _build_historial(
    facturas: list,
    pagos: list,
) -> list[dict]:
    """
    Pure merge of active facturas and pagos for one supplier (RN-HIST).

    Returns a list of dicts with keys: id, tipo, fecha, monto, saldo_acumulado.
    `tipo` is "FACTURA" (debe) or "PAGO" (haber).
    `monto` is always positive — the sign is implicit in `tipo`.
    `saldo_acumulado` is the running balance; facturas add, pagos subtract.
    The sign convention matches RN-SALDO (positive = deuda, negative = a favor).

    Order (D4): (fecha ASC, created_at ASC, id ASC). Facturas use
    `fecha_emision` as their `fecha`; pagos use `fecha`. Callers MUST
    pass lists already in repository-natural order (each list is already
    sorted by its own key), but this function re-sorts the union to be
    robust to any caller ordering — the cost is O((n+m) log (n+m)) which
    is fine for MVP volumes.

    NO DB access. NO side effects. Tested in isolation.
    """
    tagged: list[tuple] = []
    for f in facturas:
        tagged.append(
            (f.fecha_emision, f.created_at, f.id, f.id, "FACTURA", f.monto_total)
        )
    for p in pagos:
        tagged.append((p.fecha, p.created_at, p.id, p.id, "PAGO", p.monto))

    # Stable sort by (fecha ASC, created_at ASC, id ASC) — see D4.
    tagged.sort(key=lambda row: (row[0], row[1], row[2]))

    historial: list[dict] = []
    running = Decimal("0.00")
    for _fecha, _created, _id, row_id, tipo, monto in tagged:
        if tipo == "FACTURA":
            running += monto
        else:  # PAGO
            running -= monto
        historial.append(
            {
                "id": row_id,
                "tipo": tipo,
                "fecha": _fecha,
                "monto": monto,
                "saldo_acumulado": running,
            }
        )
    return historial


# Attach the new method to ProveedorService (deferred method definition so
# the helper can be defined after the class block above).
def _get_cuenta_corriente_impl(
    self,
    usuario_id: uuid.UUID,
    proveedor_id: uuid.UUID,
) -> _CuentaCorrienteResult:
    """
    Build the on-demand cuenta-corriente triple for one supplier (C-12).

    Steps (design.md D1, D2, D3, D7):
    1. Ownership check (raises 404 on foreign/missing/deleted).
    2. Saldo via the existing single-aggregate query (no N+1).
    3. Active facturas + active pagos (deterministic order from the repos).
    4. Pool = sum of active pagos.
    5. FIFO estado via the imported `_compute_estado_fifo` (C-08 algorithm
       reused, never duplicated).
    6. Wrap facturas into `FacturaConEstado` data objects.
    7. Build the chronological `historial` via the pure `_build_historial`.

    The result is a `_CuentaCorrienteResult`. The router maps it to
    `CuentaCorrienteResponse` via `model_validate`.
    """
    # Defer the import to avoid a circular dependency at module load
    # (factura_service imports from models; the helper is fine).
    from app.services.factura_service import (
        FacturaConEstado,
        _compute_estado_fifo,
    )
    from app.models.enums import EstadoFactura

    proveedor = self._get_owned(usuario_id, proveedor_id)

    # 1. Saldo — single aggregate (no N+1)
    saldo = self._get_saldo_for(usuario_id, proveedor.id)

    # 2. Active facturas + active pagos (already in deterministic order)
    facturas = self._factura_repo.list_by_proveedor(usuario_id, proveedor.id)
    pagos = self._pago_repo.list_by_proveedor(usuario_id, proveedor.id)

    # 3. Pool = sum of all active pagos (RN-FIFO-02)
    pool = sum((p.monto for p in pagos), Decimal("0"))

    # 4. FIFO estado assignment — import the C-08 algorithm verbatim
    estado_map = _compute_estado_fifo(facturas, pool)

    # 5. Wrap each factura with its computed estado.
    # `FacturaConEstado` from C-08 carries items + items_sum_mismatch; the
    # cuenta-corriente view omits them via the Pydantic schema, so passing
    # default values is safe (model_validate will only pick declared fields).
    facturas_con_estado = [
        FacturaConEstado(
            f,
            estado_map.get(f.id, EstadoFactura.PENDIENTE),
            items=[],            # not part of the cuenta-corriente view
            items_sum_mismatch=False,
        )
        for f in facturas
    ]

    # 6. Chronological merge for RN-HIST
    historial = _build_historial(facturas, pagos)

    return _CuentaCorrienteResult(
        proveedor_id=proveedor.id,
        saldo=saldo,
        facturas_con_estado=facturas_con_estado,
        historial=historial,
    )


# Bind the impl onto the class so the public API is `ProveedorService`.
ProveedorService.get_cuenta_corriente = _get_cuenta_corriente_impl


__all__ = ["ProveedorService", "_build_historial"]
