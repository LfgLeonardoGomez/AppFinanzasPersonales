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

from app.services.idempotencia import es_violacion_de, nombre_constraint_violada


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


class TestEsViolacionDe:
    """C-43 (3.1-3.2) — the predicate the four services write by hand today
    (`nombre_constraint_violada(err) != _UQ_...`), promoted to a shared
    helper so the comparison cannot be written backwards by accident
    (design.md D1). Sugar, not architecture."""

    def test_devuelve_true_cuando_la_constraint_coincide(self):
        err = IntegrityError("INSERT", {}, _FakeOrig("uq_pago_negocio_idempotency_key"))
        assert es_violacion_de(err, "uq_pago_negocio_idempotency_key") is True

    def test_devuelve_false_cuando_la_constraint_es_otra(self):
        """3.1 — triangulación con una constraint distinta."""
        err = IntegrityError("INSERT", {}, _FakeOrig("ck_venta_fiado_tiene_cliente"))
        assert es_violacion_de(err, "uq_pago_negocio_idempotency_key") is False

    def test_devuelve_false_cuando_no_se_puede_determinar_el_nombre(self):
        err = IntegrityError("INSERT", {}, None)
        assert es_violacion_de(err, "uq_pago_negocio_idempotency_key") is False

    def test_nunca_lanza_sin_orig(self):
        """3.2 — degrada a False en vez de explotar."""
        err = IntegrityError("INSERT", {}, None)
        assert es_violacion_de(err, "cualquier_constraint") is False

    def test_nunca_lanza_sin_diag(self):
        """3.2 — triangulación: .orig presente pero sin .diag."""

        class _OrigSinDiag:
            pass

        err = IntegrityError("INSERT", {}, _OrigSinDiag())
        assert es_violacion_de(err, "cualquier_constraint") is False

    def test_nunca_lanza_sin_constraint_name(self):
        """3.2 — triangulación: .diag presente pero sin .constraint_name."""

        class _DiagSinNombre:
            pass

        class _OrigSinNombre:
            diag = _DiagSinNombre()

        err = IntegrityError("INSERT", {}, _OrigSinNombre())
        assert es_violacion_de(err, "cualquier_constraint") is False
