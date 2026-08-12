"""
Tests for the shared allocation engine `app/services/cuenta_corriente_engine.py`
(C-35, design.md D1/D2).

Pure functions, no DB access. This is the seam D1 pins: `asignar_fifo` returns
allocated AMOUNTS, never a domain state, so both ledgers can consume it without
importing each other's enums. `construir_historial` merges two labeled Movimiento
sequences into one chronological, running-balance list.

Task 2.1-2.5.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest


def _mov(
    monto: Decimal,
    fecha: date | None = None,
    created_at: datetime | None = None,
    id: uuid.UUID | None = None,
    archivo_url: str | None = None,
):
    from app.services.cuenta_corriente_engine import Movimiento

    return Movimiento(
        id=id or uuid.uuid4(),
        fecha=fecha or date.today(),
        created_at=created_at or datetime.now(timezone.utc),
        monto=monto,
        archivo_url=archivo_url,
    )


# ── 2.1 — asignar_fifo allocates in the order given ─────────────────────────


class TestAsignarFifoBasico:
    def test_full_partial_and_untouched_in_one_pass(self):
        from app.services.cuenta_corriente_engine import asignar_fifo

        c1 = _mov(Decimal("100.00"))
        c2 = _mov(Decimal("100.00"))
        c3 = _mov(Decimal("100.00"))

        # pool=150 -> c1 full (100), c2 partial (50), c3 untouched (0)
        result = asignar_fifo([c1, c2, c3], pool=Decimal("150.00"))

        assert result[c1.id] == Decimal("100.00")
        assert result[c2.id] == Decimal("50.00")
        assert result[c3.id] == Decimal("0.00")

    def test_empty_pool_allocates_nothing(self):
        from app.services.cuenta_corriente_engine import asignar_fifo

        c1 = _mov(Decimal("100.00"))
        result = asignar_fifo([c1], pool=Decimal("0"))
        assert result[c1.id] == Decimal("0")


# ── 2.2 — triangulate: boundaries ────────────────────────────────────────────


class TestAsignarFifoBordes:
    def test_pool_exactly_equal_to_one_charge(self):
        from app.services.cuenta_corriente_engine import asignar_fifo

        c1 = _mov(Decimal("100.00"))
        result = asignar_fifo([c1], pool=Decimal("100.00"))
        assert result[c1.id] == Decimal("100.00")

    def test_pool_of_zero(self):
        from app.services.cuenta_corriente_engine import asignar_fifo

        c1 = _mov(Decimal("500.00"))
        result = asignar_fifo([c1], pool=Decimal("0"))
        assert result[c1.id] == Decimal("0")

    def test_empty_charge_list(self):
        from app.services.cuenta_corriente_engine import asignar_fifo

        result = asignar_fifo([], pool=Decimal("1000.00"))
        assert result == {}

    def test_pool_larger_than_every_charge_leftover_not_swallowed(self):
        """Pool > sum(charges): every charge gets its full monto, and the
        function does not raise or silently truncate the leftover — the
        caller can compute it as pool - sum(allocated)."""
        from app.services.cuenta_corriente_engine import asignar_fifo

        c1 = _mov(Decimal("100.00"))
        c2 = _mov(Decimal("50.00"))

        result = asignar_fifo([c1, c2], pool=Decimal("1000.00"))

        assert result[c1.id] == Decimal("100.00")
        assert result[c2.id] == Decimal("50.00")
        leftover = Decimal("1000.00") - sum(result.values(), Decimal("0"))
        assert leftover == Decimal("850.00")


# ── 2.3 — state-agnostic: amounts, not domain enums ─────────────────────────


class TestAsignarFifoStateAgnostic:
    def test_returns_amounts_not_labels(self):
        from app.services.cuenta_corriente_engine import asignar_fifo

        c1 = _mov(Decimal("100.00"))
        result = asignar_fifo([c1], pool=Decimal("40.00"))

        assert isinstance(result[c1.id], Decimal)
        assert result[c1.id] == Decimal("40.00")

    def test_module_does_not_import_any_domain_estado_enum(self):
        """The customer ledger must be able to call this without dragging in
        EstadoFactura or EstadoVentaFiada (D2). Checked at the import-graph
        level (AST), not by grepping prose — a docstring is allowed to name
        the enums it deliberately does not depend on."""
        import ast
        import app.services.cuenta_corriente_engine as engine

        tree = ast.parse(open(engine.__file__, encoding="utf-8").read())
        imported_names: set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                imported_names.update(alias.name for alias in node.names)
            elif isinstance(node, ast.Import):
                imported_names.update(alias.name for alias in node.names)

        assert "EstadoFactura" not in imported_names
        assert "EstadoVentaFiada" not in imported_names


# ── 2.4 — construir_historial merges into chronological order ───────────────


class TestConstruirHistorialBasico:
    def test_merge_order_and_running_total(self):
        from app.services.cuenta_corriente_engine import construir_historial

        cargo1 = _mov(Decimal("1000.00"), fecha=date(2026, 6, 1), created_at=datetime(2026, 6, 1, 9, 0))
        abono1 = _mov(Decimal("400.00"), fecha=date(2026, 6, 2), created_at=datetime(2026, 6, 2, 9, 0))
        cargo2 = _mov(Decimal("500.00"), fecha=date(2026, 6, 3), created_at=datetime(2026, 6, 3, 9, 0))

        result = construir_historial(
            [cargo1, cargo2], [abono1], tipo_cargo="VENTA", tipo_abono="COBRO"
        )

        assert [r["tipo"] for r in result] == ["VENTA", "COBRO", "VENTA"]
        assert result[0]["saldo_acumulado"] == Decimal("1000.00")
        assert result[1]["saldo_acumulado"] == Decimal("600.00")
        assert result[2]["saldo_acumulado"] == Decimal("1100.00")

    def test_takes_tipo_labels_as_arguments(self):
        """The labels are not hardcoded — the caller names its own vocabulary."""
        from app.services.cuenta_corriente_engine import construir_historial

        cargo = _mov(Decimal("100.00"))
        result = construir_historial([cargo], [], tipo_cargo="FACTURA", tipo_abono="PAGO")
        assert result[0]["tipo"] == "FACTURA"

    def test_empty_both_lists(self):
        from app.services.cuenta_corriente_engine import construir_historial

        assert construir_historial([], [], tipo_cargo="A", tipo_abono="B") == []


# ── 2.5 — triangulate: same-date tiebreak and caller-order robustness ───────


class TestConstruirHistorialDeterminismo:
    def test_same_date_resolves_by_created_at_then_id(self):
        from app.services.cuenta_corriente_engine import construir_historial

        same_date = date(2026, 6, 1)
        earlier_id = uuid.UUID("00000000-0000-0000-0000-000000000001")
        later_id = uuid.UUID("00000000-0000-0000-0000-000000000002")

        cargo_earlier = _mov(
            Decimal("100.00"), fecha=same_date, created_at=datetime(2026, 6, 1, 8, 0), id=earlier_id
        )
        cargo_later = _mov(
            Decimal("200.00"), fecha=same_date, created_at=datetime(2026, 6, 1, 9, 0), id=later_id
        )

        result = construir_historial(
            [cargo_later, cargo_earlier], [], tipo_cargo="VENTA", tipo_abono="COBRO"
        )

        # Regardless of the order passed in, output is ordered by created_at.
        assert [r["id"] for r in result] == [earlier_id, later_id]

    def test_caller_passing_lists_in_wrong_order_still_sorts_correctly(self):
        """Robust to caller ordering — the function re-sorts the union."""
        from app.services.cuenta_corriente_engine import construir_historial

        cargo1 = _mov(Decimal("100.00"), fecha=date(2026, 1, 1), created_at=datetime(2026, 1, 1))
        cargo2 = _mov(Decimal("200.00"), fecha=date(2026, 3, 1), created_at=datetime(2026, 3, 1))
        abono1 = _mov(Decimal("50.00"), fecha=date(2026, 2, 1), created_at=datetime(2026, 2, 1))

        # Deliberately passed newest-first, out of order.
        result = construir_historial(
            [cargo2, cargo1], [abono1], tipo_cargo="VENTA", tipo_abono="COBRO"
        )

        assert [r["fecha"] for r in result] == [date(2026, 1, 1), date(2026, 2, 1), date(2026, 3, 1)]

    def test_same_date_and_created_at_tiebreak_by_id(self):
        from app.services.cuenta_corriente_engine import construir_historial

        same_dt = datetime(2026, 6, 1, 10, 0, 0)
        id_a = uuid.UUID("00000000-0000-0000-0000-000000000001")
        id_b = uuid.UUID("00000000-0000-0000-0000-000000000002")

        cargo_a = _mov(Decimal("100"), fecha=date(2026, 6, 1), created_at=same_dt, id=id_a)
        cargo_b = _mov(Decimal("200"), fecha=date(2026, 6, 1), created_at=same_dt, id=id_b)

        result = construir_historial([cargo_b, cargo_a], [], tipo_cargo="VENTA", tipo_abono="COBRO")

        assert [r["id"] for r in result] == [id_a, id_b]

    def test_archivo_url_threaded_through(self):
        from app.services.cuenta_corriente_engine import construir_historial

        cargo = _mov(Decimal("100.00"), archivo_url=None)
        abono = _mov(
            Decimal("50.00"),
            fecha=cargo.fecha + timedelta(days=1),
            archivo_url="https://example.com/comprobante.jpg",
        )

        result = construir_historial([cargo], [abono], tipo_cargo="VENTA", tipo_abono="COBRO")

        assert result[0]["archivo_url"] is None
        assert result[1]["archivo_url"] == "https://example.com/comprobante.jpg"
