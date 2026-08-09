"""
Regression tests for c-18 FE-005 backend:
PagoResponse includes proveedor_nombre populated by the service.

The new optional field is populated when the related Proveedor is
active and None when the proveedor is soft-deleted (per RN-PROV-04:
the pago remains valid after the supplier is soft-deleted).
"""

import uuid
from datetime import date
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
        email=f"fe005_{uuid.uuid4().hex[:8]}@test.com",
        nombre="FE-005 test",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    )
    session.add(u)
    session.flush()
    return u


def _make_proveedor(session: Session, negocio_id: uuid.UUID, nombre: str = "YPF S.A."):
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


def _make_pago_db(
    session: Session,
    negocio_id: uuid.UUID,
    proveedor_id: uuid.UUID,
    monto: Decimal = Decimal("100.00"),
):
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


# ── Schema field is declared ────────────────────────────────────────────────


class TestPagoResponseSchema:
    def test_proveedor_nombre_field_exists_on_schema(self):
        """The PagoResponse schema declares the proveedor_nombre field."""
        from app.schemas.pago import PagoResponse

        fields = PagoResponse.model_fields
        assert "proveedor_nombre" in fields
        # Optional with default None
        assert fields["proveedor_nombre"].default is None

    def test_proveedor_nombre_defaults_to_none_when_omitted(self):
        """Backward compat: a PagoResponse constructed without the new
        field still validates (default = None)."""
        from app.schemas.pago import PagoResponse

        r = PagoResponse(
            id=uuid.uuid4(),
            negocio_id=uuid.uuid4(),
            proveedor_id=uuid.uuid4(),
            monto=Decimal("100.00"),
            fecha=date.today(),
            metodo="EFECTIVO",
            comprobante_url=None,
            origen="MANUAL",
            created_at=__import__("datetime").datetime.now(),
            updated_at=__import__("datetime").datetime.now(),
        )
        assert r.proveedor_nombre is None


# ── Service populates proveedor_nombre on get / crear / listar ─────────────


class TestServicePopulatesProveedorNombre:
    def test_get_returns_proveedor_nombre_when_supplier_active(self, session: Session):
        """PagoResponse from service.get() includes the supplier's nombre
        when the supplier is active (not soft-deleted)."""
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoResponse
        from app.routers.pagos import _to_response, _resolve_proveedor_nombre

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id, nombre="YPF S.A.")
        pago = _make_pago_db(session, u.negocio_id, p.id, Decimal("100.00"))
        session.commit()

        svc = PagoService(session)
        result = svc.get(u.negocio_id, pago.id)
        proveedor_nombre = _resolve_proveedor_nombre(session, result.proveedor_id)
        response = _to_response(result, proveedor_nombre=proveedor_nombre)

        assert isinstance(response, PagoResponse)
        assert response.proveedor_nombre == "YPF S.A."

    def test_get_returns_none_when_supplier_soft_deleted(self, session: Session):
        """When the related Proveedor is soft-deleted, the response
        carries proveedor_nombre=None (per RN-PROV-04, the pago
        remains valid; the supplier's absence is informational)."""
        from datetime import datetime, timezone
        from app.services.pago_service import PagoService
        from app.routers.pagos import _to_response, _resolve_proveedor_nombre

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id, nombre="YPF S.A.")
        # Soft-delete the supplier AFTER the pago exists (the order is
        # important: the pago references the supplier, then the
        # supplier is soft-deleted).
        pago = _make_pago_db(session, u.negocio_id, p.id, Decimal("100.00"))
        session.commit()
        p.deleted_at = datetime.now(timezone.utc)
        session.commit()
        session.refresh(p)

        svc = PagoService(session)
        result = svc.get(u.negocio_id, pago.id)
        proveedor_nombre = _resolve_proveedor_nombre(session, result.proveedor_id)
        response = _to_response(result, proveedor_nombre=proveedor_nombre)

        assert response.proveedor_nombre is None

    def test_resolve_returns_none_for_nonexistent_supplier(self, session: Session):
        """_resolve_proveedor_nombre returns None for an unknown id."""
        from app.routers.pagos import _resolve_proveedor_nombre

        result = _resolve_proveedor_nombre(session, uuid.uuid4())
        assert result is None

    def test_crear_pago_populates_proveedor_nombre(self, session: Session):
        """POST /api/pagos response (via service.crear + _to_response)
        includes the supplier's name when the supplier is active."""
        from app.services.pago_service import PagoService
        from app.schemas.pago import PagoCreate
        from app.routers.pagos import _to_response, _resolve_proveedor_nombre

        u = _make_usuario(session)
        p = _make_proveedor(session, u.negocio_id, nombre="Petrobras Argentina")
        session.commit()

        svc = PagoService(session)
        pago = svc.crear(u.negocio_id,
            PagoCreate(
                proveedor_id=p.id,
                monto=Decimal("200.00"),
                fecha=date.today(),
                metodo="TRANSFERENCIA",
            ),
        )
        session.commit()
        session.refresh(pago)
        proveedor_nombre = _resolve_proveedor_nombre(session, pago.proveedor_id)
        response = _to_response(pago, proveedor_nombre=proveedor_nombre)

        assert response.proveedor_nombre == "Petrobras Argentina"
