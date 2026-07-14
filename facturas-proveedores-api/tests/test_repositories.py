"""
Integration tests for repositories — real PostgreSQL via testcontainers.

TDD RED phase: covers tasks 7.4 and 7.5.

- Task 7.4: BaseRepository CRUD + soft_delete + list filtering
- Task 7.5: ProveedorRepository saldo aggregate query (GROUP BY, no N+1)
"""

import uuid
from decimal import Decimal
from datetime import date

import pytest
from sqlmodel import Session, create_engine, SQLModel, select
from sqlalchemy import text

import app.models  # noqa: F401 — register all tables
from app.models.usuario import Usuario
from app.models.proveedor import Proveedor
from app.models.factura import Factura, FacturaItem
from app.models.pago import Pago
from app.models.enums import OrigenDocumento, MetodoPago, CategoriaProveedor


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    SQLModel.metadata.drop_all(eng)


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s
        s.rollback()


# ── Helpers ────────────────────────────────────────────────────────────────────

def create_usuario(session: Session, suffix: str = "") -> Usuario:
    u = Usuario(
        email=f"user{suffix}_{uuid.uuid4().hex[:6]}@test.com",
        nombre=f"User {suffix}",
        password_hash="hash",
    )
    session.add(u)
    session.flush()
    return u


def create_proveedor(session: Session, usuario_id: uuid.UUID,
                     nombre: str = "Proveedor") -> Proveedor:
    p = Proveedor(usuario_id=usuario_id, nombre=nombre)
    session.add(p)
    session.flush()
    return p


def create_factura(session: Session, usuario_id: uuid.UUID,
                   proveedor_id: uuid.UUID,
                   monto: Decimal = Decimal("1000.00")) -> Factura:
    f = Factura(
        usuario_id=usuario_id,
        proveedor_id=proveedor_id,
        fecha_emision=date(2024, 1, 1),
        monto_total=monto,
        origen=OrigenDocumento.MANUAL,
    )
    session.add(f)
    session.flush()
    return f


def create_pago(session: Session, usuario_id: uuid.UUID,
                proveedor_id: uuid.UUID,
                monto: Decimal = Decimal("500.00")) -> Pago:
    p = Pago(
        usuario_id=usuario_id,
        proveedor_id=proveedor_id,
        monto=monto,
        fecha=date(2024, 2, 1),
        metodo=MetodoPago.TRANSFERENCIA,
        origen=OrigenDocumento.MANUAL,
    )
    session.add(p)
    session.flush()
    return p


# ── Task 7.4: BaseRepository CRUD ────────────────────────────────────────────

class TestBaseRepositoryCRUD:
    """Spec: create persists and get recovers; soft_delete marks deleted_at."""

    def test_create_persists_and_get_recovers(self, session: Session):
        """Spec: create entity, then get retrieves it by id."""
        from app.repositories.proveedor_repository import ProveedorRepository

        u = create_usuario(session, "crud1")
        repo = ProveedorRepository(session)

        proveedor = repo.create(
            usuario_id=u.id,
            nombre="Test Proveedor",
        )
        session.commit()

        fetched = repo.get(proveedor.id)
        assert fetched is not None
        assert fetched.id == proveedor.id
        assert fetched.nombre == "Test Proveedor"

    def test_create_sets_id_automatically(self, session: Session):
        """Edge case: id is auto-generated via new_uuid."""
        from app.repositories.proveedor_repository import ProveedorRepository

        u = create_usuario(session, "crud2")
        repo = ProveedorRepository(session)

        p = repo.create(usuario_id=u.id, nombre="Auto ID")
        session.commit()

        assert p.id is not None
        assert isinstance(p.id, uuid.UUID)

    def test_list_returns_active_entities(self, session: Session):
        """Spec: list by default returns only entities with deleted_at IS NULL."""
        from app.repositories.proveedor_repository import ProveedorRepository

        u = create_usuario(session, "list1")
        repo = ProveedorRepository(session)

        p1 = repo.create(usuario_id=u.id, nombre="Active 1")
        p2 = repo.create(usuario_id=u.id, nombre="Active 2")
        session.commit()

        result = repo.list(usuario_id=u.id)
        ids = {r.id for r in result}
        assert p1.id in ids
        assert p2.id in ids

    def test_soft_delete_marks_deleted_at(self, session: Session):
        """Spec: soft_delete populates deleted_at."""
        from app.repositories.proveedor_repository import ProveedorRepository

        u = create_usuario(session, "del1")
        repo = ProveedorRepository(session)

        p = repo.create(usuario_id=u.id, nombre="To Delete")
        session.commit()

        repo.soft_delete(p.id)
        session.commit()
        session.refresh(p)

        assert p.deleted_at is not None

    def test_soft_delete_excludes_from_default_list(self, session: Session):
        """Spec: deleted entity does NOT appear in list by default."""
        from app.repositories.proveedor_repository import ProveedorRepository

        u = create_usuario(session, "del2")
        repo = ProveedorRepository(session)

        p_active = repo.create(usuario_id=u.id, nombre="Active")
        p_deleted = repo.create(usuario_id=u.id, nombre="Will Delete")
        session.commit()

        repo.soft_delete(p_deleted.id)
        session.commit()

        result = repo.list(usuario_id=u.id)
        ids = {r.id for r in result}
        assert p_active.id in ids
        assert p_deleted.id not in ids

    def test_soft_delete_preserves_row_in_database(self, session: Session):
        """Spec: soft_delete preserves the row (FK integrity maintained)."""
        from app.repositories.proveedor_repository import ProveedorRepository

        u = create_usuario(session, "del3")
        repo = ProveedorRepository(session)

        p = repo.create(usuario_id=u.id, nombre="Preserved Row")
        session.commit()
        pid = p.id

        repo.soft_delete(pid)
        session.commit()

        # Row still accessible by get (even though deleted)
        fetched = repo.get(pid)
        assert fetched is not None
        assert fetched.deleted_at is not None


