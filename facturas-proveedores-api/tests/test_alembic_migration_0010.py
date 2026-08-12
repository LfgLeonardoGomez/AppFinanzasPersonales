"""
Tests for Alembic migration 0010 — venta (C-33).

Two things get proven here that a schema-shape test would miss:

1. **The chain still runs.** The first version of this migration created the
   `formapago` enum twice — once explicitly, once implicitly via `create_table`
   — and the second attempt had no `checkfirst`. That broke `upgrade head` for
   the whole project, and the symptom showed up in `test_refresh_token_model`,
   a file with nothing to do with sales. Enum types are database-wide objects,
   not table-scoped, so this class of mistake takes everything down with it.

2. **The CHECK actually rejects.** The constraint is the entire reason the
   invariant is trustworthy, so it is exercised against the database in both
   directions rather than merely inspected.

Revisions pinned ("0009", "0010") rather than head/-1, per D-21.
"""

import os
import subprocess
import sys
import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from testcontainers.postgres import PostgresContainer

API_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def migration_engine_0010():
    original_db_url = os.environ.get("DATABASE_URL")
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_10",
        password="mig_pass_10",
        dbname="test_migration_0010",
    ) as pg:
        url = pg.get_connection_url().replace("postgresql://", "postgresql+psycopg2://", 1)
        os.environ["DATABASE_URL"] = url
        engine = create_engine(url, echo=False)
        yield engine
        engine.dispose()
    if original_db_url is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = original_db_url


def _run_alembic(*args: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic"] + list(args),
        cwd=str(API_ROOT),
        capture_output=True,
        text=True,
        env=os.environ,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}"
        )


@pytest.fixture(scope="module")
def migrated(migration_engine_0010):
    _run_alembic("upgrade", "0010")
    return migration_engine_0010


def _negocio(conn) -> uuid.UUID:
    negocio_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO negocio (id, nombre, created_at, updated_at) "
            "VALUES (:id, 'Test', now(), now())"
        ),
        {"id": negocio_id},
    )
    return negocio_id


def _cliente(conn, negocio_id) -> uuid.UUID:
    cliente_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO cliente (id, negocio_id, nombre, nombre_normalizado, "
            "created_at, updated_at) VALUES (:id, :neg, 'X', :norm, now(), now())"
        ),
        {"id": cliente_id, "neg": negocio_id, "norm": f"x{uuid.uuid4().hex[:8]}"},
    )
    return cliente_id


def _insertar_venta(conn, negocio_id, forma_pago, cliente_id=None):
    conn.execute(
        text(
            "INSERT INTO venta (id, negocio_id, cliente_id, fecha, monto, "
            "forma_pago, created_at, updated_at) "
            "VALUES (:id, :neg, :cli, :f, 100.00, :fp, now(), now())"
        ),
        {
            "id": uuid.uuid4(),
            "neg": negocio_id,
            "cli": cliente_id,
            "f": date(2026, 1, 15),
            "fp": forma_pago,
        },
    )


class TestLaCadenaSigueCorriendo:
    """Lo que se rompió la primera vez: el enum se creaba dos veces."""

    def test_upgrade_head_completo(self, migration_engine_0010):
        _run_alembic("upgrade", "head")
        assert "venta" in inspect(migration_engine_0010).get_table_names()

    def test_las_tablas_anteriores_siguen_ahi(self, migrated):
        """Un enum es un objeto de base, no de tabla: romperlo tumba todo."""
        tablas = set(inspect(migrated).get_table_names())
        assert {
            "usuario",
            "negocio",
            "refresh_token",
            "invitacion_empleado",
            "cliente",
            "token_reset",
        } <= tablas


class TestSchema:
    def test_columnas(self, migrated):
        columnas = {c["name"] for c in inspect(migrated).get_columns("venta")}
        assert columnas == {
            "id",
            "negocio_id",
            "creado_por_usuario_id",
            "cliente_id",
            "fecha",
            "monto",
            "forma_pago",
            "notas",
            "deleted_at",
            "created_at",
            "updated_at",
        }

    def test_sin_columnas_derivadas(self, migrated):
        """D-01 vale también acá: saldo y estado se calculan, no se guardan."""
        columnas = {c["name"] for c in inspect(migrated).get_columns("venta")}
        assert "saldo" not in columnas
        assert "estado" not in columnas

    def test_sin_origen(self, migrated):
        """D6: nada de esto lo propone la IA — se tipea en el mostrador."""
        columnas = {c["name"] for c in inspect(migrated).get_columns("venta")}
        assert "origen" not in columnas

    def test_indices_para_las_consultas_que_existen(self, migrated):
        indices = inspect(migrated).get_indexes("venta")
        columnas = [tuple(i["column_names"]) for i in indices]

        assert ("negocio_id",) in columnas
        assert ("negocio_id", "fecha") in columnas
        assert ("negocio_id", "cliente_id", "deleted_at") in columnas


class TestElCheckRechazaDeVerdad:
    """La razón por la que la invariante es confiable (D1)."""

    def test_fiado_sin_cliente_rechazado_por_la_base(self, migrated):
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)

        with pytest.raises(IntegrityError):
            with migrated.begin() as conn:
                _insertar_venta(conn, negocio_id, "CUENTA_CORRIENTE", cliente_id=None)

    def test_venta_al_contado_con_cliente_rechazada_por_la_base(self, migrated):
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            cliente_id = _cliente(conn, negocio_id)

        with pytest.raises(IntegrityError):
            with migrated.begin() as conn:
                _insertar_venta(conn, negocio_id, "EFECTIVO", cliente_id=cliente_id)

    def test_las_dos_combinaciones_validas_pasan(self, migrated):
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            cliente_id = _cliente(conn, negocio_id)
            _insertar_venta(conn, negocio_id, "EFECTIVO", cliente_id=None)
            _insertar_venta(conn, negocio_id, "CUENTA_CORRIENTE", cliente_id=cliente_id)

        with migrated.connect() as conn:
            total = conn.execute(
                text("SELECT count(*) FROM venta WHERE negocio_id = :n"),
                {"n": negocio_id},
            ).scalar()
        assert total == 2


class TestRoundTrip:
    def test_downgrade_y_re_upgrade(self, migrated):
        with migrated.connect() as conn:
            clientes = conn.execute(text("SELECT count(*) FROM cliente")).scalar()

        _run_alembic("downgrade", "0009")

        inspector = inspect(migrated)
        assert "venta" not in inspector.get_table_names()
        assert "cliente" in inspector.get_table_names()

        with migrated.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM cliente")).scalar() == clientes

        # El re-upgrade es donde el bug del enum duplicado se manifestaba.
        _run_alembic("upgrade", "0010")
        assert "venta" in inspect(migrated).get_table_names()

    def test_el_tipo_enum_se_limpia_al_bajar(self, migrated):
        """Si el downgrade deja el tipo colgado, el re-upgrade falla."""
        _run_alembic("downgrade", "0009")

        with migrated.connect() as conn:
            existe = conn.execute(
                text("SELECT count(*) FROM pg_type WHERE typname = 'formapago'")
            ).scalar()
        assert existe == 0, "el downgrade dejó el tipo formapago colgado"

        _run_alembic("upgrade", "0010")
