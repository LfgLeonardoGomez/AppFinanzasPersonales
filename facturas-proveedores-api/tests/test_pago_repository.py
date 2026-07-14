"""
Tests for PagoRepository (Task 2.1 — TDD RED, then GREEN).

Covers:
- list_by_proveedor: filters deleted_at IS NULL by default; FIFO-order list
  consumed by FacturaService (C-08 contract — MUST NOT regress).
- list_by_usuario: paginated, ordered fecha DESC / created_at DESC / id DESC;
  optional proveedor_id filter; excludes soft-deleted.
- get: returns row regardless of deleted_at.
- create: persists with all fields including origen=MANUAL.
- update: only applies provided fields.
- soft_delete: sets deleted_at; row preserved.
- user isolation: user B never sees user A's pagos in any listing.
- Soft-deleted pagos are excluded from list_by_proveedor (C-08 FIFO contract).
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
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
        email=f"repo_pago_{uuid.uuid4().hex[:8]}@test.com",
        nombre="Repo Pago Test",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    )
    session.add(u)
    session.flush()
    return u


def _make_proveedor(session: Session, usuario_id: uuid.UUID):
    from app.models.proveedor import Proveedor
    from app.core.uuid_utils import new_uuid
    from app.models.enums import CategoriaProveedor

    p = Proveedor(
        id=new_uuid(),
        usuario_id=usuario_id,
        nombre=f"Prov {uuid.uuid4().hex[:6]}",
        categoria=CategoriaProveedor.OTRO,
    )
    session.add(p)
    session.flush()
    return p


def _make_pago(
    session: Session,
    usuario_id: uuid.UUID,
    proveedor_id: uuid.UUID,
    monto: Decimal = Decimal("100.00"),
    fecha: date | None = None,
    deleted: bool = False,
) -> "Pago":
    from app.models.pago import Pago
    from app.core.uuid_utils import new_uuid
    from app.models.enums import MetodoPago, OrigenDocumento

    p = Pago(
        id=new_uuid(),
        usuario_id=usuario_id,
        proveedor_id=proveedor_id,
        monto=monto,
        fecha=fecha or date.today(),
        metodo=MetodoPago.EFECTIVO,
        origen=OrigenDocumento.MANUAL,
    )
    if deleted:
        p.deleted_at = datetime.now(timezone.utc)
    session.add(p)
    session.flush()
    return p


# ── list_by_proveedor (existing C-06 contract) ────────────────────────────────


class TestListByProveedor:
    def test_returns_active_pagos_ordered_chronologically(self, session: Session):
        """Existing C-06 contract: list_by_proveedor returns active pagos
        in fecha ASC for FIFO allocation. MUST NOT regress (C-08 FIFO consumer
        relies on it)."""
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        today = date.today()
        yesterday = today - timedelta(days=1)
        _make_pago(session, u.id, p.id, Decimal("100.00"), fecha=yesterday)
        _make_pago(session, u.id, p.id, Decimal("200.00"), fecha=today)
        session.commit()

        repo = PagoRepository(session)
        results = repo.list_by_proveedor(u.id, p.id)

        assert len(results) == 2
        # fecha ASC: yesterday comes first
        assert results[0].fecha == yesterday
        assert results[1].fecha == today

    def test_excludes_soft_deleted_by_default(self, session: Session):
        """C-08 FIFO contract: list_by_proveedor MUST exclude soft-deleted pagos."""
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        active = _make_pago(session, u.id, p.id, Decimal("100.00"))
        deleted = _make_pago(session, u.id, p.id, Decimal("200.00"), deleted=True)
        session.commit()

        repo = PagoRepository(session)
        results = repo.list_by_proveedor(u.id, p.id)

        ids = [r.id for r in results]
        assert active.id in ids
        assert deleted.id not in ids

    def test_include_deleted_true_returns_all(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        active = _make_pago(session, u.id, p.id, Decimal("100.00"))
        deleted = _make_pago(session, u.id, p.id, Decimal("200.00"), deleted=True)
        session.commit()

        repo = PagoRepository(session)
        results = repo.list_by_proveedor(u.id, p.id, include_deleted=True)

        ids = [r.id for r in results]
        assert active.id in ids
        assert deleted.id in ids

    def test_user_isolation(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.id)
        p_b = _make_proveedor(session, u_b.id)

        pago_a = _make_pago(session, u_a.id, p_a.id, Decimal("100.00"))
        pago_b = _make_pago(session, u_b.id, p_b.id, Decimal("200.00"))
        session.commit()

        repo = PagoRepository(session)
        # User A asks for their proveedor — should only get pago_a
        results_a = repo.list_by_proveedor(u_a.id, p_a.id)
        ids_a = [r.id for r in results_a]
        assert pago_a.id in ids_a
        assert pago_b.id not in ids_a


# ── list_by_usuario (new in C-10) ─────────────────────────────────────────────


class TestListByUsuario:
    def test_returns_paginated_active_pagos(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        for i in range(3):
            _make_pago(session, u.id, p.id, Decimal(f"{(i+1)*100}.00"))
        session.commit()

        repo = PagoRepository(session)
        items, total = repo.list_by_usuario(u.id, page=1, page_size=10)

        assert total == 3
        assert len(items) == 3

    def test_excludes_soft_deleted(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        active = _make_pago(session, u.id, p.id, Decimal("100.00"))
        deleted = _make_pago(session, u.id, p.id, Decimal("200.00"), deleted=True)
        session.commit()

        repo = PagoRepository(session)
        items, total = repo.list_by_usuario(u.id)

        ids = [r.id for r in items]
        assert active.id in ids
        assert deleted.id not in ids
        assert total == 1

    def test_ordered_fecha_desc(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        old = _make_pago(session, u.id, p.id, Decimal("100.00"), fecha=date(2024, 1, 1))
        new = _make_pago(session, u.id, p.id, Decimal("200.00"), fecha=date(2024, 12, 1))
        session.commit()

        repo = PagoRepository(session)
        items, _ = repo.list_by_usuario(u.id)

        ids = [r.id for r in items]
        assert ids.index(new.id) < ids.index(old.id)

    def test_filters_by_proveedor_id(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p1 = _make_proveedor(session, u.id)
        p2 = _make_proveedor(session, u.id)

        pago_p1 = _make_pago(session, u.id, p1.id, Decimal("100.00"))
        pago_p2 = _make_pago(session, u.id, p2.id, Decimal("200.00"))
        session.commit()

        repo = PagoRepository(session)
        items, total = repo.list_by_usuario(u.id, proveedor_id=p1.id)

        ids = [r.id for r in items]
        assert pago_p1.id in ids
        assert pago_p2.id not in ids
        assert total == 1

    def test_pagination(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        for i in range(5):
            _make_pago(
                session,
                u.id,
                p.id,
                Decimal(f"{(i+1)*100}.00"),
                fecha=date(2024, 1, i + 1),
            )
        session.commit()

        repo = PagoRepository(session)
        page1, total = repo.list_by_usuario(u.id, page=1, page_size=2)
        page2, _ = repo.list_by_usuario(u.id, page=2, page_size=2)

        assert total == 5
        assert len(page1) == 2
        assert len(page2) == 2
        # Pages don't overlap
        ids_p1 = {r.id for r in page1}
        ids_p2 = {r.id for r in page2}
        assert ids_p1.isdisjoint(ids_p2)

    def test_user_isolation(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u_a = _make_usuario(session)
        u_b = _make_usuario(session)
        p_a = _make_proveedor(session, u_a.id)
        p_b = _make_proveedor(session, u_b.id)

        pago_a = _make_pago(session, u_a.id, p_a.id, Decimal("100.00"))
        pago_b = _make_pago(session, u_b.id, p_b.id, Decimal("200.00"))
        session.commit()

        repo = PagoRepository(session)
        items_b, total_b = repo.list_by_usuario(u_b.id)

        ids_b = [r.id for r in items_b]
        assert pago_a.id not in ids_b
        assert pago_b.id in ids_b
        assert total_b == 1


# ── get ───────────────────────────────────────────────────────────────────────


class TestGet:
    def test_returns_row_regardless_of_deleted(self, session: Session):
        """get() returns the row even if soft-deleted — caller decides."""
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        deleted = _make_pago(session, u.id, p.id, Decimal("100.00"), deleted=True)
        session.commit()

        repo = PagoRepository(session)
        result = repo.get(deleted.id)

        assert result is not None
        assert result.id == deleted.id
        assert result.deleted_at is not None

    def test_returns_none_for_nonexistent(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        repo = PagoRepository(session)
        result = repo.get(uuid.uuid4())
        assert result is None


# ── create ────────────────────────────────────────────────────────────────────


class TestCreate:
    def test_creates_pago_with_origen_manual(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        repo = PagoRepository(session)
        pago = repo.create(
            usuario_id=u.id,
            proveedor_id=p.id,
            monto=Decimal("500.00"),
            fecha=date(2024, 6, 15),
            metodo="TRANSFERENCIA",
            comprobante_url="https://example.com/x.pdf",
            origen="MANUAL",
        )
        session.commit()

        assert pago.id is not None
        assert pago.usuario_id == u.id
        assert pago.proveedor_id == p.id
        assert pago.monto == Decimal("500.00")
        assert pago.metodo.value == "TRANSFERENCIA"
        assert pago.origen.value == "MANUAL"
        assert pago.deleted_at is None

    def test_creates_pago_without_comprobante(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)

        repo = PagoRepository(session)
        pago = repo.create(
            usuario_id=u.id,
            proveedor_id=p.id,
            monto=Decimal("100.00"),
            fecha=date.today(),
            metodo="EFECTIVO",
            origen="MANUAL",
        )
        session.commit()

        assert pago.comprobante_url is None


# ── update ────────────────────────────────────────────────────────────────────


class TestUpdate:
    def test_updates_only_provided_fields(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        repo = PagoRepository(session)
        updated = repo.update(
            pago,
            monto=Decimal("500.00"),
            comprobante_url="https://example.com/y.pdf",
        )
        session.commit()

        assert updated.monto == Decimal("500.00")
        assert updated.comprobante_url == "https://example.com/y.pdf"
        # Other fields untouched
        assert updated.metodo.value == "EFECTIVO"
        assert updated.fecha == pago.fecha


# ── soft_delete ──────────────────────────────────────────────────────────────


class TestSoftDelete:
    def test_soft_delete_sets_deleted_at(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        repo = PagoRepository(session)
        repo.soft_delete(pago.id)
        session.commit()

        session.refresh(pago)
        assert pago.deleted_at is not None

    def test_soft_delete_preserves_row(self, session: Session):
        """The row stays in the DB after soft delete (FK integrity)."""
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.id)
        pago = _make_pago(session, u.id, p.id, Decimal("100.00"))
        session.commit()

        repo = PagoRepository(session)
        repo.soft_delete(pago.id)
        session.commit()

        # Row still present (get returns it)
        result = repo.get(pago.id)
        assert result is not None
        assert result.deleted_at is not None

    def test_soft_delete_nonexistent_returns_none(self, session: Session):
        from app.repositories.pago_repository import PagoRepository

        repo = PagoRepository(session)
        result = repo.soft_delete(uuid.uuid4())
        assert result is None
