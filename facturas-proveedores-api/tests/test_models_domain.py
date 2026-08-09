"""
Integration tests for domain models against real PostgreSQL (testcontainers).

TDD RED phase: covers tasks 2.2, 3.2, 4.3, 5.2.

Tests use the pg_container / db_url / env_vars fixtures from conftest.py.
"""

import uuid
from decimal import Decimal
from datetime import date

import pytest
from sqlmodel import Session, create_engine, SQLModel
from sqlalchemy.exc import IntegrityError

# Import all models so SQLModel registers their metadata
import app.models  # noqa: F401 — triggers __init__.py which registers all tables

from tests.conftest import crear_negocio



# ── Engine / Session fixtures ──────────────────────────────────────────────────

@pytest.fixture(scope="module")
def engine(db_url: str):
    """Real Postgres engine via testcontainers (regla dura #9)."""
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    SQLModel.metadata.drop_all(eng)


@pytest.fixture
def session(engine):
    """Function-scoped session — rolls back after each test for isolation."""
    with Session(engine) as s:
        yield s
        s.rollback()


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_usuario(session, suffix: str = "") -> "app.models.Usuario":
    from app.models.usuario import Usuario
    from tests.conftest import crear_negocio

    return Usuario(
        negocio_id=crear_negocio(session).id,
        email=f"test{suffix}@example.com",
        nombre=f"Test User {suffix}",
        password_hash="hashed_pw",
    )


def make_proveedor(negocio_id: uuid.UUID, nombre: str = "Acme") -> "app.models.Proveedor":
    from app.models.proveedor import Proveedor
    return Proveedor(negocio_id=negocio_id, nombre=nombre)


def make_factura(negocio_id: uuid.UUID, proveedor_id: uuid.UUID) -> "app.models.Factura":
    from app.models.factura import Factura
    from app.models.enums import OrigenDocumento
    return Factura(
        negocio_id=negocio_id,
        proveedor_id=proveedor_id,
        fecha_emision=date(2024, 1, 15),
        monto_total=Decimal("1500.50"),
        origen=OrigenDocumento.MANUAL,
    )


# ── Task 2.2: Usuario ─────────────────────────────────────────────────────────

def test_usuario_email_unique_constraint(session: Session):
    """Spec: second Usuario with same email must be rejected by DB uniqueness."""
    from app.models.usuario import Usuario

    u1 = Usuario(negocio_id=crear_negocio(session).id, email="dup@test.com", nombre="First", password_hash="h1")
    u2 = Usuario(negocio_id=crear_negocio(session).id, email="dup@test.com", nombre="Second", password_hash="h2")
    session.add(u1)
    session.flush()  # send to DB without commit

    session.add(u2)
    with pytest.raises(IntegrityError):
        session.flush()


def test_usuario_optional_fields_accept_null(session: Session):
    """Spec: telefono, avatar_url, nombre_negocio can be null."""
    from app.models.usuario import Usuario

    u = Usuario(negocio_id=crear_negocio(session).id, email="nulls@test.com", nombre="Nulls", password_hash="h")
    session.add(u)
    session.commit()
    session.refresh(u)

    assert u.telefono is None
    assert u.avatar_url is None
    assert u.nombre_negocio is None


def test_usuario_tema_preferido_defaults_to_claro(session: Session):
    """Spec: tema_preferido defaults to CLARO when not specified."""
    from app.models.usuario import Usuario
    from app.models.enums import TemaPreferido

    u = Usuario(negocio_id=crear_negocio(session).id, email="tema@test.com", nombre="Tema User", password_hash="h")
    session.add(u)
    session.commit()
    session.refresh(u)

    assert u.tema_preferido == TemaPreferido.CLARO


def test_usuario_has_no_deleted_at():
    """Spec: Usuario must NOT have deleted_at.

    C-28 (D-32) keeps this true and adds `desactivado` instead: revoking access
    is not deleting the row. In-memory only — no tenant row needed.
    """
    from app.models.usuario import Usuario

    u = Usuario(
        negocio_id=uuid.uuid4(),
        email="nodelete@test.com",
        nombre="NoDelete",
        password_hash="h",
    )
    assert not hasattr(u, "deleted_at")
    assert u.desactivado is False


# ── Task 3.2: Proveedor ───────────────────────────────────────────────────────

def test_proveedor_nombre_not_unique(session: Session):
    """Spec: two suppliers with same nombre for same user must be accepted."""
    u = make_usuario(session, "prv1")
    session.add(u)
    session.flush()

    p1 = make_proveedor(u.negocio_id, nombre="Duplicate Name")
    p2 = make_proveedor(u.negocio_id, nombre="Duplicate Name")
    session.add(p1)
    session.add(p2)
    session.commit()  # must NOT raise IntegrityError

    assert p1.id != p2.id


def test_proveedor_categoria_defaults_to_otro(session: Session):
    """Spec: categoria defaults to OTRO when not specified."""
    from app.models.enums import CategoriaProveedor

    u = make_usuario(session, "prv2")
    session.add(u)
    session.flush()

    p = make_proveedor(u.negocio_id)
    session.add(p)
    session.commit()
    session.refresh(p)

    assert p.categoria == CategoriaProveedor.OTRO


