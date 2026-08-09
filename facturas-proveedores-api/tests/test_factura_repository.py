"""
Tests for FacturaRepository and FacturaItemRepository (Task 2.1 — TDD RED, then GREEN).

Covers:
- list_by_negocio: returns active facturas, FIFO order, scoped to user
- get_with_items: returns factura with its items
- create_with_items: atomic create of factura + items
- update_with_items: replaces items atomically
- soft_delete: sets deleted_at; items remain (hard-delete vs soft-delete)
- User isolation: user B cannot see user A's facturas
- FIFO ordering: fecha_emision ASC, created_at ASC, id ASC
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401 — ensures all SQLModel tables are registered

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
        email=f"repo_fac_{uuid.uuid4().hex[:8]}@test.com",
        nombre="Repo Factura Test",
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


def _make_factura(
    session: Session,
    negocio_id: uuid.UUID,
    proveedor_id: uuid.UUID,
    monto_total: Decimal = Decimal("100.00"),
    fecha_emision: date | None = None,
) -> "Factura":
    from app.models.factura import Factura
    from app.core.uuid_utils import new_uuid
    from app.models.enums import OrigenDocumento

    f = Factura(
        id=new_uuid(),
        negocio_id=negocio_id,
        proveedor_id=proveedor_id,
        fecha_emision=fecha_emision or date.today(),
        monto_total=monto_total,
        origen=OrigenDocumento.MANUAL,
    )
    session.add(f)
    session.flush()
    return f


# ── list_by_negocio ───────────────────────────────────────────────────────────


class TestListByUsuario:
    def test_returns_active_facturas(self, session: Session):
        from app.repositories.factura_repository import FacturaRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        f1 = _make_factura(session, u.negocio_id, p.id, Decimal("100.00"))
        f2 = _make_factura(session, u.negocio_id, p.id, Decimal("200.00"))
        session.commit()

        repo = FacturaRepository(session)
        results = repo.list_by_negocio(u.negocio_id)
        ids = [r.id for r in results]

        assert f1.id in ids
        assert f2.id in ids

    def test_excludes_soft_deleted(self, session: Session):
        from app.repositories.factura_repository import FacturaRepository
        from datetime import datetime, timezone

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        f_active = _make_factura(session, u.negocio_id, p.id, Decimal("100.00"))
        f_deleted = _make_factura(session, u.negocio_id, p.id, Decimal("200.00"))
        f_deleted.deleted_at = datetime.now(timezone.utc)
        session.add(f_deleted)
        session.commit()

        repo = FacturaRepository(session)
        results = repo.list_by_negocio(u.negocio_id)
        ids = [r.id for r in results]

        assert f_active.id in ids
        assert f_deleted.id not in ids

    def test_user_isolation(self, session: Session):
        """User B should NOT see User A's facturas."""
        from app.repositories.factura_repository import FacturaRepository

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.negocio_id)
        f_a = _make_factura(session, u_a.negocio_id, p_a.id)
        session.commit()

        repo = FacturaRepository(session)
        results_b = repo.list_by_negocio(u_b.negocio_id)

        assert f_a.id not in [r.id for r in results_b]

    def test_filters_by_proveedor_id(self, session: Session):
        from app.repositories.factura_repository import FacturaRepository

        u = _make_usuario(session)
        p1 = _make_proveedor(session, u.negocio_id)
        p2 = _make_proveedor(session, u.negocio_id)
        f1 = _make_factura(session, u.negocio_id, p1.id, Decimal("100.00"))
        f2 = _make_factura(session, u.negocio_id, p2.id, Decimal("200.00"))
        session.commit()

        repo = FacturaRepository(session)
        results = repo.list_by_negocio(u.negocio_id, proveedor_id=p1.id)
        ids = [r.id for r in results]

        assert f1.id in ids
        assert f2.id not in ids

    def test_fifo_ordering(self, session: Session):
        """Results ordered by fecha_emision ASC, created_at ASC."""
        from app.repositories.factura_repository import FacturaRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        today = date.today()
        yesterday = today - timedelta(days=1)

        f_today = _make_factura(session, u.negocio_id, p.id, Decimal("100.00"), fecha_emision=today)
        f_yesterday = _make_factura(session, u.negocio_id, p.id, Decimal("200.00"), fecha_emision=yesterday)
        session.commit()

        repo = FacturaRepository(session)
        results = repo.list_by_negocio(u.negocio_id, proveedor_id=p.id)

        # Yesterday should come first (FIFO: oldest first)
        ids = [r.id for r in results]
        assert ids.index(f_yesterday.id) < ids.index(f_today.id)


# ── get_with_items ────────────────────────────────────────────────────────────


