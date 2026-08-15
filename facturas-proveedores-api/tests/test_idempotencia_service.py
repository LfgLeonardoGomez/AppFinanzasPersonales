"""
Tests for app/services/idempotencia.py (C-42).

Pure unit tests — no DB access needed. The only job of this module is
naming WHICH unique constraint fired inside an IntegrityError, so that a
caller with more than one unique index (a thing `cliente` does not have
today, and a thing `venta` has starting with this change) does not have to
assume.

`err.orig.diag.constraint_name` is psycopg2-specific and only ever
genuinely populated by a real driver error; these tests build fake stand-ins
for `.orig`/`.diag` because the function must degrade to None at ANY missing
level rather than raising a second exception on top of the first — a real
DB round trip cannot exercise "the attribute is absent" on demand.
"""

from sqlalchemy.exc import IntegrityError

from app.services.idempotencia import nombre_constraint_violada


class _FakeDiag:
    def __init__(self, constraint_name):
        self.constraint_name = constraint_name


class _FakeOrig:
    def __init__(self, constraint_name):
        self.diag = _FakeDiag(constraint_name)


class TestNombreConstraintViolada:
    def test_devuelve_el_nombre_de_la_constraint_de_idempotencia(self):
        err = IntegrityError("INSERT", {}, _FakeOrig("uq_venta_negocio_idempotency_key"))
        assert nombre_constraint_violada(err) == "uq_venta_negocio_idempotency_key"

    def test_triangulacion_con_otra_constraint_devuelve_su_propio_nombre(self):
        """Entradas distintas del caso anterior: otro nombre de constraint."""
        err = IntegrityError("INSERT", {}, _FakeOrig("ck_venta_fiado_tiene_cliente"))
        assert nombre_constraint_violada(err) == "ck_venta_fiado_tiene_cliente"

    def test_sin_orig_no_explota(self):
        """`.orig` ausente: degrada a None en vez de lanzar AttributeError."""
        err = IntegrityError("INSERT", {}, None)
        assert nombre_constraint_violada(err) is None

    def test_orig_sin_diag_no_explota(self):
        """`.orig` presente pero sin `.diag` (otro driver, u otro tipo de error)."""

        class _OrigSinDiag:
            pass

        err = IntegrityError("INSERT", {}, _OrigSinDiag())
        assert nombre_constraint_violada(err) is None
