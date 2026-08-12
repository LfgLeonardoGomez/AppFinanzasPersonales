"""
ClienteService — customer identity and its one hard rule (C-32).

All authorization lives here: everything is scoped by `negocio_id`, and a
customer of another negocio is 404, never 403 (D-06).

The rule this service exists to protect: **two equivalent names cannot coexist
in one negocio**. It is enforced twice, on purpose.

- A lookup before inserting, so the 409 can name the existing customer. The
  employee is standing at the counter; "already exists" without saying *which*
  one leaves them stuck.
- The partial unique index in the database, which is what makes the rule
  actually true. Between the lookup and the insert there is a window, and two
  employees loading the same customer at once will find it. The IntegrityError
  is caught and translated to the same 409, so the loser of that race gets an
  explanation rather than a 500.

The check exists for the message; the index exists for the guarantee.
"""

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional, Sequence

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core.normalizacion import normalizar_nombre
from app.models.cliente import Cliente
from app.repositories.cliente_repository import ClienteRepository

_CLIENTE_NO_ENCONTRADO = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Cliente not found",
)


def _conflicto(existente: Optional[Cliente]) -> HTTPException:
    """409 carrying the existing customer, so the caller can offer it.

    Without the id there is nothing the UI can do but show an error; with it,
    it can say "¿quisiste decir este?" and let the employee pick.
    """
    detalle: dict = {"mensaje": "Ya existe un cliente con ese nombre en este negocio."}
    if existente is not None:
        detalle["cliente_existente"] = {
            "id": str(existente.id),
            "nombre": existente.nombre,
        }
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detalle)


class ClienteConSaldo:
    """
    Combines a Cliente ORM entity with its on-demand balance (C-35, D6).

    Delegates attribute access to the underlying Cliente entity so it can be
    used with `ClienteResponse.model_validate(obj)`, mirroring
    ProveedorConSaldoResponse on the supplier side.
    """

    def __init__(self, cliente: Cliente, saldo: Decimal) -> None:
        self._cliente = cliente
        self.saldo = saldo

    def __getattr__(self, name: str) -> Any:
        return getattr(self._cliente, name)


