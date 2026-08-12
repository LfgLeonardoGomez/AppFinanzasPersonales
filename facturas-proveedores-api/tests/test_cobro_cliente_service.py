"""
Tests for `CobroClienteService` — payment CRUD and the no-negative-balance
rule (RN-CCC-04, D3, D8). Task 6.1-6.8.

Service-layer tests against real Postgres (testcontainers).
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401

from tests.conftest import crear_negocio


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


def _usuario(session: Session, negocio_id: uuid.UUID):
    from app.models.usuario import Usuario
    from app.core.uuid_utils import new_uuid

    u = Usuario(
        negocio_id=negocio_id,
        id=new_uuid(),
        email=f"cobro_{uuid.uuid4().hex[:8]}@test.com",
        nombre="Cobro Test",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    )
    session.add(u)
    session.flush()
    return u


def _cliente(session: Session, negocio_id: uuid.UUID):
    from app.models.cliente import Cliente

    c = Cliente(
        negocio_id=negocio_id,
        nombre="Cliente Test",
        nombre_normalizado=f"cliente {uuid.uuid4().hex[:8]}",
    )
    session.add(c)
    session.flush()
    return c


def _fiado(session: Session, negocio_id: uuid.UUID, cliente_id: uuid.UUID, monto: Decimal, fecha: date):
    from app.models.venta import Venta
    from app.models.enums import FormaPago

    v = Venta(
        negocio_id=negocio_id,
        cliente_id=cliente_id,
        monto=monto,
        fecha=fecha,
        forma_pago=FormaPago.CUENTA_CORRIENTE,
    )
    session.add(v)
    session.flush()
    return v


def _make_create(**overrides):
    from app.schemas.cobro_cliente import CobroClienteCreate
    from app.models.enums import MetodoCobro

    payload = {
        "cliente_id": uuid.uuid4(),
        "monto": Decimal("100.00"),
        "fecha": date.today(),
        "metodo": MetodoCobro.EFECTIVO,
    }
    payload.update(overrides)
    return CobroClienteCreate(**payload)


class TestCrear:
    def test_persiste_con_negocio_y_autoria(self, session: Session):
        from app.services.cobro_cliente_service import CobroClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        autor = _usuario(session, negocio.id)
        session.commit()

        svc = CobroClienteService(session)
        cobro = svc.crear(
            negocio.id,
            _make_create(cliente_id=cliente.id, monto=Decimal("300.00")),
            creado_por_usuario_id=autor.id,
        )

        assert cobro.negocio_id == negocio.id
        assert cobro.cliente_id == cliente.id
        assert cobro.creado_por_usuario_id == autor.id

    def test_cliente_de_otro_negocio_da_404(self, session: Session):
        from app.services.cobro_cliente_service import CobroClienteService

        negocio_a = crear_negocio(session)
        negocio_b = crear_negocio(session)
        cliente_b = _cliente(session, negocio_b.id)
        session.commit()

        svc = CobroClienteService(session)
        with pytest.raises(HTTPException) as exc:
            svc.crear(negocio_a.id, _make_create(cliente_id=cliente_b.id))
        assert exc.value.status_code == 404


class TestValidacionMontoFecha:
    def test_monto_no_positivo_rechazado_en_servicio(self, session: Session):
        """Defense in depth beyond Pydantic (which already rejects monto<=0)."""
        from app.services.cobro_cliente_service import CobroClienteService
        from app.services.cobro_cliente_service import _NON_POSITIVE_MONTO

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        session.commit()

        svc = CobroClienteService(session)
        datos = _make_create(cliente_id=cliente.id, monto=Decimal("100.00"))
        # Simulate a bypass of Pydantic Field(gt=0) by mutating post-validation.
        object.__setattr__(datos, "monto", Decimal("-5.00"))

        with pytest.raises(HTTPException) as exc:
            svc.crear(negocio.id, datos)
        assert exc.value.status_code == 422

    def test_fecha_futura_rechazada(self, session: Session):
        from app.services.cobro_cliente_service import CobroClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        session.commit()

        svc = CobroClienteService(session)
        manana = datetime.now(timezone.utc).date() + timedelta(days=2)
        with pytest.raises(HTTPException) as exc:
            svc.crear(negocio.id, _make_create(cliente_id=cliente.id, fecha=manana))
        assert exc.value.status_code == 422


class TestRnCcc04:
    """The headline rule: a payment can never push the balance below zero."""

    def test_pago_igual_al_saldo_aceptado(self, session: Session):
        from app.services.cobro_cliente_service import CobroClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        session.commit()

        svc = CobroClienteService(session)
        cobro = svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("1000.00")))
        assert cobro.monto == Decimal("1000.00")

    def test_pago_superior_al_saldo_rechazado_con_mensaje(self, session: Session):
        from app.services.cobro_cliente_service import CobroClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        session.commit()

        svc = CobroClienteService(session)
        with pytest.raises(HTTPException) as exc:
            svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("1500.00")))

        assert exc.value.status_code == 422
        # Message states the outstanding balance so it can be corrected.
        assert "1000" in str(exc.value.detail)

    def test_pago_sin_fiados_rechazado(self, session: Session):
        """Task 6.4 triangulate: a customer with no live fiados has no balance."""
        from app.services.cobro_cliente_service import CobroClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        session.commit()

        svc = CobroClienteService(session)
        with pytest.raises(HTTPException) as exc:
            svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("1.00")))
        assert exc.value.status_code == 422

    def test_segundo_pago_que_excede_lo_restante_rechazado(self, session: Session):
        """Task 6.4 triangulate: the first payment succeeds, the second, which
        would exceed what's LEFT of the balance, is rejected."""
        from app.services.cobro_cliente_service import CobroClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        session.commit()

        svc = CobroClienteService(session)
        svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("700.00")))
        session.commit()

        with pytest.raises(HTTPException) as exc:
            svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("500.00")))
        assert exc.value.status_code == 422
        assert "300" in str(exc.value.detail)


