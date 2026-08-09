"""
C-28 — model-level contract for the negocio scoping axis.

These tests lock the shape of the new isolation axis (D-27):
- `Negocio` exists and carries the base mixin without soft delete.
- `Usuario` requires a `negocio_id` and gains `es_admin` / `desactivado`,
  while still having NO `deleted_at` (D-32: deactivation is access
  lifecycle, not row deletion).
- `Proveedor`, `Factura` and `Pago` scope by `negocio_id` and record
  authorship in `creado_por_usuario_id` — a field that must never be used
  to filter access (D4).
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine

from app.models.base import TimestampUUIDMixin
from app.models.enums import MetodoPago, OrigenDocumento
from app.models.factura import Factura
from app.models.negocio import Negocio
from app.models.pago import Pago
from app.models.proveedor import Proveedor
from app.models.usuario import Usuario

from tests.conftest import crear_negocio


@pytest.fixture(scope="module")
def engine(db_url: str):
    """Engine against the disposable Postgres (regla dura #9: never SQLite)."""
    eng = create_engine(db_url)
    SQLModel.metadata.create_all(eng)
    return eng


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s
        s.rollback()


def _make_negocio(session: Session, nombre: str = "Almacén Test") -> Negocio:
    negocio = Negocio(nombre=nombre)
    session.add(negocio)
    session.flush()
    return negocio


def _make_usuario(session: Session, negocio: Negocio, **overrides) -> Usuario:
    usuario = Usuario(
        negocio_id=negocio.id,
        email=f"user_{uuid.uuid4().hex[:10]}@test.com",
        nombre="Test User",
        password_hash="hash",
        **overrides,
    )
    session.add(usuario)
    session.flush()
    return usuario


class TestNegocioModel:
    """Task 2.1 — the Negocio entity itself."""

    def test_negocio_persists_with_base_mixin(self, session: Session):
        negocio = _make_negocio(session, "Panadería La Esquina")

        assert isinstance(negocio.id, uuid.UUID)
        assert negocio.nombre == "Panadería La Esquina"
        assert negocio.created_at is not None
        assert negocio.updated_at is not None

    def test_negocio_has_no_soft_delete(self):
        assert "deleted_at" not in Negocio.model_fields
        assert not hasattr(Negocio, "deleted_at")

    def test_negocio_uses_the_shared_base_mixin(self):
        assert issubclass(Negocio, TimestampUUIDMixin)


class TestUsuarioNegocioFields:
    """Task 2.3 — Usuario belongs to exactly one negocio."""

    def test_usuario_requires_negocio_id(self, session: Session):
        """A user with no negocio must be impossible — this one has NO tenant
        on purpose, so it must not be given one."""
        session.add(
            Usuario(
                email=f"orphan_{uuid.uuid4().hex[:8]}@test.com",
                nombre="Orphan",
                password_hash="hash",
            )
        )
        with pytest.raises(IntegrityError):
            session.flush()

    def test_es_admin_and_desactivado_default_to_false(self, session: Session):
        negocio = _make_negocio(session)
        usuario = _make_usuario(session, negocio)

        assert usuario.es_admin is False
        assert usuario.desactivado is False

    def test_flags_can_be_set_explicitly(self, session: Session):
        negocio = _make_negocio(session)
        usuario = _make_usuario(session, negocio, es_admin=True, desactivado=True)

        assert usuario.es_admin is True
        assert usuario.desactivado is True

    def test_usuario_still_has_no_deleted_at(self):
        """D-32: deactivation is NOT soft delete. The column must not appear."""
        assert "deleted_at" not in Usuario.model_fields
        assert "desactivado" in Usuario.model_fields

    def test_several_usuarios_share_one_negocio(self, session: Session):
        negocio = _make_negocio(session)
        primero = _make_usuario(session, negocio)
        segundo = _make_usuario(session, negocio)

        assert primero.negocio_id == segundo.negocio_id == negocio.id
        assert primero.id != segundo.id


class TestBusinessEntitiesScopeByNegocio:
    """Task 2.5 — the three business entities move to the negocio axis."""

    @pytest.mark.parametrize("model", [Proveedor, Factura, Pago])
    def test_entity_has_negocio_id_and_not_usuario_id(self, model):
        assert "negocio_id" in model.model_fields
        assert "usuario_id" not in model.model_fields

    @pytest.mark.parametrize("model", [Proveedor, Factura, Pago])
    def test_entity_records_authorship(self, model):
        assert "creado_por_usuario_id" in model.model_fields

    def test_proveedor_persists_on_the_negocio_axis(self, session: Session):
        negocio = _make_negocio(session)
        usuario = _make_usuario(session, negocio)

        proveedor = Proveedor(
            negocio_id=negocio.id,
            creado_por_usuario_id=usuario.id,
            nombre="Distribuidora Sur",
        )
        session.add(proveedor)
        session.flush()

        assert proveedor.negocio_id == negocio.id
        assert proveedor.creado_por_usuario_id == usuario.id

    def test_authorship_is_optional(self, session: Session):
        """D4: nullable on purpose — migrated rows and deleted authors must not break."""
        negocio = _make_negocio(session)

        proveedor = Proveedor(negocio_id=negocio.id, nombre="Sin autor")
        session.add(proveedor)
        session.flush()

        assert proveedor.creado_por_usuario_id is None

    def test_factura_and_pago_persist_on_the_negocio_axis(self, session: Session):
        negocio = _make_negocio(session)
        usuario = _make_usuario(session, negocio)
        proveedor = Proveedor(negocio_id=negocio.id, nombre="Proveedor X")
        session.add(proveedor)
        session.flush()

        factura = Factura(
            negocio_id=negocio.id,
            creado_por_usuario_id=usuario.id,
            proveedor_id=proveedor.id,
            fecha_emision=date(2026, 1, 15),
            monto_total=Decimal("1500.00"),
            origen=OrigenDocumento.MANUAL,
        )
        pago = Pago(
            negocio_id=negocio.id,
            creado_por_usuario_id=usuario.id,
            proveedor_id=proveedor.id,
            monto=Decimal("500.00"),
            fecha=date(2026, 1, 20),
            metodo=MetodoPago.EFECTIVO,
            origen=OrigenDocumento.MANUAL,
        )
        session.add(factura)
        session.add(pago)
        session.flush()

        assert factura.negocio_id == negocio.id
        assert pago.negocio_id == negocio.id

    def test_pago_still_has_no_factura_id(self):
        """RN-PAG-01 must survive the axis swap untouched."""
        assert "factura_id" not in Pago.model_fields

    def test_factura_still_has_no_estado_or_saldo(self):
        """D-01 must survive the axis swap untouched."""
        assert "estado" not in Factura.model_fields
        assert "saldo" not in Factura.model_fields
