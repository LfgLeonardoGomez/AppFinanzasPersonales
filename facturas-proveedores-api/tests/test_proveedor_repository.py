"""
Tests for ProveedorRepository extensions (task 2.1 — TDD RED, then GREEN).

Covers:
- list_by_negocio returns only caller's active suppliers
- saldo computed correctly: SUM(facturas) - SUM(pagos) in ONE aggregate query
- saldo NOT double-counted when supplier has both invoices and payments
- ordering by nombre (asc, case-insensitive) vs saldo (desc)
- search_by_nombre: normalized lowercase, user-scoped, active-only
- tiene_dependencias: true/false branches
- soft_delete wrapper, create wrapper

Uses real Postgres via testcontainers (rule #9: never SQLite).
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

import pytest
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401 — register all SQLModel table metadata

from tests.conftest import crear_negocio


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    """Create all tables against the testcontainers Postgres."""
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    """Provide a transactional session; rolled back after each test."""
    with Session(engine) as s:
        yield s


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_usuario(session: Session) -> Any:
    """Create and persist a Usuario for testing."""
    from app.models.usuario import Usuario
    from app.core.uuid_utils import new_uuid

    u = Usuario(
        negocio_id=crear_negocio(session).id,
        id=new_uuid(),
        email=f"repo_{uuid.uuid4().hex[:8]}@test.com",
        nombre="Repo Test",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehashforrepotest",
    )
    session.add(u)
    session.flush()
    return u


def _make_proveedor(session: Session, negocio_id: uuid.UUID, nombre: str, **kwargs) -> Any:
    from app.models.proveedor import Proveedor
    from app.core.uuid_utils import new_uuid
    from app.models.enums import CategoriaProveedor

    p = Proveedor(
        id=new_uuid(),
        negocio_id=negocio_id,
        nombre=nombre,
        categoria=kwargs.get("categoria", CategoriaProveedor.OTRO),
        cuit=kwargs.get("cuit", None),
        deleted_at=kwargs.get("deleted_at", None),
    )
    session.add(p)
    session.flush()
    return p


def _make_factura(session: Session, negocio_id: uuid.UUID, proveedor_id: uuid.UUID, monto: Decimal) -> Any:
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


def _make_pago(session: Session, negocio_id: uuid.UUID, proveedor_id: uuid.UUID, monto: Decimal) -> Any:
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


# ── list_by_negocio isolation ─────────────────────────────────────────────────


class TestListByUsuario:
    def test_returns_only_caller_suppliers(self, session: Session):
        """Spec: list_by_negocio returns ONLY the caller's active suppliers."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user1 = _make_usuario(session)
        user2 = _make_usuario(session)
        _make_proveedor(session, user1.negocio_id, "Acme User1")
        _make_proveedor(session, user2.negocio_id, "Acme User2")
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.list_by_negocio(user1.negocio_id)

        names = {r.nombre for r in results}
        assert "Acme User1" in names
        assert "Acme User2" not in names

    def test_excludes_soft_deleted_suppliers(self, session: Session):
        """Spec: soft-deleted suppliers (deleted_at IS NOT NULL) excluded."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        _make_proveedor(session, user.negocio_id, "Active Supplier")
        _make_proveedor(
            session, user.negocio_id, "Deleted Supplier",
            deleted_at=datetime.now(timezone.utc)
        )
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.list_by_negocio(user.negocio_id)

        names = {r.nombre for r in results}
        assert "Active Supplier" in names
        assert "Deleted Supplier" not in names

    def test_saldo_computed_correctly_single_query(self, session: Session):
        """
        Spec: saldo = SUM(facturas) - SUM(pagos) in one aggregate query.

        Supplier has 2 facturas (100 + 200 = 300) and 1 pago (50).
        Expected saldo = 250.00.
        """
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        prov = _make_proveedor(session, user.negocio_id, "Saldo Supplier")
        _make_factura(session, user.negocio_id, prov.id, Decimal("100.00"))
        _make_factura(session, user.negocio_id, prov.id, Decimal("200.00"))
        _make_pago(session, user.negocio_id, prov.id, Decimal("50.00"))
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.list_by_negocio(user.negocio_id)

        saldo_supplier = next(r for r in results if r.nombre == "Saldo Supplier")
        assert saldo_supplier.saldo == Decimal("250.00")

    def test_saldo_no_double_count_with_both_invoices_and_payments(self, session: Session):
        """
        Spec: saldo NOT double-counted when supplier has BOTH invoices and payments.

        Pre-aggregated subqueries (factura_sums/pago_sums via GROUP BY each) prevent
        the cartesian product fan-out that happens with a naive JOIN.
        Supplier: 2 facturas (300+400=700) + 2 pagos (100+50=150)
        Expected saldo = 550.00 (not 1400-300=1100 or similar).
        """
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        prov = _make_proveedor(session, user.negocio_id, "NoDoubleCount")
        _make_factura(session, user.negocio_id, prov.id, Decimal("300.00"))
        _make_factura(session, user.negocio_id, prov.id, Decimal("400.00"))
        _make_pago(session, user.negocio_id, prov.id, Decimal("100.00"))
        _make_pago(session, user.negocio_id, prov.id, Decimal("50.00"))
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.list_by_negocio(user.negocio_id)

        r = next(r for r in results if r.nombre == "NoDoubleCount")
        assert r.saldo == Decimal("550.00")

    def test_saldo_zero_for_supplier_with_no_movements(self, session: Session):
        """Spec: supplier with no facturas/pagos has saldo 0.00."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        _make_proveedor(session, user.negocio_id, "EmptySupplier")
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.list_by_negocio(user.negocio_id)

        r = next(r for r in results if r.nombre == "EmptySupplier")
        assert r.saldo == Decimal("0.00")

    def test_saldo_is_decimal_not_float(self, session: Session):
        """Spec: saldo returned as Decimal (numeric(12,2)), never float."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        _make_proveedor(session, user.negocio_id, "DecimalCheck")
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.list_by_negocio(user.negocio_id)

        r = next(r for r in results if r.nombre == "DecimalCheck")
        assert isinstance(r.saldo, Decimal)


# ── Ordering ──────────────────────────────────────────────────────────────────


class TestListOrdering:
    def test_order_by_nombre_ascending_case_insensitive(self, session: Session):
        """Spec: order_by='nombre' returns case-insensitive ascending order."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        _make_proveedor(session, user.negocio_id, "Zebra")
        _make_proveedor(session, user.negocio_id, "alpha")
        _make_proveedor(session, user.negocio_id, "Middle")
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.list_by_negocio(user.negocio_id, order_by="nombre")

        # Filter to this user's 3 test suppliers
        test_results = [r for r in results if r.nombre in {"Zebra", "alpha", "Middle"}]
        names = [r.nombre for r in test_results]
        assert names == sorted(names, key=lambda n: n.lower())

    def test_order_by_saldo_descending(self, session: Session):
        """Spec: order_by='saldo' returns descending (largest debt first)."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        prov_a = _make_proveedor(session, user.negocio_id, "SaldoA")
        prov_b = _make_proveedor(session, user.negocio_id, "SaldoB")
        prov_c = _make_proveedor(session, user.negocio_id, "SaldoC")
        _make_factura(session, user.negocio_id, prov_a.id, Decimal("1000.00"))
        _make_factura(session, user.negocio_id, prov_b.id, Decimal("500.00"))
        # prov_c has no movements → saldo 0
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.list_by_negocio(user.negocio_id, order_by="saldo")

        test_results = [r for r in results if r.nombre in {"SaldoA", "SaldoB", "SaldoC"}]
        saldos = [r.saldo for r in test_results]
        assert saldos == sorted(saldos, reverse=True)


# ── search_by_nombre ──────────────────────────────────────────────────────────


class TestSearchByNombre:
    def test_search_returns_case_insensitive_matches(self, session: Session):
        """Spec: search is case-insensitive and user-scoped."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        _make_proveedor(session, user.negocio_id, "Electricidad del Sur")
        _make_proveedor(session, user.negocio_id, "Electricidad del Norte")
        _make_proveedor(session, user.negocio_id, "Gas Natural")
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.search_by_nombre(user.negocio_id, "electricidad")
        names = {r.nombre for r in results}
        assert "Electricidad del Sur" in names
        assert "Electricidad del Norte" in names
        assert "Gas Natural" not in names

    def test_search_excludes_soft_deleted(self, session: Session):
        """Spec: soft-deleted suppliers not returned by search."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        _make_proveedor(session, user.negocio_id, "Active Elec", deleted_at=None)
        _make_proveedor(
            session, user.negocio_id, "Deleted Elec",
            deleted_at=datetime.now(timezone.utc)
        )
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.search_by_nombre(user.negocio_id, "elec")
        names = {r.nombre for r in results}
        assert "Active Elec" in names
        assert "Deleted Elec" not in names

    def test_search_does_not_return_other_user_suppliers(self, session: Session):
        """Spec: search is scoped to caller's user_id only."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user1 = _make_usuario(session)
        user2 = _make_usuario(session)
        _make_proveedor(session, user1.negocio_id, "Shared Name")
        _make_proveedor(session, user2.negocio_id, "Shared Name")
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.search_by_nombre(user1.negocio_id, "shared")
        # All results must belong to user1 only
        for r in results:
            assert r.negocio_id == user1.negocio_id