# ── Task 7.5: Saldo aggregate query ──────────────────────────────────────────

class TestSaldoAggregateQuery:
    """Spec: single SQL GROUP BY calculating SUM(facturas) - SUM(pagos)."""

    def test_saldo_calculated_correctly(self, session: Session):
        """Spec: saldo = sum of active invoice amounts - sum of active payment amounts."""
        from app.repositories.proveedor_repository import ProveedorRepository

        u = create_usuario(session, "saldo1")
        p = create_proveedor(session, u.id, "Proveedor Saldo")
        session.commit()

        # 3 facturas, 1 pago
        create_factura(session, u.id, p.id, Decimal("1000.00"))
        create_factura(session, u.id, p.id, Decimal("2000.00"))
        create_pago(session, u.id, p.id, Decimal("500.00"))
        session.commit()

        repo = ProveedorRepository(session)
        saldos = repo.get_saldo_por_proveedor(usuario_id=u.id)

        # saldo = 1000 + 2000 - 500 = 2500
        assert p.id in saldos
        assert saldos[p.id] == Decimal("2500.00")

    def test_saldo_ignores_deleted_facturas_and_pagos(self, session: Session):
        """Spec: saldo does NOT include rows with deleted_at populated."""
        from app.repositories.proveedor_repository import ProveedorRepository
        from datetime import datetime, timezone

        u = create_usuario(session, "saldo2")
        p = create_proveedor(session, u.id, "Proveedor Soft")
        session.commit()

        f_active = create_factura(session, u.id, p.id, Decimal("1000.00"))
        f_deleted = create_factura(session, u.id, p.id, Decimal("9999.00"))
        pago_active = create_pago(session, u.id, p.id, Decimal("200.00"))
        pago_deleted = create_pago(session, u.id, p.id, Decimal("8888.00"))

        # Soft-delete the flagged entries
        f_deleted.deleted_at = datetime.now(timezone.utc)
        pago_deleted.deleted_at = datetime.now(timezone.utc)
        session.add(f_deleted)
        session.add(pago_deleted)
        session.commit()

        repo = ProveedorRepository(session)
        saldos = repo.get_saldo_por_proveedor(usuario_id=u.id)

        # Only active: 1000 - 200 = 800
        assert saldos[p.id] == Decimal("800.00")

    def test_saldo_returns_zero_for_proveedor_without_data(self, session: Session):
        """Edge case: proveedor with no facturas/pagos returns 0 saldo."""
        from app.repositories.proveedor_repository import ProveedorRepository

        u = create_usuario(session, "saldo3")
        p = create_proveedor(session, u.id, "Empty Proveedor")
        session.commit()

        repo = ProveedorRepository(session)
        saldos = repo.get_saldo_por_proveedor(usuario_id=u.id)

        # Proveedor with no data should return 0 or not appear (depends on impl)
        # Per spec: saldo is SUM(facturas) - SUM(pagos); with no data, result is 0
        saldo = saldos.get(p.id, Decimal("0.00"))
        assert saldo == Decimal("0.00")

    def test_saldo_only_includes_queried_usuario(self, session: Session):
        """Spec: saldo query is scoped to the user (multi-tenant isolation)."""
        from app.repositories.proveedor_repository import ProveedorRepository

        u1 = create_usuario(session, "saldo_u1")
        u2 = create_usuario(session, "saldo_u2")
        p1 = create_proveedor(session, u1.id, "User1 Proveedor")
        p2 = create_proveedor(session, u2.id, "User2 Proveedor")
        session.commit()

        create_factura(session, u1.id, p1.id, Decimal("500.00"))
        create_factura(session, u2.id, p2.id, Decimal("9000.00"))
        session.commit()

        repo = ProveedorRepository(session)
        saldos_u1 = repo.get_saldo_por_proveedor(usuario_id=u1.id)

        # u1 should only see p1's saldo
        assert p1.id in saldos_u1
        assert p2.id not in saldos_u1
        assert saldos_u1[p1.id] == Decimal("500.00")