class TestD3ExclusionEnEdicion:
    """The clause that makes editing possible at all."""

    def test_subir_un_pago_existente_dentro_del_saldo_es_aceptado(self, session: Session):
        """
        fiados=1000, un solo cobro de 400, se sube a 900.

        Elegido a propósito por encima de 600 (= 1000 - 400): sin la exclusión
        de D3, el disponible se calcularía como 1000 - 400 = 600 y esta edición
        se rechazaría por error. Con la exclusión correcta, el disponible es
        1000 (el propio cobro no cuenta contra sí mismo) y 900 <= 1000 se acepta.
        Un valor de 600 no distingue entre ambos comportamientos porque
        coincide justo con el límite — ver hallazgo de la verificación por
        mutación (task 10.2).
        """
        from app.services.cobro_cliente_service import CobroClienteService
        from app.schemas.cobro_cliente import CobroClienteUpdate

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        session.commit()

        svc = CobroClienteService(session)
        cobro = svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("400.00")))
        session.commit()

        actualizado = svc.actualizar(
            negocio.id, cobro.id, CobroClienteUpdate(monto=Decimal("900.00"))
        )
        assert actualizado.monto == Decimal("900.00")

    def test_subir_un_pago_mas_alla_de_lo_cobrable_es_rechazado_y_no_cambia(self, session: Session):
        from app.services.cobro_cliente_service import CobroClienteService
        from app.schemas.cobro_cliente import CobroClienteUpdate

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        session.commit()

        svc = CobroClienteService(session)
        cobro = svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("400.00")))
        session.commit()

        with pytest.raises(HTTPException) as exc:
            svc.actualizar(negocio.id, cobro.id, CobroClienteUpdate(monto=Decimal("1200.00")))
        assert exc.value.status_code == 422

        session.refresh(cobro)
        assert cobro.monto == Decimal("400.00")


class TestD8ClienteInmutable:
    def test_cliente_id_no_es_modificable_por_schema(self):
        """CobroClienteUpdate simply has no cliente_id field, and forbids extras."""
        from app.schemas.cobro_cliente import CobroClienteUpdate
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            CobroClienteUpdate(cliente_id=str(uuid.uuid4()))

    def test_otros_campos_se_actualizan_normalmente(self, session: Session):
        from app.services.cobro_cliente_service import CobroClienteService
        from app.schemas.cobro_cliente import CobroClienteUpdate
        from app.models.enums import MetodoCobro

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        session.commit()

        svc = CobroClienteService(session)
        cobro = svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("100.00")))
        session.commit()

        actualizado = svc.actualizar(
            negocio.id, cobro.id, CobroClienteUpdate(metodo=MetodoCobro.TRANSFERENCIA)
        )
        assert actualizado.metodo == MetodoCobro.TRANSFERENCIA
        assert actualizado.cliente_id == cliente.id


class TestEliminar:
    def test_es_soft_delete_y_deja_de_contar(self, session: Session):
        from app.services.cobro_cliente_service import CobroClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        session.commit()

        svc = CobroClienteService(session)
        cobro = svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("400.00")))
        session.commit()

        svc.eliminar(negocio.id, cobro.id)
        session.commit()

        from app.repositories.cobro_cliente_repository import CobroClienteRepository

        repo = CobroClienteRepository(session)
        assert repo.sumar_cobros_de_cliente(negocio.id, cliente.id) == Decimal("0.00")


class TestAislamiento:
    def test_cobro_de_otro_negocio_404_en_get_update_delete(self, session: Session):
        from app.services.cobro_cliente_service import CobroClienteService
        from app.schemas.cobro_cliente import CobroClienteUpdate

        negocio_a = crear_negocio(session)
        negocio_b = crear_negocio(session)
        cliente_b = _cliente(session, negocio_b.id)
        _fiado(session, negocio_b.id, cliente_b.id, Decimal("1000.00"), date.today())
        session.commit()

        svc = CobroClienteService(session)
        cobro_b = svc.crear(negocio_b.id, _make_create(cliente_id=cliente_b.id, monto=Decimal("100.00")))
        session.commit()

        with pytest.raises(HTTPException) as exc:
            svc.get(negocio_a.id, cobro_b.id)
        assert exc.value.status_code == 404

        with pytest.raises(HTTPException) as exc:
            svc.actualizar(negocio_a.id, cobro_b.id, CobroClienteUpdate(monto=Decimal("50.00")))
        assert exc.value.status_code == 404

        with pytest.raises(HTTPException) as exc:
            svc.eliminar(negocio_a.id, cobro_b.id)
        assert exc.value.status_code == 404