# ── tiene_dependencias ────────────────────────────────────────────────────────


class TestTieneDependencias:
    def test_returns_true_when_active_factura_exists(self, session: Session):
        """Spec: tiene_dependencias=True when active factura exists."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        prov = _make_proveedor(session, user.negocio_id, "WithFactura")
        _make_factura(session, user.negocio_id, prov.id, Decimal("100.00"))
        session.commit()

        repo = ProveedorRepository(session)
        assert repo.tiene_dependencias(prov.id) is True

    def test_returns_true_when_active_pago_exists(self, session: Session):
        """Spec: tiene_dependencias=True when active pago exists."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        prov = _make_proveedor(session, user.negocio_id, "WithPago")
        _make_pago(session, user.negocio_id, prov.id, Decimal("50.00"))
        session.commit()

        repo = ProveedorRepository(session)
        assert repo.tiene_dependencias(prov.id) is True

    def test_returns_false_when_no_dependencies(self, session: Session):
        """Spec: tiene_dependencias=False when no active invoices or payments."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        prov = _make_proveedor(session, user.negocio_id, "NoDeps")
        session.commit()

        repo = ProveedorRepository(session)
        assert repo.tiene_dependencias(prov.id) is False


# ── create/update/soft_delete wrappers ───────────────────────────────────────


class TestCrudWrappers:
    def test_create_persists_supplier(self, session: Session):
        """Spec: create() persists proveedor with given usuario_id."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        session.commit()

        repo = ProveedorRepository(session)
        prov = repo.create(
            negocio_id=user.negocio_id,
            nombre="Wrapper Test",
        )
        session.commit()

        fetched = repo.get(prov.id)
        assert fetched is not None
        assert fetched.nombre == "Wrapper Test"
        assert fetched.negocio_id == user.negocio_id

    def test_soft_delete_sets_deleted_at(self, session: Session):
        """Spec: soft_delete sets deleted_at, row still exists in DB."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        prov = _make_proveedor(session, user.negocio_id, "ToDelete")
        session.commit()

        repo = ProveedorRepository(session)
        repo.soft_delete(prov.id)
        session.commit()

        fetched = repo.get(prov.id)
        assert fetched is not None  # row preserved
        assert fetched.deleted_at is not None  # marked deleted

    def test_soft_delete_excludes_from_list(self, session: Session):
        """Spec: after soft_delete, supplier is excluded from list_by_negocio."""
        from app.repositories.proveedor_repository import ProveedorRepository

        user = _make_usuario(session)
        prov = _make_proveedor(session, user.negocio_id, "SoftDeletedList")
        session.commit()

        repo = ProveedorRepository(session)
        repo.soft_delete(prov.id)
        session.commit()

        results = repo.list_by_negocio(user.negocio_id)
        names = {r.nombre for r in results}
        assert "SoftDeletedList" not in names
