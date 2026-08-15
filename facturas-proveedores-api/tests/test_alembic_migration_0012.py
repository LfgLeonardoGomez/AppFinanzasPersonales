"""
Tests for Alembic migration 0012 — venta.idempotency_key (C-42).

Same discipline as test_alembic_migration_0008.py: a naive "is it unique?"
test would pass on a WRONG index just as easily as on the right one. What
actually needs proving, in both directions:

- The index rejects a same-negocio duplicate key, INCLUDING when the row that
  holds it was soft-deleted (design.md D2) — unlike the customer-name index
  (migration 0008), this one deliberately does NOT exclude deleted_at. A late
  retry after a delete would otherwise create a second sale, which is the
  exact bug this change exists to close.
- The index accepts NULL keys freely (every sale predating this migration)
  and the same key reused across two different negocios.

Revisions pinned ("0011", "0012") rather than head/-1, per D-21.
"""

import os
import subprocess
import sys
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from testcontainers.postgres import PostgresContainer

API_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def migration_engine_0012():
    original_db_url = os.environ.get("DATABASE_URL")
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_12",
        password="mig_pass_12",
        dbname="test_migration_0012",
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
def migrated(migration_engine_0012):
    _run_alembic("upgrade", "0012")
    return migration_engine_0012


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


def _insertar_venta(conn, negocio_id, idempotency_key=None, deleted=False) -> uuid.UUID:
    """Direct insert, bypassing the application entirely — this is what proves
    the guarantee lives in the database and not in Python."""
    venta_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO venta (id, negocio_id, fecha, monto, forma_pago, "
            "idempotency_key, deleted_at, created_at, updated_at) "
            "VALUES (:id, :neg, :f, 100.00, 'EFECTIVO', :key, :del, now(), now())"
        ),
        {
            "id": venta_id,
            "neg": negocio_id,
            "f": date(2026, 1, 15),
            "key": idempotency_key,
            "del": datetime(2026, 1, 1, tzinfo=timezone.utc) if deleted else None,
        },
    )
    return venta_id


class TestSchema:
    def test_columna_existe_y_es_nullable(self, migrated):
        columnas = {c["name"]: c for c in inspect(migrated).get_columns("venta")}
        assert "idempotency_key" in columnas
        assert columnas["idempotency_key"]["nullable"] is True

    def test_el_indice_unico_es_parcial(self, migrated):
        """El WHERE es todo el punto — comprobar que realmente está."""
        with migrated.connect() as conn:
            definicion = conn.execute(
                text(
                    "SELECT indexdef FROM pg_indexes "
                    "WHERE indexname = 'uq_venta_negocio_idempotency_key'"
                )
            ).scalar()

        assert definicion is not None, "no existe el índice único"
        assert "UNIQUE" in definicion.upper()
        assert "WHERE" in definicion.upper()
        assert "idempotency_key IS NOT NULL" in definicion

    def test_el_predicado_no_excluye_los_borrados(self, migrated):
        """
        A propósito, a diferencia del índice de cliente (0008): el predicado es
        SOLO `idempotency_key IS NOT NULL`, nunca suma `deleted_at IS NULL`.
        Mutación que debe hacer fallar este test: agregar `AND deleted_at IS
        NULL` al predicado de la migración.
        """
        with migrated.connect() as conn:
            definicion = conn.execute(
                text(
                    "SELECT indexdef FROM pg_indexes "
                    "WHERE indexname = 'uq_venta_negocio_idempotency_key'"
                )
            ).scalar()

        assert "deleted_at" not in definicion

    def test_sin_columnas_derivadas(self, migrated):
        """D-01 intacto: la clave de idempotencia no es un valor calculado."""
        columnas = {c["name"] for c in inspect(migrated).get_columns("venta")}
        assert "saldo" not in columnas
        assert "estado" not in columnas

    def test_revision_pinneada_de_forma_explicita(self):
        """D-21: el módulo de migración declara ids literales."""
        module_path = (
            API_ROOT / "alembic" / "versions" / "20240012_0012_venta_idempotency_key.py"
        )
        source = module_path.read_text(encoding="utf-8")
        assert 'revision = "0012"' in source
        assert 'down_revision = "0011"' in source


class TestElIndiceHaceLoQuePromete:
    def test_rechaza_la_misma_clave_dos_veces_en_el_mismo_negocio(self, migrated):
        key = uuid.uuid4()
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            _insertar_venta(conn, negocio_id, idempotency_key=key)

        with pytest.raises(IntegrityError):
            with migrated.begin() as conn:
                _insertar_venta(conn, negocio_id, idempotency_key=key)

    def test_acepta_varias_claves_nulas(self, migrated):
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            for _ in range(3):
                _insertar_venta(conn, negocio_id, idempotency_key=None)

        with migrated.connect() as conn:
            total = conn.execute(
                text(
                    "SELECT count(*) FROM venta WHERE negocio_id = :neg "
                    "AND idempotency_key IS NULL"
                ),
                {"neg": negocio_id},
            ).scalar()
        assert total == 3

    def test_la_misma_clave_en_dos_negocios_es_aceptada(self, migrated):
        key = uuid.uuid4()
        with migrated.begin() as conn:
            negocio_a = _negocio(conn)
            negocio_b = _negocio(conn)
            _insertar_venta(conn, negocio_a, idempotency_key=key)
            _insertar_venta(conn, negocio_b, idempotency_key=key)

        with migrated.connect() as conn:
            total = conn.execute(
                text("SELECT count(*) FROM venta WHERE idempotency_key = :key"),
                {"key": key},
            ).scalar()
        assert total == 2

    def test_una_venta_borrada_sigue_reteniendo_su_clave(self, migrated):
        """
        design.md D2 — el índice NO libera la clave al soft-delete. Si el
        predicado excluyera deleted_at, este insert pasaría; con el predicado
        real, la base lo rechaza.
        """
        key = uuid.uuid4()
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            _insertar_venta(conn, negocio_id, idempotency_key=key, deleted=True)

        with pytest.raises(IntegrityError):
            with migrated.begin() as conn:
                _insertar_venta(conn, negocio_id, idempotency_key=key)


class TestRoundTrip:
    def test_downgrade_y_re_upgrade(self, migrated):
        with migrated.connect() as conn:
            ventas = conn.execute(text("SELECT count(*) FROM venta")).scalar()

        _run_alembic("downgrade", "0011")

        inspector = inspect(migrated)
        assert "idempotency_key" not in {
            c["name"] for c in inspector.get_columns("venta")
        }
        assert "venta" in inspector.get_table_names()

        with migrated.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM venta")).scalar() == ventas

        _run_alembic("upgrade", "0012")
        assert "idempotency_key" in {
            c["name"] for c in inspect(migrated).get_columns("venta")
        }

    def test_el_indice_se_limpia_al_bajar(self, migrated):
        _run_alembic("downgrade", "0011")

        with migrated.connect() as conn:
            existe = conn.execute(
                text(
                    "SELECT count(*) FROM pg_indexes "
                    "WHERE indexname = 'uq_venta_negocio_idempotency_key'"
                )
            ).scalar()
        assert existe == 0, "el downgrade dejó el índice colgado"

        _run_alembic("upgrade", "0012")
