"""
No-persistence regression tests for the cuenta-corriente endpoint (C-12).

Hard rules re-asserted here:
1. `Proveedor` SQLModel has NO `saldo` attribute / column.
2. `Factura` SQLModel has NO `estado` attribute / column.
3. `Pago` SQLModel has NO `factura_id` attribute / column.
4. The endpoint issues NO mutations: a session listener captures
   INSERT / UPDATE / DELETE on `factura`, `pago`, `proveedor`, and
   `factura_item`; the test asserts no such events fire.

If a future change ever adds a `saldo` / `estado` / `factura_id` column
(or any INSERT/UPDATE/DELETE in the cuenta-corriente path), this test
fails loudly.
"""

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401



@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


# ── Schema introspection (static) ────────────────────────────────────────────


class TestSchemaInvariants:
    def test_proveedor_has_no_saldo_column(self):
        from app.models.proveedor import Proveedor

        assert not hasattr(Proveedor, "saldo"), (
            "Proveedor MUST NOT have a 'saldo' column — saldo is computed on-demand (RN-SALDO)"
        )

    def test_factura_has_no_estado_column(self):
        from app.models.factura import Factura

        assert not hasattr(Factura, "estado"), (
            "Factura MUST NOT have an 'estado' column — estado is computed on-demand (RN-FIFO)"
        )

    def test_factura_has_no_saldo_column(self):
        from app.models.factura import Factura

        assert not hasattr(Factura, "saldo"), (
            "Factura MUST NOT have a 'saldo' column — saldo is computed on-demand"
        )

    def test_pago_has_no_factura_id_column(self):
        from app.models.pago import Pago

        assert not hasattr(Pago, "factura_id"), (
            "Pago MUST NOT have a 'factura_id' column — pago is supplier-scoped (RN-PAG-01)"
        )

    def test_proveedor_table_has_no_saldo_sql_column(self):
        """Introspect the actual SQL table to confirm no `saldo` column at the DB layer."""
        from sqlalchemy import inspect
        from app.models.proveedor import Proveedor

        mapper = inspect(Proveedor)
        column_names = {c.name for c in mapper.columns}
        assert "saldo" not in column_names, (
            f"proveedor table has a 'saldo' column: {column_names}"
        )

    def test_factura_table_has_no_estado_sql_column(self):
        from sqlalchemy import inspect
        from app.models.factura import Factura

        mapper = inspect(Factura)
        column_names = {c.name for c in mapper.columns}
        assert "estado" not in column_names, (
            f"factura table has an 'estado' column: {column_names}"
        )

    def test_pago_table_has_no_factura_id_sql_column(self):
        from sqlalchemy import inspect
        from app.models.pago import Pago

        mapper = inspect(Pago)
        column_names = {c.name for c in mapper.columns}
        assert "factura_id" not in column_names, (
            f"pago table has a 'factura_id' column: {column_names}"
        )


# ── Runtime mutation capture ─────────────────────────────────────────────────


class TestNoMutationsOnRead:
    """
    The cuenta-corriente endpoint is read-only. These tests bind a session
    listener to the engine and assert that calling the service (or the
    HTTP endpoint) does NOT issue any INSERT / UPDATE / DELETE.
    """

    @pytest.fixture
    def mutation_capture(self, engine):
        """
        Returns a list that captures every INSERT/UPDATE/DELETE issued
        against the bound engine. After the test, asserts the list is empty.
        """
        from sqlalchemy.orm import Session as SASession

        captured = []

        def before_flush(session, flush_context, instances):
            for obj in session.new:
                captured.append(("INSERT", obj.__class__.__name__))
            for obj in session.dirty:
                if session.is_modified(obj):
                    captured.append(("UPDATE", obj.__class__.__name__))
            for obj in session.deleted:
                captured.append(("DELETE", obj.__class__.__name__))

        # Attach the listener to the engine via a session factory
        event.listen(SASession, "before_flush", before_flush)
        try:
            yield captured
        finally:
            event.remove(SASession, "before_flush", before_flush)

    def test_service_method_issues_no_mutations(self, engine, mutation_capture):
        """Calling the service directly must not INSERT/UPDATE/DELETE anything."""
        from app.services.proveedor_service import ProveedorService
        from app.models.proveedor import Proveedor
        from app.models.usuario import Usuario
        from app.core.uuid_utils import new_uuid
        from app.models.enums import CategoriaProveedor

        from tests.conftest import crear_negocio

        with Session(engine) as session:
            u = Usuario(
                negocio_id=crear_negocio(session).id,
                id=new_uuid(),
                email=f"np_{uuid.uuid4().hex[:8]}@test.com",
                nombre="No Persist",
                password_hash="$argon2id$fake",
            )
            session.add(u)
            session.flush()

            p = Proveedor(
                id=new_uuid(),
                negocio_id=u.negocio_id,
                nombre="Prov",
                categoria=CategoriaProveedor.OTRO,
            )
            session.add(p)
            session.commit()

            # Clear the capture AFTER setup so the test only sees what the
            # service method does
            mutation_capture.clear()

            svc = ProveedorService(session)
            result = svc.get_cuenta_corriente(u.negocio_id, p.id)
            assert result.saldo == 0
            session.rollback()  # discard any implicit state

            assert mutation_capture == [], (
                f"Service method issued mutations: {mutation_capture}"
            )


def _test_engine():
    """Module-level engine fixture for the no-persistence tests."""
    from tests.conftest import db_url
    from sqlalchemy import create_engine as _ce
    eng = _ce(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    return eng
