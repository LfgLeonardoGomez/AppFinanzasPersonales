"""
Tests for Alembic migration 0013 — idempotency_key on pago, factura and
cobro_cliente (C-43 Fase A).

Same discipline as test_alembic_migration_0012.py, times three tables. What
actually needs proving, per table:

- The index rejects a same-negocio duplicate key, INCLUDING when the row that
  holds it was soft-deleted (design.md D5) — same choice as venta's 0012
  index: the predicate is only `idempotency_key IS NOT NULL`, never also
  `deleted_at IS NULL`. A late retry after a delete must NOT create a second
  row.
- The index accepts NULL keys freely (every row predating this migration)
  and the same key reused across two different negocios.
- `factura_item` does NOT gain a column — the operation that is deduplicated
  is "register an invoice with its detail", one intention, not one per line
  (task 2.5).

Revisions pinned ("0012", "0013") rather than head/-1, per D-21.
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

_TABLES = ["pago", "factura", "cobro_cliente"]
_INDEX_NAME = {
    "pago": "uq_pago_negocio_idempotency_key",
    "factura": "uq_factura_negocio_idempotency_key",
    "cobro_cliente": "uq_cobro_cliente_negocio_idempotency_key",
}


@pytest.fixture(scope="module")
def migration_engine_0013():
    original_db_url = os.environ.get("DATABASE_URL")
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_13",
        password="mig_pass_13",
        dbname="test_migration_0013",
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
def migrated(migration_engine_0013):
    _run_alembic("upgrade", "0013")
    return migration_engine_0013


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


def _proveedor(conn, negocio_id) -> uuid.UUID:
    proveedor_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO proveedor (id, negocio_id, nombre, categoria, "
            "created_at, updated_at) "
            "VALUES (:id, :neg, 'Prov Test', 'OTRO', now(), now())"
        ),
        {"id": proveedor_id, "neg": negocio_id},
    )
    return proveedor_id


def _cliente(conn, negocio_id) -> uuid.UUID:
    cliente_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO cliente (id, negocio_id, nombre, nombre_normalizado, "
            "created_at, updated_at) "
            "VALUES (:id, :neg, 'Cliente Test', :norm, now(), now())"
        ),
        {"id": cliente_id, "neg": negocio_id, "norm": f"cliente test {uuid.uuid4().hex[:8]}"},
    )
    return cliente_id


def _insertar(conn, tabla, negocio_id, fk_id, idempotency_key=None, deleted=False) -> uuid.UUID:
    """Direct insert, bypassing the application entirely — this is what proves
    the guarantee lives in the database and not in Python."""
    row_id = uuid.uuid4()
    deleted_at = datetime(2026, 1, 1, tzinfo=timezone.utc) if deleted else None

    if tabla == "pago":
        conn.execute(
            text(
                "INSERT INTO pago (id, negocio_id, proveedor_id, monto, fecha, "
                "metodo, origen, idempotency_key, deleted_at, created_at, updated_at) "
                "VALUES (:id, :neg, :fk, 100.00, :f, 'EFECTIVO', 'MANUAL', :key, "
                ":del, now(), now())"
            ),
            {
                "id": row_id, "neg": negocio_id, "fk": fk_id, "f": date(2026, 1, 15),
                "key": idempotency_key, "del": deleted_at,
            },
        )
    elif tabla == "factura":
        conn.execute(
            text(
                "INSERT INTO factura (id, negocio_id, proveedor_id, fecha_emision, "
                "monto_total, origen, idempotency_key, deleted_at, created_at, updated_at) "
                "VALUES (:id, :neg, :fk, :f, 100.00, 'MANUAL', :key, :del, now(), now())"
            ),
            {
                "id": row_id, "neg": negocio_id, "fk": fk_id, "f": date(2026, 1, 15),
                "key": idempotency_key, "del": deleted_at,
            },
        )
    else:  # cobro_cliente
        conn.execute(
            text(
                "INSERT INTO cobro_cliente (id, negocio_id, cliente_id, monto, fecha, "
                "metodo, idempotency_key, deleted_at, created_at, updated_at) "
                "VALUES (:id, :neg, :fk, 100.00, :f, 'EFECTIVO', :key, :del, now(), now())"
            ),
            {
                "id": row_id, "neg": negocio_id, "fk": fk_id, "f": date(2026, 1, 15),
                "key": idempotency_key, "del": deleted_at,
            },
        )
    return row_id


def _fk_for(conn, tabla, negocio_id) -> uuid.UUID:
    """The right foreign key for each table: proveedor for pago/factura, cliente for cobro."""
    if tabla == "cobro_cliente":
        return _cliente(conn, negocio_id)
    return _proveedor(conn, negocio_id)


class TestSchema:
    @pytest.mark.parametrize("tabla", _TABLES)
    def test_columna_existe_y_es_nullable(self, migrated, tabla):
        """2.7 (parcial) / 2.8"""
        columnas = {c["name"]: c for c in inspect(migrated).get_columns(tabla)}
        assert "idempotency_key" in columnas
        assert columnas["idempotency_key"]["nullable"] is True

    @pytest.mark.parametrize("tabla", _TABLES)
    def test_el_indice_unico_es_parcial(self, migrated, tabla):
        """2.1 — el WHERE es todo el punto."""
        with migrated.connect() as conn:
            definicion = conn.execute(
                text(
                    "SELECT indexdef FROM pg_indexes WHERE indexname = :name"
                ),
                {"name": _INDEX_NAME[tabla]},
            ).scalar()

        assert definicion is not None, f"no existe el índice único de {tabla}"
        assert "UNIQUE" in definicion.upper()
        assert "WHERE" in definicion.upper()
        assert "idempotency_key IS NOT NULL" in definicion

    @pytest.mark.parametrize("tabla", _TABLES)
    def test_el_predicado_no_excluye_los_borrados(self, migrated, tabla):
        """
        2.4 — mutación que debe hacer fallar este test: agregar
        `AND deleted_at IS NULL` al predicado de la migración en cualquiera
        de las tres tablas.
        """
        with migrated.connect() as conn:
            definicion = conn.execute(
                text(
                    "SELECT indexdef FROM pg_indexes WHERE indexname = :name"
                ),
                {"name": _INDEX_NAME[tabla]},
            ).scalar()

        assert "deleted_at" not in definicion

    def test_factura_item_no_gana_columna(self, migrated):
        """2.5 — la clave vive en factura, no en factura_item (una intención)."""
        columnas = {c["name"] for c in inspect(migrated).get_columns("factura_item")}
        assert "idempotency_key" not in columnas

    @pytest.mark.parametrize("tabla", _TABLES)
    def test_sin_columnas_derivadas(self, migrated, tabla):
        """2.7 — D-01 intacto: la clave no es un valor calculado ni de saldo/estado."""
        columnas = {c["name"] for c in inspect(migrated).get_columns(tabla)}
        assert "saldo" not in columnas
        assert "estado" not in columnas

    def test_pago_sigue_sin_factura_id(self, migrated):
        """2.7 — RN-PAG-01 intacta."""
        columnas = {c["name"] for c in inspect(migrated).get_columns("pago")}
        assert "factura_id" not in columnas

    def test_cobro_cliente_sigue_sin_venta_id(self, migrated):
        """2.7 — RN-CCC-03 intacta."""
        columnas = {c["name"] for c in inspect(migrated).get_columns("cobro_cliente")}
        assert "venta_id" not in columnas

    def test_revision_pinneada_de_forma_explicita(self):
        """D-21: el módulo de migración declara ids literales."""
        module_path = (
            API_ROOT
            / "alembic"
            / "versions"
            / "20240013_0013_idempotency_pago_factura_cobro.py"
        )
        source = module_path.read_text(encoding="utf-8")
        assert 'revision = "0013"' in source
        assert 'down_revision = "0012"' in source


class TestElIndiceHaceLoQuePromete:
    @pytest.mark.parametrize("tabla", _TABLES)
    def test_rechaza_la_misma_clave_dos_veces_en_el_mismo_negocio(self, migrated, tabla):
        """2.2 — un caso por tabla, las tres."""
        key = uuid.uuid4()
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            fk_id = _fk_for(conn, tabla, negocio_id)
            _insertar(conn, tabla, negocio_id, fk_id, idempotency_key=key)

        with pytest.raises(IntegrityError):
            with migrated.begin() as conn:
                _insertar(conn, tabla, negocio_id, fk_id, idempotency_key=key)

    @pytest.mark.parametrize("tabla", _TABLES)
    def test_acepta_varias_claves_nulas(self, migrated, tabla):
        """2.3 — triangulación."""
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            fk_id = _fk_for(conn, tabla, negocio_id)
            for _ in range(3):
                _insertar(conn, tabla, negocio_id, fk_id, idempotency_key=None)

        with migrated.connect() as conn:
            total = conn.execute(
                text(
                    f"SELECT count(*) FROM {tabla} WHERE negocio_id = :neg "
                    "AND idempotency_key IS NULL"
                ),
                {"neg": negocio_id},
            ).scalar()
        assert total == 3

    @pytest.mark.parametrize("tabla", _TABLES)
    def test_la_misma_clave_en_dos_negocios_es_aceptada(self, migrated, tabla):
        """2.3 — triangulación."""
        key = uuid.uuid4()
        with migrated.begin() as conn:
            negocio_a = _negocio(conn)
            negocio_b = _negocio(conn)
            fk_a = _fk_for(conn, tabla, negocio_a)
            fk_b = _fk_for(conn, tabla, negocio_b)
            _insertar(conn, tabla, negocio_a, fk_a, idempotency_key=key)
            _insertar(conn, tabla, negocio_b, fk_b, idempotency_key=key)

        with migrated.connect() as conn:
            total = conn.execute(
                text(f"SELECT count(*) FROM {tabla} WHERE idempotency_key = :key"),
                {"key": key},
            ).scalar()
        assert total == 2

    @pytest.mark.parametrize("tabla", _TABLES)
    def test_una_fila_borrada_sigue_reteniendo_su_clave(self, migrated, tabla):
        """
        2.4 — design.md D5: el índice NO libera la clave al soft-delete.
        Con el predicado real, la base rechaza el segundo insert.
        """
        key = uuid.uuid4()
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            fk_id = _fk_for(conn, tabla, negocio_id)
            _insertar(conn, tabla, negocio_id, fk_id, idempotency_key=key, deleted=True)

        with pytest.raises(IntegrityError):
            with migrated.begin() as conn:
                _insertar(conn, tabla, negocio_id, fk_id, idempotency_key=key)


class TestRoundTrip:
    def test_downgrade_y_re_upgrade(self, migrated):
        with migrated.connect() as conn:
            counts_antes = {
                t: conn.execute(text(f"SELECT count(*) FROM {t}")).scalar()
                for t in _TABLES
            }

        _run_alembic("downgrade", "0012")

        inspector = inspect(migrated)
        for tabla in _TABLES:
            assert "idempotency_key" not in {
                c["name"] for c in inspector.get_columns(tabla)
            }
            assert tabla in inspector.get_table_names()

        with migrated.connect() as conn:
            for tabla in _TABLES:
                assert (
                    conn.execute(text(f"SELECT count(*) FROM {tabla}")).scalar()
                    == counts_antes[tabla]
                )

        _run_alembic("upgrade", "0013")
        inspector = inspect(migrated)
        for tabla in _TABLES:
            assert "idempotency_key" in {
                c["name"] for c in inspector.get_columns(tabla)
            }

    def test_los_indices_se_limpian_al_bajar(self, migrated):
        _run_alembic("downgrade", "0012")

        with migrated.connect() as conn:
            for tabla in _TABLES:
                existe = conn.execute(
                    text("SELECT count(*) FROM pg_indexes WHERE indexname = :name"),
                    {"name": _INDEX_NAME[tabla]},
                ).scalar()
                assert existe == 0, f"el downgrade dejó colgado el índice de {tabla}"

        _run_alembic("upgrade", "0013")