class ClienteService:
    """Customer CRUD and search, scoped to one negocio."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repo = ClienteRepository(session)

    # ── helpers ───────────────────────────────────────────────────────────────

    def _get_propio(self, negocio_id: uuid.UUID, cliente_id: uuid.UUID) -> Cliente:
        cliente = self._repo.get(negocio_id, cliente_id)
        if cliente is None:
            raise _CLIENTE_NO_ENCONTRADO
        return cliente

    # ── lectura ───────────────────────────────────────────────────────────────

    def listar(self, negocio_id: uuid.UUID) -> Sequence["ClienteConSaldo"]:
        """
        Every active customer of the negocio, each carrying its on-demand
        balance (C-35, D6) obtained via a single aggregate query — never one
        query per customer.
        """
        clientes = self._repo.listar(negocio_id)
        saldos = self._repo.get_saldo_por_cliente(negocio_id)
        return [
            ClienteConSaldo(
                c, saldos.get(c.id, Decimal("0.00")).quantize(Decimal("0.01"))
            )
            for c in clientes
        ]

    def buscar(self, negocio_id: uuid.UUID, texto: str) -> Sequence[Cliente]:
        """Autocomplete. The query is normalized with the same rule as the alta.

        Using a different rule here would show the employee that nothing
        matches, and then reject their alta as a duplicate.
        """
        return self._repo.buscar(negocio_id, normalizar_nombre(texto))

    def get(self, negocio_id: uuid.UUID, cliente_id: uuid.UUID) -> Cliente:
        return self._get_propio(negocio_id, cliente_id)

    # ── escritura ─────────────────────────────────────────────────────────────

    def crear(
        self,
        negocio_id: uuid.UUID,
        nombre: str,
        telefono: Optional[str] = None,
        notas: Optional[str] = None,
        creado_por_usuario_id: Optional[uuid.UUID] = None,
    ) -> Cliente:
        """Create a customer. `nombre` is the only thing required."""
        normalizado = normalizar_nombre(nombre)

        existente = self._repo.get_by_nombre_normalizado(negocio_id, normalizado)
        if existente is not None:
            raise _conflicto(existente)

        try:
            return self._repo.create(
                negocio_id=negocio_id,
                creado_por_usuario_id=creado_por_usuario_id,
                nombre=nombre.strip(),
                nombre_normalizado=normalizado,
                telefono=telefono,
                notas=notas,
            )
        except IntegrityError:
            # Lost the race against a concurrent alta. Roll back so the session
            # is usable, then answer like any other duplicate.
            self._session.rollback()
            raise _conflicto(
                self._repo.get_by_nombre_normalizado(negocio_id, normalizado)
            )

    def actualizar(
        self,
        negocio_id: uuid.UUID,
        cliente_id: uuid.UUID,
        nombre: Optional[str] = None,
        telefono: Optional[str] = None,
        notas: Optional[str] = None,
    ) -> Cliente:
        """
        Partial update. Renaming recomputes the normalized form, so a rename
        into an existing name is rejected exactly like a duplicate alta.
        """
        cliente = self._get_propio(negocio_id, cliente_id)

        if nombre is not None:
            normalizado = normalizar_nombre(nombre)
            existente = self._repo.get_by_nombre_normalizado(negocio_id, normalizado)
            if existente is not None and existente.id != cliente.id:
                raise _conflicto(existente)
            cliente.nombre = nombre.strip()
            cliente.nombre_normalizado = normalizado

        if telefono is not None:
            cliente.telefono = telefono
        if notas is not None:
            cliente.notas = notas

        self._session.add(cliente)
        try:
            self._session.flush()
        except IntegrityError:
            self._session.rollback()
            raise _conflicto(None)

        return cliente

    def eliminar(self, negocio_id: uuid.UUID, cliente_id: uuid.UUID) -> Cliente:
        """
        Soft delete. Releases the name: the partial unique index only covers
        active rows, so the shop can re-add someone it had removed.
        """
        cliente = self._get_propio(negocio_id, cliente_id)
        cliente.deleted_at = datetime.now(timezone.utc)
        self._session.add(cliente)
        self._session.flush()
        return cliente


__all__ = ["ClienteService"]


# ── C-35 — Cuenta corriente composition ─────────────────────────────────────
#
# Mirrors ProveedorService.get_cuenta_corriente (C-12) exactly, mapped onto
# the customer ledger's own vocabulary (D2): the shared engine returns
# allocated amounts, this module maps them to EstadoVentaFiada, never
# EstadoFactura.


class VentaConEstado:
    """
    Combines a Venta (fiado) ORM entity with its FIFO-computed estado.

    Delegates attribute access to the underlying Venta so it can be used
    with a schema's `model_validate(obj)`.
    """

    def __init__(self, venta, estado) -> None:
        self._venta = venta
        self.estado = estado

    def __getattr__(self, name: str) -> Any:
        return getattr(self._venta, name)


class _CuentaCorrienteClienteResult:
    """
    Service-layer container for the on-demand cuenta-corriente triple of one
    customer (RN-CCC-01, RN-CCC-02, RN-CCC-05).

    `saldo` may be NEGATIVE (D4) — the read path reports the real figure
    rather than clamping it at zero.
    """

    def __init__(
        self,
        cliente_id: uuid.UUID,
        saldo: Decimal,
        ventas_con_estado: list,
        historial: list[dict],
    ) -> None:
        self.cliente_id = cliente_id
        self.saldo = saldo
        self.ventas_con_estado = ventas_con_estado
        self.historial = historial


def _get_cuenta_corriente_impl(
    self,
    negocio_id: uuid.UUID,
    cliente_id: uuid.UUID,
) -> _CuentaCorrienteClienteResult:
    """
    Build the on-demand cuenta-corriente triple for one customer (C-35).

    Steps (design.md D1-D5):
    1. Ownership check (404 on foreign/missing/deleted, D-06).
    2. Live fiados (VentaRepository.listar_fiadas_de_cliente — already
       oldest-first) and live payments (CobroClienteRepository.listar_de_cliente).
    3. saldo = SUM(fiados activos) - SUM(cobros activos) (RN-CCC-01), signed,
       reported honestly even if negative (D4) — NOT derived from the FIFO
       leftover, because a fiado can be deleted after being paid off, which
       the FIFO pool alone would not reveal as debt.
    4. FIFO allocation via the shared `asignar_fifo` (C-35, D1) — pool is
       the sum of live payments, allocated oldest-fiado-first.
    5. Map allocated amounts to EstadoVentaFiada (D2): never PAGADA — that
       word belongs to the supplier ledger.
    6. Chronological historial via the shared `construir_historial`, with
       tipo_cargo="VENTA", tipo_abono="COBRO" (RN-CCC-05). A VENTA row has
       no attachment today, so archivo_url is always None on that side.

    Read-only: no session.commit() issued here.
    """
    from decimal import Decimal as _Decimal

    from app.repositories.cobro_cliente_repository import CobroClienteRepository
    from app.repositories.venta_repository import VentaRepository
    from app.models.enums import EstadoVentaFiada
    from app.services.cuenta_corriente_engine import Movimiento, asignar_fifo, construir_historial

    cliente = self._get_propio(negocio_id, cliente_id)

    venta_repo = VentaRepository(self._session)
    cobro_repo = CobroClienteRepository(self._session)

    # 1. Live fiados and live payments (already deterministically ordered).
    fiados = venta_repo.listar_fiadas_de_cliente(negocio_id, cliente.id)
    cobros = cobro_repo.listar_de_cliente(negocio_id, cliente.id)

    # 2. saldo = SUM(fiados activos) - SUM(cobros activos) (RN-CCC-01, D4).
    # Quantized to 2 decimals so the wire format is always "0.00", never "0"
    # (numeric(12,2) convention — mirrors ProveedorService._get_saldo_for).
    total_fiados = sum((v.monto for v in fiados), _Decimal("0"))
    total_cobros = sum((c.monto for c in cobros), _Decimal("0"))
    saldo = (total_fiados - total_cobros).quantize(_Decimal("0.01"))

    # 3. FIFO allocation — the shared engine (C-35, D1).
    movimientos_fiados = [
        Movimiento(id=v.id, fecha=v.fecha, created_at=v.created_at, monto=v.monto)
        for v in fiados
    ]
    aplicado_por_id = asignar_fifo(movimientos_fiados, total_cobros)

    ventas_con_estado = []
    for v in fiados:
        aplicado = aplicado_por_id[v.id]
        if aplicado <= _Decimal("0"):
            estado = EstadoVentaFiada.PENDIENTE
        elif aplicado >= v.monto:
            estado = EstadoVentaFiada.COBRADA
        else:
            estado = EstadoVentaFiada.PARCIAL
        ventas_con_estado.append(VentaConEstado(v, estado))

    # 4. Chronological merge for RN-CCC-05.
    movimientos_cobros = [
        Movimiento(id=c.id, fecha=c.fecha, created_at=c.created_at, monto=c.monto, archivo_url=c.comprobante_url)
        for c in cobros
    ]
    historial = construir_historial(
        movimientos_fiados, movimientos_cobros, tipo_cargo="VENTA", tipo_abono="COBRO"
    )

    return _CuentaCorrienteClienteResult(
        cliente_id=cliente.id,
        saldo=saldo,
        ventas_con_estado=ventas_con_estado,
        historial=historial,
    )


# Bind the impl onto the class so the public API is `ClienteService`.
ClienteService.get_cuenta_corriente = _get_cuenta_corriente_impl
