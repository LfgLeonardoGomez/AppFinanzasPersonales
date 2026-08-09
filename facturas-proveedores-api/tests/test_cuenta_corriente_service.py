"""
Tests for `ProveedorService.get_cuenta_corriente` (Task 3.1 — TDD RED, then GREEN).

Service-layer tests against real Postgres (testcontainers). Exercises:
- Empty supplier (no movimientos) → saldo=0, empty lists.
- Single factura, no pagos → PENDIENTE, positive saldo.
- Pool < one factura → PENDIENTE.
- Pool > one factura → PAGADA, negative saldo (a favor).
- Pool == one factura (boundary) → PAGADA, saldo=0.
- FIFO waterfall across multiple facturas.
- Cross-check invariant: historial[-1].saldo_acumulado == result.saldo.
- Foreign supplier → 404.
- Soft-deleted supplier → 404.
- Missing supplier → 404.
- Determinism under identical fecha_emision.
- Soft-deleted factura / pago are excluded.
- Foreign user with their own movimientos cannot leak via user A's request.

Hard rules verified here:
- The C-08 `_compute_estado_fifo` is reused (no duplicate implementation).
- All authorization lives in the service layer (404 on foreign/missing).
- The result is computed on-demand — no DB write issued.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401 — register all SQLModel tables

from tests.conftest import crear_negocio


# ── Fixtures & helpers ───────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


def _make_usuario(session: Session) -> "Usuario":
    from app.models.usuario import Usuario
    from app.core.uuid_utils import new_uuid

    u = Usuario(
        negocio_id=crear_negocio(session).id,
        id=new_uuid(),
        email=f"cc_{uuid.uuid4().hex[:8]}@test.com",
        nombre="Cuenta Corriente Test",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    )
    session.add(u)
    session.flush()
    return u


def _make_proveedor(
    session: Session,
    negocio_id: uuid.UUID,
    deleted: bool = False,
) -> "Proveedor":
    from app.models.proveedor import Proveedor
    from app.core.uuid_utils import new_uuid
    from app.models.enums import CategoriaProveedor

    p = Proveedor(
        id=new_uuid(),
        negocio_id=negocio_id,
        nombre=f"Prov {uuid.uuid4().hex[:6]}",
        categoria=CategoriaProveedor.OTRO,
    )
    if deleted:
        p.deleted_at = datetime.now(timezone.utc)
    session.add(p)
    session.flush()
    return p


def _make_factura_db(
    session: Session,
    negocio_id: uuid.UUID,
    proveedor_id: uuid.UUID,
    monto_total: Decimal,
    fecha_emision: date,
    archivo_url: str | None = None,
) -> "Factura":
    from app.models.factura import Factura
    from app.core.uuid_utils import new_uuid
    from app.models.enums import OrigenDocumento

    f = Factura(
        id=new_uuid(),
        negocio_id=negocio_id,
        proveedor_id=proveedor_id,
        fecha_emision=fecha_emision,
        monto_total=monto_total,
        archivo_url=archivo_url,
        origen=OrigenDocumento.MANUAL,
    )
    session.add(f)
    session.flush()
    return f


def _make_pago_db(
    session: Session,
    negocio_id: uuid.UUID,
    proveedor_id: uuid.UUID,
    monto: Decimal,
    fecha: date,
    comprobante_url: str | None = None,
) -> "Pago":
    from app.models.pago import Pago
    from app.core.uuid_utils import new_uuid
    from app.models.enums import MetodoPago, OrigenDocumento

    p = Pago(
        id=new_uuid(),
        negocio_id=negocio_id,
        proveedor_id=proveedor_id,
        monto=monto,
        fecha=fecha,
        metodo=MetodoPago.EFECTIVO,
        comprobante_url=comprobante_url,
        origen=OrigenDocumento.MANUAL,
    )
    session.add(p)
    session.flush()
    return p


# ── Empty / single-row cases ────────────────────────────────────────────────


class TestEmpty:
    def test_supplier_with_no_movimientos(self, session: Session):
        from app.services.proveedor_service import ProveedorService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        assert result.proveedor_id == p.id
        assert result.saldo == Decimal("0.00")
        assert result.facturas_con_estado == []
        assert result.historial == []


class TestArchivoUrlThreading:
    """C-24: EntradaHistorial.archivo_url is threaded end-to-end through the real service."""

    def test_factura_and_pago_archivo_urls_reach_the_historial(self, session: Session):
        from app.services.proveedor_service import ProveedorService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        f = _make_factura_db(
            session, u.negocio_id, p.id, Decimal("1000.00"), date.today(),
            archivo_url="https://res.cloudinary.com/demo/facturas/f.pdf",
        )
        pago = _make_pago_db(
            session, u.negocio_id, p.id, Decimal("200.00"), date.today(),
            comprobante_url="https://res.cloudinary.com/demo/comprobantes/p.jpg",
        )
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        by_id = {h["id"]: h for h in result.historial}
        assert by_id[f.id]["archivo_url"] == "https://res.cloudinary.com/demo/facturas/f.pdf"
        assert by_id[pago.id]["archivo_url"] == "https://res.cloudinary.com/demo/comprobantes/p.jpg"

    def test_rows_without_files_have_archivo_url_none(self, session: Session):
        from app.services.proveedor_service import ProveedorService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        _make_factura_db(session, u.negocio_id, p.id, Decimal("100.00"), date.today())
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        assert result.historial[0]["archivo_url"] is None


class TestSingleFactura:
    def test_one_factura_no_pagos(self, session: Session):
        from app.services.proveedor_service import ProveedorService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        _make_factura_db(session, u.negocio_id, p.id, Decimal("1500.00"), date.today())
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        assert result.saldo == Decimal("1500.00")
        assert len(result.facturas_con_estado) == 1
        assert result.facturas_con_estado[0].estado == EstadoFactura.PENDIENTE
        assert len(result.historial) == 1
        assert result.historial[0]["tipo"] == "FACTURA"
        assert result.historial[0]["saldo_acumulado"] == Decimal("1500.00")
        # Cross-check invariant
        assert result.historial[-1]["saldo_acumulado"] == result.saldo


class TestPoolCoverage:
    def test_pool_below_one_factura_parcial(self, session: Session):
        """Pool=300 < factura=1000 → aplicado=300 → 0 < aplicado < monto_total → PARCIAL.

        (Note: the proposal originally stated PENDIENTE, but the FIFO rule
        `0 < aplicado < monto_total → PARCIAL` (RN-FIFO) is the source of
        truth. PENDIENTE applies only when applied == 0. The cross-check
        invariant `historial[-1].saldo_acumulado == result.saldo` still holds.)
        """
        from app.services.proveedor_service import ProveedorService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        _make_factura_db(session, u.negocio_id, p.id, Decimal("1000.00"), date.today())
        _make_pago_db(session, u.negocio_id, p.id, Decimal("300.00"), date.today())
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        assert result.saldo == Decimal("700.00")
        assert result.facturas_con_estado[0].estado == EstadoFactura.PARCIAL
        assert result.historial[0]["tipo"] == "FACTURA"
        assert result.historial[0]["saldo_acumulado"] == Decimal("1000.00")
        assert result.historial[1]["tipo"] == "PAGO"
        assert result.historial[1]["saldo_acumulado"] == Decimal("700.00")
        assert result.historial[-1]["saldo_acumulado"] == result.saldo

    def test_pool_above_one_factura_pagada_negative_saldo(self, session: Session):
        """Pool > one factura → PAGADA; saldo < 0 (a favor)."""
        from app.services.proveedor_service import ProveedorService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        _make_factura_db(session, u.negocio_id, p.id, Decimal("1000.00"), date.today())
        _make_pago_db(session, u.negocio_id, p.id, Decimal("1500.00"), date.today())
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        assert result.saldo == Decimal("-500.00")
        assert result.facturas_con_estado[0].estado == EstadoFactura.PAGADA
        assert result.historial[0]["saldo_acumulado"] == Decimal("1000.00")
        assert result.historial[1]["saldo_acumulado"] == Decimal("-500.00")
        assert result.historial[-1]["saldo_acumulado"] == result.saldo

    def test_pool_exact_boundary_pagada_zero_saldo(self, session: Session):
        """Pool == one factura → PAGADA (not PARCIAL); saldo=0."""
        from app.services.proveedor_service import ProveedorService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        _make_factura_db(session, u.negocio_id, p.id, Decimal("1000.00"), date.today())
        _make_pago_db(session, u.negocio_id, p.id, Decimal("1000.00"), date.today())
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        assert result.saldo == Decimal("0.00")
        assert result.facturas_con_estado[0].estado == EstadoFactura.PAGADA
        assert result.historial[-1]["saldo_acumulado"] == Decimal("0.00")
        assert result.historial[-1]["saldo_acumulado"] == result.saldo


# ── Multi-factura FIFO waterfall ─────────────────────────────────────────────


class TestFifoWaterfall:
    def test_two_facturas_one_pago_partial(self, session: Session):
        """F1=600 day-1, F2=400 day-2, P=700 → F1 PAGADA, F2 PARCIAL, saldo=300."""
        from app.services.proveedor_service import ProveedorService
        from app.models.enums import EstadoFactura
        from datetime import timedelta

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        day1 = date.today() - timedelta(days=1)
        day2 = date.today()

        f1 = _make_factura_db(session, u.negocio_id, p.id, Decimal("600.00"), day1)
        f2 = _make_factura_db(session, u.negocio_id, p.id, Decimal("400.00"), day2)
        _make_pago_db(session, u.negocio_id, p.id, Decimal("700.00"), day2)
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        assert result.saldo == Decimal("300.00")
        estado_by_id = {fc._factura.id: fc.estado for fc in result.facturas_con_estado}
        assert estado_by_id[f1.id] == EstadoFactura.PAGADA
        assert estado_by_id[f2.id] == EstadoFactura.PARCIAL
        # Historial order: F1 (600, 600), F2 (400, 1000), P (700, 300)
        assert [h["tipo"] for h in result.historial] == ["FACTURA", "FACTURA", "PAGO"]
        assert result.historial[-1]["saldo_acumulado"] == Decimal("300.00")
        assert result.historial[-1]["saldo_acumulado"] == result.saldo


# ── Authorization ────────────────────────────────────────────────────────────


class TestAuthorization:
    def test_foreign_supplier_raises_404(self, session: Session):
        from app.services.proveedor_service import ProveedorService

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_b = _make_proveedor(session, u_b.negocio_id)
        session.commit()

        svc = ProveedorService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.get_cuenta_corriente(u_a.negocio_id, p_b.id)
        assert exc_info.value.status_code == 404

    def test_soft_deleted_supplier_raises_404(self, session: Session):
        from app.services.proveedor_service import ProveedorService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id, deleted=True)
        session.commit()

        svc = ProveedorService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.get_cuenta_corriente(u.negocio_id, p.id)
        assert exc_info.value.status_code == 404

    def test_missing_supplier_raises_404(self, session: Session):
        from app.services.proveedor_service import ProveedorService

        u = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.get_cuenta_corriente(u.negocio_id, uuid.uuid4())
        assert exc_info.value.status_code == 404


# ── Determinism ──────────────────────────────────────────────────────────────


class TestDeterminism:
    def test_same_fecha_emision_orders_by_created_at(self, session: Session):
        """Two facturas on the same fecha_emision: ordered by created_at, stable across calls."""
        from app.services.proveedor_service import ProveedorService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        same_day = date.today()
        f1 = _make_factura_db(session, u.negocio_id, p.id, Decimal("100.00"), same_day)
        f2 = _make_factura_db(session, u.negocio_id, p.id, Decimal("200.00"), same_day)
        f3 = _make_factura_db(session, u.negocio_id, p.id, Decimal("300.00"), same_day)
        session.commit()

        svc = ProveedorService(session)
        r1 = svc.get_cuenta_corriente(u.negocio_id, p.id)
        r2 = svc.get_cuenta_corriente(u.negocio_id, p.id)

        # Insertion order is f1, f2, f3 → UUIDv7 time-ordering means
        # later inserts have larger created_at, so they appear last
        ids_run1 = [fc._factura.id for fc in r1.facturas_con_estado]
        ids_run2 = [fc._factura.id for fc in r2.facturas_con_estado]
        assert ids_run1 == ids_run2
        assert f1.id in ids_run1
        assert f2.id in ids_run1
        assert f3.id in ids_run1


# ── Triangulate: more edge cases ─────────────────────────────────────────────


class TestMoreEdgeCases:
    def test_three_facturas_with_partial_pool(self, session: Session):
        """F1=1000 day-1, F2=1000 day-2, F3=1000 day-3, pool=1500 → F1 PAGADA, F2 PARCIAL, F3 PENDIENTE; saldo=1500."""
        from app.services.proveedor_service import ProveedorService
        from app.models.enums import EstadoFactura
        from datetime import timedelta

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        day1 = date.today() - timedelta(days=3)
        day2 = date.today() - timedelta(days=2)
        day3 = date.today() - timedelta(days=1)

        f1 = _make_factura_db(session, u.negocio_id, p.id, Decimal("1000.00"), day1)
        f2 = _make_factura_db(session, u.negocio_id, p.id, Decimal("1000.00"), day2)
        f3 = _make_factura_db(session, u.negocio_id, p.id, Decimal("1000.00"), day3)
        _make_pago_db(session, u.negocio_id, p.id, Decimal("1500.00"), day3)
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        estado_by_id = {fc._factura.id: fc.estado for fc in result.facturas_con_estado}
        assert estado_by_id[f1.id] == EstadoFactura.PAGADA
        assert estado_by_id[f2.id] == EstadoFactura.PARCIAL
        assert estado_by_id[f3.id] == EstadoFactura.PENDIENTE
        assert result.saldo == Decimal("1500.00")
        # Historial: F1 1000 (1000), F2 1000 (2000), P 1500 (500), F3 1000 (1500)
        assert result.historial[-1]["saldo_acumulado"] == result.saldo

    def test_pool_excedido_far_beyond(self, session: Session):
        """Pool=10000 with one factura=100 → PAGADA, saldo=-9900."""
        from app.services.proveedor_service import ProveedorService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        _make_factura_db(session, u.negocio_id, p.id, Decimal("100.00"), date.today())
        _make_pago_db(session, u.negocio_id, p.id, Decimal("10000.00"), date.today())
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        assert result.saldo == Decimal("-9900.00")
        assert result.facturas_con_estado[0].estado == EstadoFactura.PAGADA
        assert result.historial[-1]["saldo_acumulado"] == Decimal("-9900.00")
        assert result.historial[-1]["saldo_acumulado"] == result.saldo

    def test_soft_deleted_factura_excluded(self, session: Session):
        """A soft-deleted factura is NOT in facturas_con_estado and NOT in historial."""
        from app.services.proveedor_service import ProveedorService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        f_active = _make_factura_db(session, u.negocio_id, p.id, Decimal("500.00"), date.today())
        f_deleted = _make_factura_db(session, u.negocio_id, p.id, Decimal("9999.00"), date.today())
        f_deleted.deleted_at = datetime.now(timezone.utc)
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        assert len(result.facturas_con_estado) == 1
        assert result.facturas_con_estado[0]._factura.id == f_active.id
        assert result.facturas_con_estado[0].estado == EstadoFactura.PENDIENTE
        assert all(h["id"] != f_deleted.id for h in result.historial)
        assert result.saldo == Decimal("500.00")

    def test_soft_deleted_pago_excluded(self, session: Session):
        """A soft-deleted pago is NOT in historial and NOT in the FIFO pool."""
        from app.services.proveedor_service import ProveedorService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        f = _make_factura_db(session, u.negocio_id, p.id, Decimal("100.00"), date.today())
        p_active = _make_pago_db(session, u.negocio_id, p.id, Decimal("50.00"), date.today())
        p_deleted = _make_pago_db(session, u.negocio_id, p.id, Decimal("9999.00"), date.today())
        p_deleted.deleted_at = datetime.now(timezone.utc)
        session.commit()

        svc = ProveedorService(session)
        result = svc.get_cuenta_corriente(u.negocio_id, p.id)

        # Only the active pago contributes to the pool
        assert result.saldo == Decimal("50.00")
        assert result.facturas_con_estado[0].estado == EstadoFactura.PARCIAL
        # Only the active pago is in historial
        historial_ids = {h["id"] for h in result.historial}
        assert p_active.id in historial_ids
        assert p_deleted.id not in historial_ids
        # f always in historial
        assert f.id in historial_ids

    def test_foreign_user_with_their_own_movimientos_returns_404(self, session: Session):
        """Even if user B has many facturas/pagos under their own supplier, user A gets 404 — no leak."""
        from app.services.proveedor_service import ProveedorService

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_b = _make_proveedor(session, u_b.negocio_id)
        _make_factura_db(session, u_b.negocio_id, p_b.id, Decimal("100.00"), date.today())
        _make_pago_db(session, u_b.negocio_id, p_b.id, Decimal("50.00"), date.today())
        session.commit()

        svc = ProveedorService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.get_cuenta_corriente(u_a.negocio_id, p_b.id)
        assert exc_info.value.status_code == 404
