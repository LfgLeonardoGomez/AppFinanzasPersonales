"""
Tests for ProveedorService (task 3.1 — TDD RED, then GREEN).

Covers:
- listar: returns active suppliers with saldo, excludes soft-deleted
- crear: sets usuario_id from session arg, ignores any payload id
- get/actualizar: foreign supplier → 404 (never 403)
- eliminar: soft-deletes, preserves row+FKs, returns tiene_dependencias
- buscar_por_nombre: normalized search scoped to caller
- Cross-user isolation: ≥2 users, foreign resource → 404
- Soft-deleted read → 404
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel
from fastapi import HTTPException

import app.models  # noqa: F401

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
        email=f"svc_{uuid.uuid4().hex[:8]}@test.com",
        nombre="Service Test",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehashforsvctest",
    )
    session.add(u)
    session.flush()
    return u


def _make_factura(session: Session, negocio_id, proveedor_id, monto: Decimal):
    from app.models.factura import Factura
    from app.core.uuid_utils import new_uuid
    from app.models.enums import OrigenDocumento

    f = Factura(
        id=new_uuid(),
        negocio_id=negocio_id,
        proveedor_id=proveedor_id,
        fecha_emision=date.today(),
        monto_total=monto,
        origen=OrigenDocumento.MANUAL,
    )
    session.add(f)
    session.flush()
    return f


def _make_pago(session: Session, negocio_id, proveedor_id, monto: Decimal):
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


# ── listar ────────────────────────────────────────────────────────────────────


class TestListar:
    def test_listar_returns_active_suppliers_with_saldo(self, session: Session):
        """Spec: listar returns active suppliers with computed saldo."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        svc.crear(user.negocio_id, ProveedorCreate(nombre="Proveedor Listar"))
        session.commit()

        results = svc.listar(user.negocio_id)
        names = {r.nombre for r in results}
        assert "Proveedor Listar" in names

    def test_listar_excludes_soft_deleted(self, session: Session):
        """Spec: soft-deleted suppliers are excluded from listar."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="ToBeDeleted"))
        session.commit()

        svc.eliminar(user.negocio_id, prov.id)
        session.commit()

        results = svc.listar(user.negocio_id)
        names = {r.nombre for r in results}
        assert "ToBeDeleted" not in names

    def test_listar_saldo_includes_facturas_and_pagos(self, session: Session):
        """Spec: saldo in listing = facturas - pagos."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="SaldoTest"))
        session.commit()

        _make_factura(session, user.negocio_id, prov.id, Decimal("300.00"))
        _make_pago(session, user.negocio_id, prov.id, Decimal("100.00"))
        session.commit()

        results = svc.listar(user.negocio_id)
        r = next(r for r in results if r.nombre == "SaldoTest")
        assert r.saldo == Decimal("200.00")


# ── crear ─────────────────────────────────────────────────────────────────────


class TestCrear:
    def test_crear_sets_usuario_id_from_arg(self, session: Session):
        """Spec: crear sets usuario_id from the provided arg, NOT from payload."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="NewSupplier"))
        session.commit()

        assert prov.negocio_id == user.negocio_id

    def test_crear_returns_saldo_zero(self, session: Session):
        """Spec: new supplier has saldo=0.00 (no movements yet)."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="ZeroSaldo"))
        session.commit()

        # After creation, get returns saldo via get_saldo_por_proveedor
        full = svc.get(user.negocio_id, prov.id)
        assert full.saldo == Decimal("0.00")

    def test_crear_allows_duplicate_nombres(self, session: Session):
        """Spec: duplicate nombres allowed (no uniqueness constraint)."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        p1 = svc.crear(user.negocio_id, ProveedorCreate(nombre="Duplicate"))
        p2 = svc.crear(user.negocio_id, ProveedorCreate(nombre="Duplicate"))
        session.commit()

        assert p1.id != p2.id


# ── get with isolation ────────────────────────────────────────────────────────


class TestGet:
    def test_get_own_supplier_succeeds(self, session: Session):
        """Spec: get own supplier returns it."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="MySupplier"))
        session.commit()

        result = svc.get(user.negocio_id, prov.id)
        assert result.id == prov.id

    def test_get_foreign_supplier_returns_404(self, session: Session):
        """Spec: get a supplier owned by another user → HTTPException(404)."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user1 = _make_usuario(session)
        user2 = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov2 = svc.crear(user2.negocio_id, ProveedorCreate(nombre="User2Supplier"))
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            svc.get(user1.negocio_id, prov2.id)
        assert exc_info.value.status_code == 404

    def test_get_soft_deleted_returns_404(self, session: Session):
        """Spec: accessing a soft-deleted supplier → 404."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="DeletedGet"))
        session.commit()
        svc.eliminar(user.negocio_id, prov.id)
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            svc.get(user.negocio_id, prov.id)
        assert exc_info.value.status_code == 404