class TestGetWithItems:
    def test_returns_factura_with_items(self, session: Session):
        from app.repositories.factura_repository import FacturaRepository
        from app.models.factura import FacturaItem
        from app.core.uuid_utils import new_uuid

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)
        f = _make_factura(session, u.negocio_id, p.id, Decimal("300.00"))

        item = FacturaItem(
            id=new_uuid(),
            factura_id=f.id,
            descripcion="Item Test",
            cantidad=Decimal("3"),
            precio_unitario=Decimal("100.00"),
        )
        session.add(item)
        session.commit()

        repo = FacturaRepository(session)
        factura, items = repo.get_with_items(f.id)

        assert factura is not None
        assert factura.id == f.id
        assert len(items) == 1
        assert items[0].descripcion == "Item Test"

    def test_returns_none_for_nonexistent(self, session: Session):
        from app.repositories.factura_repository import FacturaRepository

        repo = FacturaRepository(session)
        result = repo.get_with_items(uuid.uuid4())
        assert result is None


# ── create_with_items ─────────────────────────────────────────────────────────


class TestCreateWithItems:
    def test_creates_factura_and_items_atomically(self, session: Session):
        from app.repositories.factura_repository import FacturaRepository, FacturaItemRepository
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        repo = FacturaRepository(session)
        item_data = [
            {"descripcion": "Producto A", "cantidad": Decimal("2"), "precio_unitario": Decimal("50.00")},
        ]

        factura = repo.create_with_items(
            negocio_id=u.negocio_id,
            proveedor_id=p.id,
            fecha_emision=date.today(),
            monto_total=Decimal("100.00"),
            origen=OrigenDocumento.MANUAL,
            items_data=item_data,
        )
        session.commit()

        # Verify factura persisted
        assert factura.id is not None
        assert factura.monto_total == Decimal("100.00")

        # Verify items persisted
        item_repo = FacturaItemRepository(session)
        items = item_repo.list_by_factura(factura.id)
        assert len(items) == 1
        assert items[0].descripcion == "Producto A"

    def test_creates_factura_without_items(self, session: Session):
        from app.repositories.factura_repository import FacturaRepository
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        repo = FacturaRepository(session)
        factura = repo.create_with_items(
            negocio_id=u.negocio_id,
            proveedor_id=p.id,
            fecha_emision=date.today(),
            monto_total=Decimal("500.00"),
            origen=OrigenDocumento.MANUAL,
            items_data=[],
        )
        session.commit()

        assert factura.id is not None


# ── update_with_items ─────────────────────────────────────────────────────────


class TestUpdateWithItems:
    def test_replaces_items_atomically(self, session: Session):
        from app.repositories.factura_repository import FacturaRepository, FacturaItemRepository
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        repo = FacturaRepository(session)
        factura = repo.create_with_items(
            negocio_id=u.negocio_id,
            proveedor_id=p.id,
            fecha_emision=date.today(),
            monto_total=Decimal("100.00"),
            origen=OrigenDocumento.MANUAL,
            items_data=[
                {"descripcion": "Old item", "cantidad": Decimal("1"), "precio_unitario": Decimal("100.00")},
            ],
        )
        session.commit()

        # Update: replace items with new ones
        updated = repo.update_with_items(
            factura,
            new_items_data=[
                {"descripcion": "New item A", "cantidad": Decimal("2"), "precio_unitario": Decimal("75.00")},
                {"descripcion": "New item B", "cantidad": Decimal("1"), "precio_unitario": Decimal("50.00")},
            ],
            monto_total=Decimal("200.00"),
        )
        session.commit()

        item_repo = FacturaItemRepository(session)
        items = item_repo.list_by_factura(updated.id)

        assert updated.monto_total == Decimal("200.00")
        assert len(items) == 2
        descs = {i.descripcion for i in items}
        assert "Old item" not in descs
        assert "New item A" in descs
        assert "New item B" in descs


# ── soft_delete ───────────────────────────────────────────────────────────────


class TestSoftDelete:
    def test_soft_delete_sets_deleted_at(self, session: Session):
        from app.repositories.factura_repository import FacturaRepository
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        repo = FacturaRepository(session)
        factura = repo.create_with_items(
            negocio_id=u.negocio_id,
            proveedor_id=p.id,
            fecha_emision=date.today(),
            monto_total=Decimal("100.00"),
            origen=OrigenDocumento.MANUAL,
            items_data=[],
        )
        session.commit()

        repo.soft_delete(factura.id)
        session.commit()

        session.refresh(factura)
        assert factura.deleted_at is not None

    def test_soft_delete_keeps_items_in_db(self, session: Session):
        """
        Soft-deleting a Factura does NOT hard-delete FacturaItems.
        Items remain in DB (FK integrity). Service layer handles cascade.
        """
        from app.repositories.factura_repository import FacturaRepository, FacturaItemRepository
        from app.models.enums import OrigenDocumento

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id)

        repo = FacturaRepository(session)
        factura = repo.create_with_items(
            negocio_id=u.negocio_id,
            proveedor_id=p.id,
            fecha_emision=date.today(),
            monto_total=Decimal("100.00"),
            origen=OrigenDocumento.MANUAL,
            items_data=[
                {"descripcion": "Item kept", "cantidad": Decimal("1"), "precio_unitario": Decimal("100.00")},
            ],
        )
        session.commit()

        repo.soft_delete(factura.id)
        session.commit()

        # Items should still exist in DB
        item_repo = FacturaItemRepository(session)
        items = item_repo.list_by_factura(factura.id)
        assert len(items) == 1
        assert items[0].descripcion == "Item kept"
