"""
C-29 — the invitation entity and the code that travels outside the system.

The code is handed over by WhatsApp or in person, so two things matter beyond
correctness: it must be dictatable without ambiguity, and a database leak must
not hand anyone a usable invitation. Hence a reduced alphabet and hash-only
persistence, the same criterion as refresh tokens (D-17).
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401 — register table metadata
from app.models.invitacion_empleado import InvitacionEmpleado
from app.models.usuario import Usuario
from tests.conftest import crear_negocio


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s
        s.rollback()


def _admin(session: Session) -> Usuario:
    negocio = crear_negocio(session, "Negocio de invitaciones")
    usuario = Usuario(
        negocio_id=negocio.id,
        es_admin=True,
        email=f"admin_{uuid.uuid4().hex[:10]}@test.com",
        nombre="Admin",
        password_hash="hash",
    )
    session.add(usuario)
    session.flush()
    return usuario


class TestInvitacionModel:
    """Task 2.1 / 2.2."""

    def test_invitacion_persists_with_its_fields(self, session: Session):
        admin = _admin(session)
        expira = datetime.now(timezone.utc) + timedelta(hours=48)

        invitacion = InvitacionEmpleado(
            negocio_id=admin.negocio_id,
            codigo_hash="a" * 64,
            creado_por_usuario_id=admin.id,
            expira_en=expira,
        )
        session.add(invitacion)
        session.flush()

        assert invitacion.negocio_id == admin.negocio_id
        assert invitacion.creado_por_usuario_id == admin.id
        assert invitacion.usado_en is None
        assert invitacion.created_at is not None

    def test_codigo_hash_is_unique(self, session: Session):
        admin = _admin(session)
        expira = datetime.now(timezone.utc) + timedelta(hours=48)
        mismo_hash = "b" * 64

        for _ in range(2):
            session.add(
                InvitacionEmpleado(
                    negocio_id=admin.negocio_id,
                    codigo_hash=mismo_hash,
                    creado_por_usuario_id=admin.id,
                    expira_en=expira,
                )
            )

        with pytest.raises(IntegrityError):
            session.flush()

    def test_invitacion_has_no_soft_delete(self):
        """Lifecycle is usado_en / expira_en, not a UI deletion flag."""
        assert "deleted_at" not in InvitacionEmpleado.model_fields

    def test_usado_en_marks_consumption(self, session: Session):
        admin = _admin(session)
        invitacion = InvitacionEmpleado(
            negocio_id=admin.negocio_id,
            codigo_hash="c" * 64,
            creado_por_usuario_id=admin.id,
            expira_en=datetime.now(timezone.utc) + timedelta(hours=48),
        )
        session.add(invitacion)
        session.flush()

        invitacion.usado_en = datetime.now(timezone.utc)
        session.add(invitacion)
        session.flush()

        assert invitacion.usado_en is not None


class TestCodigoGeneration:
    """Task 3.1 / 3.2 — D2: dictatable, high-entropy, hash-only."""

    def test_codigo_has_the_agreed_shape(self):
        from app.core.security import generar_codigo_invitacion

        codigo, _ = generar_codigo_invitacion()

        assert len(codigo) == 8
        assert codigo == codigo.upper()

    def test_codigo_avoids_ambiguous_characters(self):
        """0/O and 1/I/L are indistinguishable when read aloud or handwritten."""
        from app.core.security import generar_codigo_invitacion

        prohibidos = set("01IOL")
        for _ in range(200):
            codigo, _ = generar_codigo_invitacion()
            assert not (set(codigo) & prohibidos), f"código ambiguo: {codigo}"

    def test_two_codes_differ(self):
        from app.core.security import generar_codigo_invitacion

        codigos = {generar_codigo_invitacion()[0] for _ in range(50)}
        assert len(codigos) > 45, "el generador repite demasiado"

    def test_returns_code_and_its_hash(self):
        from app.core.security import generar_codigo_invitacion, hash_codigo_invitacion

        codigo, codigo_hash = generar_codigo_invitacion()

        assert codigo_hash != codigo
        assert codigo_hash == hash_codigo_invitacion(codigo)
        assert len(codigo_hash) == 64  # sha256 hex

    def test_hashing_is_deterministic(self):
        from app.core.security import hash_codigo_invitacion

        assert hash_codigo_invitacion("ABCD2345") == hash_codigo_invitacion("ABCD2345")
        assert hash_codigo_invitacion("ABCD2345") != hash_codigo_invitacion("ABCD2346")

    def test_generator_does_not_use_the_random_module(self):
        """`random` is predictable from observed output; invitations need secrets."""
        import ast
        import inspect

        from app.core import security

        arbol = ast.parse(inspect.getsource(security))
        for nodo in ast.walk(arbol):
            if isinstance(nodo, ast.Attribute) and isinstance(nodo.value, ast.Name):
                assert not (
                    nodo.value.id == "random"
                ), "security.py usa `random`; para secretos va `secrets`"
