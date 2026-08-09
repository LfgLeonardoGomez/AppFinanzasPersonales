"""
Regression tests for c-18 MED-004: deterministic ordering tiebreak on id.

The `PagoRepository.list_by_proveedor` and `ProveedorRepository.list_by_negocio`
order by columns that can collide at the same wall-clock resolution
(fecha + created_at, or func.lower(nombre) for case-insensitive matches).
Adding `id` as the final tiebreak makes the order deterministic across
runs — important for the c-08 FIFO pool algorithm, which expects a
stable input order.
"""
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401 — register all SQLModel tables

from tests.conftest import crear_negocio


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


def _make_usuario(session: Session):
    from app.models.usuario import Usuario
    from app.core.uuid_utils import new_uuid

    u = Usuario(
        negocio_id=crear_negocio(session).id,
        id=new_uuid(),
        email=f"med004_{uuid.uuid4().hex[:8]}@test.com",
        nombre="MED-004 test",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    )
    session.add(u)
    session.flush()
    return u


def _make_proveedor(session: Session, negocio_id: uuid.UUID, nombre: str = "YPF"):
    from app.models.proveedor import Proveedor
    from app.core.uuid_utils import new_uuid
    from app.models.enums import CategoriaProveedor

    p = Proveedor(
        id=new_uuid(),
        negocio_id=negocio_id,
        nombre=nombre,
        categoria=CategoriaProveedor.OTRO,
    )
    session.add(p)
    session.flush()
    return p


# ── PagoRepository: deterministic ordering on id when fecha/created_at collide ─


class TestPagoRepositoryTiebreak:
    def test_list_by_proveedor_orders_by_id_when_fecha_and_created_at_collide(
        self, session: Session
    ):
        """When 3 Pagos share the same fecha and created_at, the
        order_by(Pago.fecha, Pago.created_at, Pago.id) clause
        produces a deterministic order matching the id order."""
        from app.models.pago import Pago
        from app.core.uuid_utils import new_uuid
        from app.models.enums import MetodoPago, OrigenDocumento
        from app.repositories.pago_repository import PagoRepository

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id, nombre="YPF S.A.")

        # Force identical fecha and created_at on 3 pagos. We pick
        # explicit UUIDs so the expected order is unambiguous.
        shared_dt = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        shared_fecha = date(2026, 1, 1)
        pago_ids = [new_uuid() for _ in range(3)]
        # Insert them in REVERSE id order so the id-tiebreak must
        # actually re-sort them into the expected order.
        for pid in reversed(pago_ids):
            pago = Pago(
                id=pid,
                negocio_id=u.negocio_id,
                proveedor_id=p.id,
                monto=Decimal("100.00"),
                fecha=shared_fecha,
                metodo=MetodoPago.EFECTIVO,
                origen=OrigenDocumento.MANUAL,
            )
            pago.created_at = shared_dt
            session.add(pago)
        session.commit()

        repo = PagoRepository(session)
        results = repo.list_by_proveedor(u.negocio_id, p.id)
        result_ids = [r.id for r in results]

        # The expected order is sorted by id (ascending) — the id
        # tiebreak must override the insertion order.
        expected_ids = sorted(pago_ids)
        assert result_ids == expected_ids


# ── ProveedorRepository: deterministic ordering on id when nombres collide ──


class TestProveedorRepositoryTiebreak:
    def test_list_by_negocio_orders_by_id_when_nombre_collides_case_insensitive(
        self, session: Session
    ):
        """When 3 Proveedores share the same case-insensitive nombre
        (e.g., all 'YPF'), the order_by(func.lower(nombre).asc(),
        id.asc()) clause produces a deterministic order matching the
        id order."""
        from app.repositories.proveedor_repository import ProveedorRepository
        from app.core.uuid_utils import new_uuid

        u = _make_usuario(session)
        prov_ids = [new_uuid() for _ in range(3)]
        # Insert in reverse id order
        for pid in reversed(prov_ids):
            _make_proveedor(session, u.negocio_id, nombre="YPF")
            # Override the just-created proveedor's id to the one we picked
            from app.models.proveedor import Proveedor
            from sqlmodel import select
            stmt = select(Proveedor).where(Proveedor.negocio_id == u.negocio_id).order_by(Proveedor.created_at.desc()).limit(1)
            last = session.exec(stmt).one()
            last.id = pid
            session.flush()
        session.commit()

        repo = ProveedorRepository(session)
        results = repo.list_by_negocio(u.negocio_id, order_by="nombre")
        result_ids = [r.id for r in results]

        expected_ids = sorted(prov_ids)
        assert result_ids == expected_ids