def test_proveedor_deleted_at_is_null_by_default(session: Session):
    """Spec: Proveedor starts with deleted_at = null (active)."""
    u = make_usuario(session, "prv3")
    session.add(u)
    session.flush()

    p = make_proveedor(u.negocio_id)
    session.add(p)
    session.commit()
    session.refresh(p)

    assert p.deleted_at is None


# ── Task 4.3: Factura and FacturaItem ────────────────────────────────────────

def test_factura_has_usuario_id_and_proveedor_id(session: Session):
    """Spec: Factura has both usuario_id (denormalized) and proveedor_id."""
    from app.models.factura import Factura

    u = make_usuario(session, "fac1")
    session.add(u)
    session.flush()
    p = make_proveedor(u.negocio_id)
    session.add(p)
    session.flush()

    f = make_factura(u.negocio_id, p.id)
    session.add(f)
    session.commit()
    session.refresh(f)

    assert f.negocio_id == u.negocio_id
    assert f.proveedor_id == p.id


def test_factura_schema_has_no_estado_column():
    """Spec: Factura model must NOT have an 'estado' field (D-01, D-C02-6)."""
    from app.models.factura import Factura

    f = Factura.__table__
    column_names = {c.name for c in f.columns}
    assert "estado" not in column_names
    assert "saldo" not in column_names


def test_factura_monto_total_preserves_two_decimals(session: Session):
    """Spec: monto_total stored as numeric(12,2) preserving two decimal places."""
    u = make_usuario(session, "fac2")
    session.add(u)
    session.flush()
    p = make_proveedor(u.negocio_id)
    session.add(p)
    session.flush()

    from app.models.factura import Factura
    from app.models.enums import OrigenDocumento
    f = Factura(
        negocio_id=u.negocio_id,
        proveedor_id=p.id,
        fecha_emision=date(2024, 3, 1),
        monto_total=Decimal("999.99"),
        origen=OrigenDocumento.MANUAL,
    )
    session.add(f)
    session.commit()
    session.refresh(f)

    assert f.monto_total == Decimal("999.99")


def test_factura_item_cantidad_admits_decimals(session: Session):
    """Spec: FacturaItem.cantidad must support decimal values (e.g. 2.5)."""
    u = make_usuario(session, "fac3")
    session.add(u)
    session.flush()
    p = make_proveedor(u.negocio_id)
    session.add(p)
    session.flush()

    f = make_factura(u.negocio_id, p.id)
    session.add(f)
    session.flush()

    from app.models.factura import FacturaItem
    item = FacturaItem(
        factura_id=f.id,
        descripcion="Harina x kg",
        cantidad=Decimal("2.5"),
        precio_unitario=Decimal("150.00"),
    )
    session.add(item)
    session.commit()
    session.refresh(item)

    assert item.cantidad == Decimal("2.5")


def test_factura_item_has_no_deleted_at():
    """Spec: FacturaItem must NOT have deleted_at (lifecycle follows Factura)."""
    from app.models.factura import FacturaItem

    fi_table = FacturaItem.__table__
    column_names = {c.name for c in fi_table.columns}
    assert "deleted_at" not in column_names


# ── Task 5.2: Pago ────────────────────────────────────────────────────────────

def test_pago_schema_has_no_factura_id():
    """Spec: Pago must NOT have factura_id column (RN-PAG-01, D-02)."""
    from app.models.pago import Pago

    pago_table = Pago.__table__
    column_names = {c.name for c in pago_table.columns}
    assert "factura_id" not in column_names


def test_pago_persisted_linked_only_to_proveedor(session: Session):
    """Spec: Pago persists with usuario_id and proveedor_id, without factura reference."""
    from app.models.pago import Pago
    from app.models.enums import MetodoPago, OrigenDocumento

    u = make_usuario(session, "pag1")
    session.add(u)
    session.flush()
    p = make_proveedor(u.negocio_id)
    session.add(p)
    session.flush()

    pago = Pago(
        negocio_id=u.negocio_id,
        proveedor_id=p.id,
        monto=Decimal("500.00"),
        fecha=date(2024, 2, 10),
        metodo=MetodoPago.TRANSFERENCIA,
        origen=OrigenDocumento.MANUAL,
    )
    session.add(pago)
    session.commit()
    session.refresh(pago)

    assert pago.id is not None
    assert pago.negocio_id == u.negocio_id
    assert pago.proveedor_id == p.id
    assert not hasattr(pago, "factura_id") or "factura_id" not in {c.name for c in Pago.__table__.columns}


def test_pago_monto_is_decimal_numeric(session: Session):
    """Edge case: monto stored as numeric(12,2), not float."""
    from app.models.pago import Pago
    from app.models.enums import MetodoPago, OrigenDocumento

    u = make_usuario(session, "pag2")
    session.add(u)
    session.flush()
    p = make_proveedor(u.negocio_id)
    session.add(p)
    session.flush()

    pago = Pago(
        negocio_id=u.negocio_id,
        proveedor_id=p.id,
        monto=Decimal("1234.56"),
        fecha=date(2024, 5, 20),
        metodo=MetodoPago.EFECTIVO,
        origen=OrigenDocumento.MANUAL,
    )
    session.add(pago)
    session.commit()
    session.refresh(pago)

    assert pago.monto == Decimal("1234.56")
