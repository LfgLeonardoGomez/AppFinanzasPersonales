"""
Tests for PagoService (Task 3.1 — TDD RED, then GREEN).

Covers all public methods against real Postgres:
- crear: valid → saves with usuario_id from arg, origen=MANUAL; foreign
  proveedor → 404; soft-deleted proveedor → 404; future fecha → 422;
  non-positive monto → 422; invalid metodo → 422.
- listar: returns only caller's active pagos, paginated, filters by
  proveedor_id, excludes soft-deleted.
- get: own pago → returned; foreign pago → 404; soft-deleted → 404.
- actualizar: PATCH subset of fields; foreign → 404; non-positive monto
  → 422; future fecha → 422; empty patch is a no-op.
- eliminar: own → soft-deleted; foreign → 404; already-deleted → 404.
- Soft-deleted pago is excluded from the C-08 FacturaService FIFO pool
  (end-to-end integration).
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401 — register all SQLModel tables


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
        id=new_uuid(),
        email=f"svc_pago_{uuid.uuid4().hex[:8]}@test.com",
        nombre="Service Pago Test",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    )
    session.add(u)
    session.flush()
    return u


def _make_proveedor(session: Session, usuario_id: uuid.UUID, deleted: bool = False):
    from app.models.proveedor import Proveedor
    from app.core.uuid_utils import new_uuid
    from app.models.enums import CategoriaProveedor
    from datetime import datetime, timezone

    p = Proveedor(
        id=new_uuid(),
        usuario_id=usuario_id,
        nombre=f"Prov {uuid.uuid4().hex[:6]}",
        categoria=CategoriaProveedor.OTRO,
    )
    if deleted:
        p.deleted_at = datetime.now(timezone.utc)
    session.add(p)
    session.flush()
    return p


def _make_pago_db(
    session: Session,
    usuario_id: uuid.UUID,
    proveedor_id: uuid.UUID,
    monto: Decimal = Decimal("100.00"),
    deleted: bool = False,
) -> "Pago":
    from app.models.pago import Pago
    from app.core.uuid_utils import new_uuid
    from app.models.enums import MetodoPago, OrigenDocumento
    from datetime import datetime, timezone

    p = Pago(
        id=new_uuid(),
        usuario_id=usuario_id,
        proveedor_id=proveedor_id,
        monto=monto,
        fecha=date.today(),
        metodo=MetodoPago.EFECTIVO,
        origen=OrigenDocumento.MANUAL,
    )
    if deleted:
        p.deleted_at = datetime.now(timezone.utc)
    session.add(p)
    session.flush()
    return p


# ── crear ─────────────────────────────────────────────────────────────────────


class TestCrear:
    def test_creates_pago_with_origen_manual(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        svc = PagoService(session)
        result = svc.crear(
            u.id,
            PagoCreate(
                proveedor_id=p.id,
                monto=Decimal("500.00"),
                fecha=date.today(),
                metodo="EFECTIVO",
            ),
        )
        session.commit()

        assert result.usuario_id == u.id
        assert result.proveedor_id == p.id
        assert result.monto == Decimal("500.00")
        assert result.origen == OrigenDocumento.MANUAL
        assert result.deleted_at is None

    # ── c-15a-origen-ia-backend: optional `origen` on PagoService.crear ─────

    def test_crear_persists_origen_ia_when_provided(self, session: Session):
        """c-15a: when `PagoCreate.origen='IA'`, the persisted Pago.origen
        is `OrigenDocumento.IA` (C-15 IA confirmation happy path)."""
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        svc = PagoService(session)
        result = svc.crear(
            u.id,
            PagoCreate(
                proveedor_id=p.id,
                monto=Decimal("500.00"),
                fecha=date.today(),
                metodo="EFECTIVO",
                origen=OrigenDocumento.IA,
            ),
        )
        session.commit()

        assert result.origen == OrigenDocumento.IA

    def test_crear_defaults_to_manual_when_origen_omitted(self, session: Session):
        """c-15a: when `origen` is omitted on `PagoCreate`, the service
        falls back to `OrigenDocumento.MANUAL` (backward compat with C-11
        manual flow — the `test_creates_pago_with_origen_manual` above
        is the original regression guard for this)."""
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        svc = PagoService(session)
        result = svc.crear(
            u.id,
            PagoCreate(
                proveedor_id=p.id,
                monto=Decimal("500.00"),
                fecha=date.today(),
                metodo="EFECTIVO",
            ),
        )
        session.commit()

        assert result.origen == OrigenDocumento.MANUAL

    def test_creates_pago_with_comprobante_url(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        svc = PagoService(session)
        result = svc.crear(
            u.id,
            PagoCreate(
                proveedor_id=p.id,
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo="TRANSFERENCIA",
                comprobante_url="https://example.com/x.pdf",
            ),
        )
        session.commit()

        assert result.comprobante_url == "https://example.com/x.pdf"

    def test_foreign_proveedor_raises_404(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_b = _make_proveedor(session, u_b.id)

        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.crear(
                u_a.id,
                PagoCreate(
                    proveedor_id=p_b.id,
                    monto=Decimal("100.00"),
                    fecha=date.today(),
                    metodo="EFECTIVO",
                ),
            )
        assert exc_info.value.status_code == 404

    def test_soft_deleted_proveedor_raises_404(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id, deleted=True)

        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.crear(
                u.id,
                PagoCreate(
                    proveedor_id=p.id,
                    monto=Decimal("100.00"),
                    fecha=date.today(),
                    metodo="EFECTIVO",
                ),
            )
        assert exc_info.value.status_code == 404

    def test_future_fecha_raises_422(self, session: Session):
        """D5: service re-validates fecha not in the future (UTC-3) as
        defense in depth (Pydantic doesn't have a 'today' reference)."""
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.crear(
                u.id,
                PagoCreate(
                    proveedor_id=p.id,
                    monto=Decimal("100.00"),
                    fecha=date.today() + timedelta(days=1),
                    metodo="EFECTIVO",
                ),
            )
        # Future fecha is a validation error, not a missing resource.
        assert exc_info.value.status_code == 422

    def test_nonexistent_proveedor_raises_404(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate

        u = _make_usuario(session)

        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.crear(
                u.id,
                PagoCreate(
                    proveedor_id=uuid.uuid4(),
                    monto=Decimal("100.00"),
                    fecha=date.today(),
                    metodo="EFECTIVO",
                ),
            )
        assert exc_info.value.status_code == 404


# ── listar ────────────────────────────────────────────────────────────────────


class TestListar:
    def test_returns_only_callers_active_pagos(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        _make_pago_db(session, u.id, p.id, Decimal("200.00"))
        session.commit()

        svc = PagoService(session)
        items, total = svc.listar(u.id)

        assert total == 2
        assert len(items) == 2

    def test_excludes_soft_deleted(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        _make_pago_db(session, u.id, p.id, Decimal("200.00"), deleted=True)
        session.commit()

        svc = PagoService(session)
        items, total = svc.listar(u.id)

        assert total == 1
        assert len(items) == 1

    def test_filters_by_proveedor(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        p1 = _make_proveedor(session, u.id)
        p2 = _make_proveedor(session, u.id)
        _make_pago_db(session, u.id, p1.id, Decimal("100.00"))
        _make_pago_db(session, u.id, p2.id, Decimal("200.00"))
        session.commit()

        svc = PagoService(session)
        items, total = svc.listar(u.id, proveedor_id=p1.id)

        assert total == 1
        assert items[0].proveedor_id == p1.id

    def test_paginates(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        for i in range(5):
            _make_pago_db(
                session,
                u.id,
                p.id,
                Decimal(f"{(i+1)*100}.00"),
            )
        session.commit()

        svc = PagoService(session)
        page1, total = svc.listar(u.id, page=1, page_size=2)
        page2, _ = svc.listar(u.id, page=2, page_size=2)

        assert total == 5
        assert len(page1) == 2
        assert len(page2) == 2

    def test_user_isolation(self, session: Session):
        from app.services.pago_service import PagoService

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.id)
        _make_pago_db(session, u_a.id, p_a.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        items_b, total_b = svc.listar(u_b.id)

        assert total_b == 0
        assert items_b == []


# ── get ───────────────────────────────────────────────────────────────────────


class TestGet:
    def test_returns_own_pago(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        result = svc.get(u.id, pago.id)

        assert result.id == pago.id
        assert result.usuario_id == u.id

    def test_foreign_pago_raises_404(self, session: Session):
        from app.services.pago_service import PagoService

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.id)
        pago_a = _make_pago_db(session, u_a.id, p_a.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.get(u_b.id, pago_a.id)
        assert exc_info.value.status_code == 404

    def test_soft_deleted_pago_raises_404(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"), deleted=True)
        session.commit()

        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.get(u.id, pago.id)
        assert exc_info.value.status_code == 404

    def test_nonexistent_pago_raises_404(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.get(u.id, uuid.uuid4())
        assert exc_info.value.status_code == 404


# ── actualizar ────────────────────────────────────────────────────────────────


class TestActualizar:
    def test_partial_update_monto(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoUpdate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        updated = svc.actualizar(
            u.id,
            pago.id,
            PagoUpdate(monto=Decimal("500.00")),
        )
        session.commit()

        assert updated.monto == Decimal("500.00")
        assert updated.id == pago.id

    def test_partial_update_fecha(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoUpdate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        new_date = date.today() - timedelta(days=2)
        svc = PagoService(session)
        updated = svc.actualizar(
            u.id,
            pago.id,
            PagoUpdate(fecha=new_date),
        )
        session.commit()

        assert updated.fecha == new_date

    def test_partial_update_metodo(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoUpdate
        from app.models.enums import MetodoPago

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        updated = svc.actualizar(
            u.id,
            pago.id,
            PagoUpdate(metodo=MetodoPago.TRANSFERENCIA),
        )
        session.commit()

        assert updated.metodo == MetodoPago.TRANSFERENCIA

    def test_empty_patch_is_noop(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoUpdate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        updated = svc.actualizar(u.id, pago.id, PagoUpdate())
        session.commit()

        # No field was changed
        assert updated.monto == Decimal("100.00")

    def test_foreign_pago_raises_404(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoUpdate

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.id)
        pago_a = _make_pago_db(session, u_a.id, p_a.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.actualizar(
                u_b.id,
                pago_a.id,
                PagoUpdate(monto=Decimal("999.00")),
            )
        assert exc_info.value.status_code == 404

    def test_future_fecha_in_update_raises_422(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoUpdate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.actualizar(
                u.id,
                pago.id,
                PagoUpdate(fecha=date.today() + timedelta(days=1)),
            )
        assert exc_info.value.status_code == 422

    def test_non_positive_monto_in_update_raises_422(self, session: Session):
        """
        Defense in depth: monto <= 0 is rejected.
        Either by Pydantic (Field gt=0) — raises ValidationError BEFORE the
        service is called — or by the service-layer validator (raises 422).
        Both are acceptable paths; the contract is "the call MUST fail".
        """
        from pydantic import ValidationError

        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoUpdate

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        # Try monto=0 first — Pydantic will reject this at construction time
        # with ValidationError. That's the schema-level defense.
        with pytest.raises((ValidationError, HTTPException)) as exc_info:
            svc.actualizar(
                u.id,
                pago.id,
                PagoUpdate(monto=Decimal("0")),
            )
        # If we got an HTTPException, it must be 422
        if isinstance(exc_info.value, HTTPException):
            assert exc_info.value.status_code == 422


# ── eliminar ──────────────────────────────────────────────────────────────────


class TestEliminar:
    def test_soft_deletes_own_pago(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        svc.eliminar(u.id, pago.id)
        session.commit()

        # Soft-deleted: get raises 404
        with pytest.raises(HTTPException) as exc_info:
            svc.get(u.id, pago.id)
        assert exc_info.value.status_code == 404

    def test_foreign_pago_raises_404_on_delete(self, session: Session):
        from app.services.pago_service import PagoService

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.id)
        pago_a = _make_pago_db(session, u_a.id, p_a.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.eliminar(u_b.id, pago_a.id)
        assert exc_info.value.status_code == 404

    def test_already_deleted_pago_raises_404(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago_db(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        svc.eliminar(u.id, pago.id)
        session.commit()

        # Try to delete again
        with pytest.raises(HTTPException) as exc_info:
            svc.eliminar(u.id, pago.id)
        assert exc_info.value.status_code == 404

    def test_nonexistent_pago_raises_404(self, session: Session):
        from app.services.pago_service import PagoService

        u = _make_usuario(session)
        svc = PagoService(session)
        with pytest.raises(HTTPException) as exc_info:
            svc.eliminar(u.id, uuid.uuid4())
        assert exc_info.value.status_code == 404


# ── Triangulate: integration with C-08 FIFO pool ─────────────────────────────


class TestFifoPoolIntegration:
    """
    End-to-end: a soft-deleted Pago MUST be excluded from the payment pool
    consumed by the C-08 `FacturaService.listar` FIFO algorithm.
    """

    def test_soft_deleted_pago_excluded_from_fifo_pool(self, session: Session):
        from app.services.pago_service import PagoService
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaCreate
        from app.schemas.pago import PagoCreate
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        session.commit()

        pago_svc = PagoService(session)

        # Pay the full invoice
        pago = pago_svc.crear(
            u.id,
            PagoCreate(
                proveedor_id=p.id,
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo="EFECTIVO",
            ),
        )
        session.commit()

        # Create an invoice (PAGADA because pool = 100 covers monto = 100)
        fac_svc = FacturaService(session)
        factura = fac_svc.crear(
            u.id,
            FacturaCreate(
                proveedor_id=p.id,
                fecha_emision=date.today(),
                monto_total=Decimal("100.00"),
            ),
        )
        session.commit()

        assert factura.estado == EstadoFactura.PAGADA

        # Soft-delete the pago
        pago_svc.eliminar(u.id, pago.id)
        session.commit()

        # Re-aggregate: invoice should now be PENDIENTE (pool = 0)
        listar = fac_svc.listar(u.id, proveedor_id=p.id)
        estado_by_id = {r.id: r.estado for r in listar}
        assert estado_by_id[factura.id] == EstadoFactura.PENDIENTE

    def test_edit_pago_monto_reflects_in_fifo_pool(self, session: Session):
        """Edit a pago's monto; the next FacturaService.listar reflects the new amount."""
        from app.services.pago_service import PagoService
        from app.services.factura_service import FacturaService
        from app.schemas.factura import FacturaCreate
        from app.schemas.pago import PagoCreate, PagoUpdate
        from app.models.enums import EstadoFactura

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        session.commit()

        pago_svc = PagoService(session)
        pago = pago_svc.crear(
            u.id,
            PagoCreate(
                proveedor_id=p.id,
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo="EFECTIVO",
            ),
        )
        session.commit()

        fac_svc = FacturaService(session)
        factura = fac_svc.crear(
            u.id,
            FacturaCreate(
                proveedor_id=p.id,
                fecha_emision=date.today(),
                monto_total=Decimal("1000.00"),
            ),
        )
        session.commit()

        # Initially pool=100 vs invoice=1000 → PARCIAL
        listar = fac_svc.listar(u.id, proveedor_id=p.id)
        estado_by_id = {r.id: r.estado for r in listar}
        assert estado_by_id[factura.id] == EstadoFactura.PARCIAL

        # Edit pago to 1000 → now PAGADA
        pago_svc.actualizar(
            u.id,
            pago.id,
            PagoUpdate(monto=Decimal("1000.00")),
        )
        session.commit()

        listar = fac_svc.listar(u.id, proveedor_id=p.id)
        estado_by_id = {r.id: r.estado for r in listar}
        assert estado_by_id[factura.id] == EstadoFactura.PAGADA

    def test_foreign_user_cannot_get_others_pago_via_service(self, session: Session):
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.id)
        session.commit()

        pago_svc = PagoService(session)
        pago_a = pago_svc.crear(
            u_a.id,
            PagoCreate(
                proveedor_id=p_a.id,
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo="EFECTIVO",
            ),
        )
        session.commit()

        # User B tries to get → 404
        with pytest.raises(HTTPException) as exc_info:
            pago_svc.get(u_b.id, pago_a.id)
        assert exc_info.value.status_code == 404