# ── actualizar ────────────────────────────────────────────────────────────────


class TestActualizar:
    def test_actualizar_own_supplier(self, session: Session):
        """Spec: actualizar own supplier updates fields."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate, ProveedorUpdate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="Original"))
        session.commit()

        updated = svc.actualizar(user.negocio_id, prov.id, ProveedorUpdate(nombre="Updated"))
        session.commit()

        assert updated.nombre == "Updated"

    def test_actualizar_foreign_supplier_returns_404(self, session: Session):
        """Spec: PATCH on foreign supplier → 404."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate, ProveedorUpdate

        user1 = _make_usuario(session)
        user2 = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov2 = svc.crear(user2.negocio_id, ProveedorCreate(nombre="User2Edit"))
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            svc.actualizar(user1.negocio_id, prov2.id, ProveedorUpdate(nombre="Hacked"))
        assert exc_info.value.status_code == 404


# ── eliminar ──────────────────────────────────────────────────────────────────


class TestEliminar:
    def test_eliminar_soft_deletes_supplier(self, session: Session):
        """Spec: eliminar sets deleted_at, row is preserved."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="SoftDeleteMe"))
        session.commit()

        svc.eliminar(user.negocio_id, prov.id)
        session.commit()

        # Row still exists in DB
        repo = ProveedorRepository(session)
        fetched = repo.get(prov.id)
        assert fetched is not None
        assert fetched.deleted_at is not None

    def test_eliminar_returns_tiene_dependencias_true(self, session: Session):
        """Spec: eliminar returns tiene_dependencias=True when active facturas exist."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="WithDeps"))
        session.commit()

        _make_factura(session, user.negocio_id, prov.id, Decimal("100.00"))
        session.commit()

        result = svc.eliminar(user.negocio_id, prov.id)
        session.commit()

        assert result["tiene_dependencias"] is True

    def test_eliminar_returns_tiene_dependencias_false(self, session: Session):
        """Spec: eliminar returns tiene_dependencias=False when no active deps."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="NoDeps"))
        session.commit()

        result = svc.eliminar(user.negocio_id, prov.id)
        session.commit()

        assert result["tiene_dependencias"] is False

    def test_eliminar_fks_preserved(self, session: Session):
        """Spec: after soft-delete, FK rows (facturas/pagos) are NOT cascade-deleted."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate
        from app.models.factura import Factura
        from sqlmodel import select

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="FKPreserve"))
        session.commit()

        factura = _make_factura(session, user.negocio_id, prov.id, Decimal("200.00"))
        session.commit()

        svc.eliminar(user.negocio_id, prov.id)
        session.commit()

        # The factura must still exist with the proveedor_id pointing to our supplier
        fetched_factura = session.get(Factura, factura.id)
        assert fetched_factura is not None
        assert fetched_factura.proveedor_id == prov.id

    def test_eliminar_foreign_supplier_returns_404(self, session: Session):
        """Spec: DELETE on foreign supplier → 404."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user1 = _make_usuario(session)
        user2 = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov2 = svc.crear(user2.negocio_id, ProveedorCreate(nombre="User2Del"))
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            svc.eliminar(user1.negocio_id, prov2.id)
        assert exc_info.value.status_code == 404


# ── buscar_por_nombre ─────────────────────────────────────────────────────────


class TestBuscarPorNombre:
    def test_search_returns_normalized_matches(self, session: Session):
        """Spec: buscar_por_nombre returns matches for normalized query, caller only."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        svc.crear(user.negocio_id, ProveedorCreate(nombre="Electricidad del Sur"))
        svc.crear(user.negocio_id, ProveedorCreate(nombre="GAS NATURAL"))
        session.commit()

        results = svc.buscar_por_nombre(user.negocio_id, "ELECTRICIDAD")
        names = {r.nombre for r in results}
        assert "Electricidad del Sur" in names
        assert "GAS NATURAL" not in names

    def test_search_excludes_soft_deleted(self, session: Session):
        """Spec: soft-deleted suppliers excluded from search."""
        from app.services.proveedor_service import ProveedorService
        from app.schemas.proveedor import ProveedorCreate

        user = _make_usuario(session)
        session.commit()

        svc = ProveedorService(session)
        prov = svc.crear(user.negocio_id, ProveedorCreate(nombre="SearchAndDelete"))
        session.commit()
        svc.eliminar(user.negocio_id, prov.id)
        session.commit()

        results = svc.buscar_por_nombre(user.negocio_id, "searchanddelete")
        names = {r.nombre for r in results}
        assert "SearchAndDelete" not in names
