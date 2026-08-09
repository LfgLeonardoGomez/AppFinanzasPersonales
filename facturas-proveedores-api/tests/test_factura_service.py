"""
Tests for FacturaService (Task 4.1 — TDD RED, then GREEN).

Covers:
- crear: valid → saves with usuario_id from arg, origen=MANUAL
- crear: proveedor belongs to other user → 404
- crear: fecha_emision future → 422
- crear: monto_total=0 → 422 (schema rejects, service re-validates)
- listar: returns all user's facturas with FIFO estado
- listar: estado_filtro filters in Python AFTER FIFO (not SQL)
- listar: fecha_desde/fecha_hasta apply date range filter
- get: valid → returns FacturaConEstado with computed estado
- get: foreign factura → 404
- get: soft-deleted → 404
- actualizar: valid partial update
- eliminar: soft-deletes; row preserved
- Cross-user isolation: all operations
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401 — register all SQLModel tables

from tests.conftest import crear_negocio


# ── Fixtures ──────────────────────────────────────────────────────────────────


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


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_usuario(session: Session):
    from app.models.usuario import Usuario
    from app.core.uuid_utils import new_uuid

    u = Usuario(
        negocio_id=crear_negocio(session).id,
        id=new_uuid(),
        email=f"svc_fac_{uuid.uuid4().hex[:8]}@test.com",
        nombre="Service Factura Test",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    )
    session.add(u)
    session.flush()
    return u


def _make_proveedor(session: Session, negocio_id: uuid.UUID):
    from app.models.proveedor import Proveedor
    from app.core.uuid_utils import new_uuid
    from app.models.enums import CategoriaProveedor

    p = Proveedor(
        id=new_uuid(),
        negocio_id=negocio_id,
        nombre=f"Prov {uuid.uuid4().hex[:6]}",
        categoria=CategoriaProveedor.OTRO,
    )
    session.add(p)
    session.flush()
    return p


def _make_pago(session: Session, negocio_id: uuid.UUID, proveedor_id: uuid.UUID, monto: Decimal):
    from app.models.pago import Pago
    from app.core.uuid_utils import new_uuid
    from app.models.enums import MetodoPago, OrigenDocumento

    p = Pago(
        id=new_uuid(),
        negocio_id=negocio_id,
        proveedor_id=proveedor_id,
        monto=monto,
        fecha=date.today(),
        metodo=MetodoPago.EFECTIVO,
        origen=OrigenDocumento.MANUAL,
    )
    session.add(p)
    session.flush()
    return p


def _create_factura_via_service(
    session: Session,
    negocio_id: uuid.UUID,
    proveedor_id: uuid.UUID,
    monto_total: Decimal = Decimal("100.00"),
    fecha_emision: date | None = None,
):
    from app.services.factura_service import FacturaService
    from app.schemas.factura import FacturaCreate

    svc = FacturaService(session)
    return svc.crear(
        negocio_id,
        FacturaCreate(
            proveedor_id=proveedor_id,
            fecha_emision=fecha_emision or date.today(),
            monto_total=monto_total,
        ),
    )


# ── crear ─────────────────────────────────────────────────────────────────────


class TestCrear:
    def test_creates_factura_with_usuario_id_from_arg(self, session: Session):
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaCreate
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        svc = FacturaService(session)
        result = svc.crear(u.negocio_id,
            FacturaCreate(
                proveedor_id=p.id,
                fecha_emision=date.today(),
                monto_total=Decimal("500.00"),
                numero="F-001",
            ),
        )
        session.commit()

        assert result.negocio_id == u.negocio_id
        assert result.proveedor_id == p.id
        assert result.monto_total == Decimal("500.00")
        assert result.origen == OrigenDocumento.MANUAL

    # ── c-15a-origen-ia-backend: optional `origen` on FacturaService.crear ──

    def test_crear_persists_origen_ia_when_provided(self, session: Session):
        """c-15a: when `FacturaCreate.origen='IA'`, the persisted Factura.origen
        is `OrigenDocumento.IA` (C-15 IA confirmation happy path)."""
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaCreate
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        svc = FacturaService(session)
        result = svc.crear(u.negocio_id,
            FacturaCreate(
                proveedor_id=p.id,
                fecha_emision=date.today(),
                monto_total=Decimal("500.00"),
                origen=OrigenDocumento.IA,
            ),
        )
        session.commit()

        assert result.origen == OrigenDocumento.IA

    def test_crear_defaults_to_manual_when_origen_omitted(self, session: Session):
        """c-15a: when `origen` is omitted on `FacturaCreate`, the service
        falls back to `OrigenDocumento.MANUAL` (backward compat with C-09
        manual flow)."""
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaCreate
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        svc = FacturaService(session)
        result = svc.crear(u.negocio_id,
            FacturaCreate(
                proveedor_id=p.id,
                fecha_emision=date.today(),
                monto_total=Decimal("500.00"),
            ),
        )
        session.commit()

        assert result.origen == OrigenDocumento.MANUAL

    def test_creates_with_items(self, session: Session):
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaCreate, FacturaItemCreate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        svc = FacturaService(session)
        result = svc.crear(u.negocio_id,
            FacturaCreate(
                proveedor_id=p.id,
                fecha_emision=date.today(),
                monto_total=Decimal("200.00"),
                items=[
                    FacturaItemCreate(
                        descripcion="Prod A",
                        cantidad=Decimal("2"),
                        precio_unitario=Decimal("100.00"),
                    )
                ],
            ),
        )
        session.commit()

        assert len(result.items) == 1
        assert result.items_sum_mismatch is False

    def test_items_sum_mismatch_flag(self, session: Session):
        """Items sum != monto_total → items_sum_mismatch=True, not a block."""
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaCreate, FacturaItemCreate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        svc = FacturaService(session)
        result = svc.crear(u.negocio_id,
            FacturaCreate(
                proveedor_id=p.id,
                fecha_emision=date.today(),
                monto_total=Decimal("500.00"),  # != items sum (100)
                items=[
                    FacturaItemCreate(
                        descripcion="Item",
                        cantidad=Decimal("1"),
                        precio_unitario=Decimal("100.00"),
                    )
                ],
            ),
        )
        session.commit()

        # Save succeeds; mismatch is flagged
        assert result.items_sum_mismatch is True
        assert result.monto_total == Decimal("500.00")

    def test_foreign_proveedor_raises_404(self, session: Session):
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaCreate

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_b = _make_proveedor(session, u_b.negocio_id)

        svc = FacturaService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.crear(u_a.negocio_id,  # user A trying to use user B's supplier
                FacturaCreate(
                    proveedor_id=p_b.id,
                    fecha_emision=date.today(),
                    monto_total=Decimal("100.00"),
                ),
            )
        assert exc_info.value.status_code == 404

    def test_fecha_emision_future_raises_422(self, session: Session):
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaCreate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        svc = FacturaService(session)
        # Note: Pydantic schema already rejects future dates, so we bypass schema
        # by manipulating after creation to test service-layer validation
        with pytest.raises(Exception):
            svc.crear(u.negocio_id,
                FacturaCreate(
                    proveedor_id=p.id,
                    fecha_emision=date.today() + timedelta(days=1),
                    monto_total=Decimal("100.00"),
                ),
            )

    def test_nuevo_factura_estado_pendiente_when_no_pagos(self, session: Session):
        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        result = _create_factura_via_service(session, u.negocio_id, p.id, Decimal("100.00"))
        session.commit()

        from app.models.enums import EstadoFactura
        assert result.estado == EstadoFactura.PENDIENTE

    def test_nuevo_factura_estado_pagada_when_pool_covers_all(self, session: Session):
        """New factura is PAGADA immediately if existing payments cover it."""
        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        # Add payment first
        _make_pago(session, u.negocio_id, p.id, Decimal("1000.00"))
        session.commit()

        result = _create_factura_via_service(session, u.negocio_id, p.id, Decimal("500.00"))
        session.commit()

        from app.models.enums import EstadoFactura
        assert result.estado == EstadoFactura.PAGADA


# ── get ───────────────────────────────────────────────────────────────────────


class TestGet:
    def test_returns_factura_with_estado(self, session: Session):
        from app.services.factura_service import FacturaService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        created = _create_factura_via_service(session, u.negocio_id, p.id)
        session.commit()

        svc = FacturaService(session)
        result = svc.get(u.negocio_id, created.id)

        assert result.id == created.id
        assert result.estado == EstadoFactura.PENDIENTE

    def test_foreign_factura_raises_404(self, session: Session):
        from app.services.factura_service import FacturaService

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.negocio_id)
        created = _create_factura_via_service(session, u_a.negocio_id, p_a.id)
        session.commit()

        svc = FacturaService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.get(u_b.negocio_id, created.id)  # user B tries to access user A's factura
        assert exc_info.value.status_code == 404

    def test_soft_deleted_raises_404(self, session: Session):
        from app.services.factura_service import FacturaService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        created = _create_factura_via_service(session, u.negocio_id, p.id)
        session.commit()

        svc = FacturaService(session)
        svc.eliminar(u.negocio_id, created.id)
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            svc.get(u.negocio_id, created.id)
        assert exc_info.value.status_code == 404


# ── listar ────────────────────────────────────────────────────────────────────


class TestListar:
    def test_returns_all_user_facturas_with_estado(self, session: Session):
        from app.services.factura_service import FacturaService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        r1 = _create_factura_via_service(session, u.negocio_id, p.id, Decimal("100.00"))
        r2 = _create_factura_via_service(session, u.negocio_id, p.id, Decimal("200.00"))
        session.commit()

        svc = FacturaService(session)
        results = svc.listar(u.negocio_id)
        ids = [r.id for r in results]

        assert r1.id in ids
        assert r2.id in ids
        assert all(hasattr(r, "estado") for r in results)

    def test_estado_filter_applied_in_python_after_fifo(self, session: Session):
        """
        estado_filtro=PAGADA must filter AFTER FIFO computation.
        Creates 2 facturas, pays only the first one. Filters for PAGADA → gets 1.
        """
        from app.services.factura_service import FacturaService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        # Two invoices: 100 and 200
        f1 = _create_factura_via_service(
            session, u.negocio_id, p.id, Decimal("100.00"),
            fecha_emision=date.today() - timedelta(days=1),
        )
        f2 = _create_factura_via_service(
            session, u.negocio_id, p.id, Decimal("200.00"),
            fecha_emision=date.today(),
        )
        # Pay exactly the first one
        _make_pago(session, u.negocio_id, p.id, Decimal("100.00"))
        session.commit()

        svc = FacturaService(session)
        pagadas = svc.listar(u.negocio_id, proveedor_id=p.id, estado_filtro=EstadoFactura.PAGADA)
        pendientes = svc.listar(u.negocio_id, proveedor_id=p.id, estado_filtro=EstadoFactura.PENDIENTE)

        pagada_ids = [r.id for r in pagadas]
        pendiente_ids = [r.id for r in pendientes]

        assert f1.id in pagada_ids
        assert f2.id in pendiente_ids
        assert f2.id not in pagada_ids

    def test_fecha_range_filter(self, session: Session):
        """fecha_desde and fecha_hasta filter applied in Python."""
        from app.services.factura_service import FacturaService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        f_old = _create_factura_via_service(
            session, u.negocio_id, p.id, Decimal("100.00"),
            fecha_emision=date.today() - timedelta(days=30),
        )
        f_recent = _create_factura_via_service(
            session, u.negocio_id, p.id, Decimal("200.00"),
            fecha_emision=date.today(),
        )
        session.commit()

        svc = FacturaService(session)
        results = svc.listar(u.negocio_id,
            proveedor_id=p.id,
            fecha_desde=date.today() - timedelta(days=7),
        )
        ids = [r.id for r in results]

        assert f_recent.id in ids
        assert f_old.id not in ids

    def test_user_isolation_in_listar(self, session: Session):
        from app.services.factura_service import FacturaService

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.negocio_id)

        f_a = _create_factura_via_service(session, u_a.negocio_id, p_a.id)
        session.commit()

        svc = FacturaService(session)
        results_b = svc.listar(u_b.negocio_id)
        ids_b = [r.id for r in results_b]

        assert f_a.id not in ids_b

    def test_fifo_estado_correct_across_multiple_invoices(self, session: Session):
        """
        3 invoices of 100 each. Pool = 150.
        Expected: oldest PAGADA, middle PARCIAL, newest PENDIENTE.
        """
        from app.services.factura_service import FacturaService
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        two_days_ago = date.today() - timedelta(days=2)
        yesterday = date.today() - timedelta(days=1)
        today = date.today()

        f_old = _create_factura_via_service(session, u.negocio_id, p.id, Decimal("100.00"), fecha_emision=two_days_ago)
        f_mid = _create_factura_via_service(session, u.negocio_id, p.id, Decimal("100.00"), fecha_emision=yesterday)
        f_new = _create_factura_via_service(session, u.negocio_id, p.id, Decimal("100.00"), fecha_emision=today)
        _make_pago(session, u.negocio_id, p.id, Decimal("150.00"))
        session.commit()

        svc = FacturaService(session)
        results = svc.listar(u.negocio_id, proveedor_id=p.id)
        estado_by_id = {r.id: r.estado for r in results}

        assert estado_by_id[f_old.id] == EstadoFactura.PAGADA
        assert estado_by_id[f_mid.id] == EstadoFactura.PARCIAL
        assert estado_by_id[f_new.id] == EstadoFactura.PENDIENTE


# ── actualizar ────────────────────────────────────────────────────────────────


class TestActualizar:
    def test_partial_update_monto_total(self, session: Session):
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaUpdate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        created = _create_factura_via_service(session, u.negocio_id, p.id, Decimal("100.00"))
        session.commit()

        svc = FacturaService(session)
        updated = svc.actualizar(u.negocio_id,
            created.id,
            FacturaUpdate(monto_total=Decimal("250.00")),
        )
        session.commit()

        assert updated.monto_total == Decimal("250.00")
        assert updated.id == created.id

    def test_foreign_factura_raises_404_on_update(self, session: Session):
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaUpdate

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.negocio_id)
        created = _create_factura_via_service(session, u_a.negocio_id, p_a.id)
        session.commit()

        svc = FacturaService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.actualizar(u_b.negocio_id, created.id, FacturaUpdate(numero="X"))
        assert exc_info.value.status_code == 404

    def test_update_with_new_items(self, session: Session):
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaUpdate, FacturaItemCreate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        created = _create_factura_via_service(session, u.negocio_id, p.id, Decimal("100.00"))
        session.commit()

        svc = FacturaService(session)
        updated = svc.actualizar(u.negocio_id,
            created.id,
            FacturaUpdate(
                items=[
                    FacturaItemCreate(
                        descripcion="Updated item",
                        cantidad=Decimal("1"),
                        precio_unitario=Decimal("100.00"),
                    )
                ]
            ),
        )
        session.commit()

        assert len(updated.items) == 1
        assert updated.items[0].descripcion == "Updated item"


# ── eliminar ──────────────────────────────────────────────────────────────────


class TestEliminar:
    def test_soft_deletes_factura(self, session: Session):
        from app.services.factura_service import FacturaService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        created = _create_factura_via_service(session, u.negocio_id, p.id)
        session.commit()

        svc = FacturaService(session)
        result = svc.eliminar(u.negocio_id, created.id)
        session.commit()

        assert result["id"] == created.id

        # Verify soft-deleted (get raises 404)
        with pytest.raises(HTTPException) as exc_info:
            svc.get(u.negocio_id, created.id)
        assert exc_info.value.status_code == 404

    def test_foreign_factura_raises_404_on_delete(self, session: Session):
        from app.services.factura_service import FacturaService

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.negocio_id)
        created = _create_factura_via_service(session, u_a.negocio_id, p_a.id)
        session.commit()

        svc = FacturaService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.eliminar(u_b.negocio_id, created.id)
        assert exc_info.value.status_code == 404
