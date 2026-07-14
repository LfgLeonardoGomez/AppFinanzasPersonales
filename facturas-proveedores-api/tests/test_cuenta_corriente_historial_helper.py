"""
Tests for the pure helper `_build_historial(facturas, pagos) -> list[dict]`.

This is a PURE FUNCTION — no DB access, no side effects. It merges
active facturas (as FACTURA rows) and active pagos (as PAGO rows) of one
supplier into a chronologically-ordered list with a running `saldo_acumulado`.

Hard rules (design.md D3, D4):
- Order: (fecha ASC, created_at ASC, id ASC) — facturas use fecha_emision
  as their `fecha`; pagos use `fecha`.
- saldo_acumulado: facturas add (debe), pagos subtract (haber). The
  sign convention matches RN-SALDO (positive = deuda, negative = a favor).
- The last row's `saldo_acumulado` MUST equal the C-06 aggregate `saldo`.
  Tested separately in test_cuenta_corriente_service.py.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

import pytest


@dataclass
class FakeFactura:
    """Lightweight stand-in for a Factura row. Pure Python — no SQLModel needed."""

    id: uuid.UUID
    fecha_emision: date
    monto_total: Decimal
    created_at: datetime


@dataclass
class FakePago:
    """Lightweight stand-in for a Pago row."""

    id: uuid.UUID
    fecha: date
    monto: Decimal
    created_at: datetime


# ── Empty & single-row cases ─────────────────────────────────────────────────


class TestBasics:
    def test_empty_facturas_and_empty_pagos(self):
        from app.services.proveedor_service import _build_historial

        assert _build_historial([], []) == []

    def test_single_factura_no_pagos(self):
        from app.services.proveedor_service import _build_historial

        f1 = FakeFactura(uuid.uuid4(), date(2026, 6, 1), Decimal("1000.00"), datetime(2026, 6, 1, 10, 0))
        result = _build_historial([f1], [])
        assert len(result) == 1
        assert result[0]["tipo"] == "FACTURA"
        assert result[0]["monto"] == Decimal("1000.00")
        assert result[0]["saldo_acumulado"] == Decimal("1000.00")
        assert result[0]["id"] == f1.id

    def test_single_pago_no_facturas(self):
        from app.services.proveedor_service import _build_historial

        p1 = FakePago(uuid.uuid4(), date(2026, 6, 1), Decimal("500.00"), datetime(2026, 6, 1, 10, 0))
        result = _build_historial([], [p1])
        assert len(result) == 1
        assert result[0]["tipo"] == "PAGO"
        assert result[0]["monto"] == Decimal("500.00")
        assert result[0]["saldo_acumulado"] == Decimal("-500.00")
        assert result[0]["id"] == p1.id

    def test_only_pagos_drive_saldo_negative(self):
        """A supplier with only pagos has saldo < 0 (a favor)."""
        from app.services.proveedor_service import _build_historial

        p1 = FakePago(uuid.uuid4(), date(2026, 6, 1), Decimal("100.00"), datetime(2026, 6, 1, 10, 0))
        p2 = FakePago(uuid.uuid4(), date(2026, 6, 5), Decimal("200.00"), datetime(2026, 6, 5, 10, 0))
        result = _build_historial([], [p1, p2])
        assert result[0]["saldo_acumulado"] == Decimal("-100.00")
        assert result[1]["saldo_acumulado"] == Decimal("-300.00")


# ── Mixed chronological order ────────────────────────────────────────────────


class TestChronologicalMerge:
    def test_mixed_chronological(self):
        """F1 (1000, day 1) + F2 (500, day 2) + P1 (300, day 1.5) → F1, P1, F2."""
        from app.services.proveedor_service import _build_historial

        f1 = FakeFactura(uuid.uuid4(), date(2026, 6, 1), Decimal("1000.00"), datetime(2026, 6, 1, 9, 0))
        f2 = FakeFactura(uuid.uuid4(), date(2026, 6, 3), Decimal("500.00"), datetime(2026, 6, 3, 9, 0))
        p1 = FakePago(uuid.uuid4(), date(2026, 6, 2), Decimal("300.00"), datetime(2026, 6, 2, 9, 0))

        result = _build_historial([f1, f2], [p1])

        assert len(result) == 3
        assert result[0]["tipo"] == "FACTURA"
        assert result[0]["saldo_acumulado"] == Decimal("1000.00")
        assert result[1]["tipo"] == "PAGO"
        assert result[1]["saldo_acumulado"] == Decimal("700.00")
        assert result[2]["tipo"] == "FACTURA"
        assert result[2]["saldo_acumulado"] == Decimal("1200.00")

    def test_three_rows_mixed_types_running_balance(self):
        from app.services.proveedor_service import _build_historial

        f1 = FakeFactura(uuid.uuid4(), date(2026, 1, 1), Decimal("100.00"), datetime(2026, 1, 1))
        f2 = FakeFactura(uuid.uuid4(), date(2026, 2, 1), Decimal("200.00"), datetime(2026, 2, 1))
        p1 = FakePago(uuid.uuid4(), date(2026, 1, 15), Decimal("50.00"), datetime(2026, 1, 15))

        result = _build_historial([f1, f2], [p1])

        assert result[0]["saldo_acumulado"] == Decimal("100.00")
        assert result[1]["saldo_acumulado"] == Decimal("50.00")
        assert result[2]["saldo_acumulado"] == Decimal("250.00")


# ── Determinism under identical fecha ────────────────────────────────────────


class TestDeterminism:
    def test_same_fecha_tiebreak_by_created_at(self):
        """Three rows on the same date: ordered by (created_at ASC, id ASC)."""
        from app.services.proveedor_service import _build_historial

        f1 = FakeFactura(uuid.uuid4(), date(2026, 6, 1), Decimal("100.00"), datetime(2026, 6, 1, 8, 0))
        f2 = FakeFactura(uuid.uuid4(), date(2026, 6, 1), Decimal("200.00"), datetime(2026, 6, 1, 9, 0))
        f3 = FakeFactura(uuid.uuid4(), date(2026, 6, 1), Decimal("300.00"), datetime(2026, 6, 1, 10, 0))

        result = _build_historial([f1, f2, f3], [])

        # Should preserve insertion order (created_at tiebreak)
        assert result[0]["monto"] == Decimal("100.00")
        assert result[1]["monto"] == Decimal("200.00")
        assert result[2]["monto"] == Decimal("300.00")

    def test_same_fecha_and_created_at_tiebreak_by_id(self):
        """When fecha AND created_at are identical, the order is by id ASC."""
        from app.services.proveedor_service import _build_historial

        same_dt = datetime(2026, 6, 1, 10, 0, 0)
        f_a = FakeFactura(uuid.UUID("00000000-0000-0000-0000-000000000001"), date(2026, 6, 1), Decimal("100"), same_dt)
        f_b = FakeFactura(uuid.UUID("00000000-0000-0000-0000-000000000002"), date(2026, 6, 1), Decimal("200"), same_dt)
        f_c = FakeFactura(uuid.UUID("00000000-0000-0000-0000-000000000003"), date(2026, 6, 1), Decimal("300"), same_dt)

        result = _build_historial([f_a, f_b, f_c], [])

        assert result[0]["id"] == f_a.id
        assert result[1]["id"] == f_b.id
        assert result[2]["id"] == f_c.id

    def test_factura_and_pago_on_same_fecha_ordered_by_created_at(self):
        from app.services.proveedor_service import _build_historial

        f1 = FakeFactura(uuid.uuid4(), date(2026, 6, 1), Decimal("100"), datetime(2026, 6, 1, 10, 0))
        p1 = FakePago(uuid.uuid4(), date(2026, 6, 1), Decimal("50"), datetime(2026, 6, 1, 11, 0))

        result = _build_historial([f1], [p1])

        assert result[0]["tipo"] == "FACTURA"
        assert result[1]["tipo"] == "PAGO"

    def test_call_is_pure_and_idempotent(self):
        """Two calls with the same input must produce the same output (no hidden state)."""
        from app.services.proveedor_service import _build_historial

        f1 = FakeFactura(uuid.uuid4(), date(2026, 6, 1), Decimal("100"), datetime(2026, 6, 1, 10, 0))
        p1 = FakePago(uuid.uuid4(), date(2026, 6, 2), Decimal("50"), datetime(2026, 6, 2, 10, 0))

        r1 = _build_historial([f1], [p1])
        r2 = _build_historial([f1], [p1])

        assert r1 == r2


# ── Triangulate: large lists & mixed signs ───────────────────────────────────


class TestScaleAndEdgeCases:
    def test_large_lists_alternating(self):
        """1000 facturas + 1000 pagos alternating — must scale (no O(n²))."""
        import time
        from app.services.proveedor_service import _build_historial

        # Interleave by id
        f_ids = [uuid.uuid4() for _ in range(1000)]
        p_ids = [uuid.uuid4() for _ in range(1000)]

        # Mix by date: each pair (f, p) shares the same day but p has later created_at
        facturas = [
            FakeFactura(
                f_ids[i],
                date(2026, 1, 1) if i == 0 else date(2026, 1, 1),
                Decimal("100.00"),
                datetime(2026, 1, 1, 9, 0, 0, 0, None) if i == 0 else datetime(2026, 1, 1, 9, 0, 0, 0, None),
            )
            for i in range(1000)
        ]
        pagos = [
            FakePago(
                p_ids[i],
                date(2026, 1, 1),
                Decimal("50.00"),
                datetime(2026, 1, 1, 10, 0, 0, 0, None),
            )
            for i in range(1000)
        ]

        t0 = time.perf_counter()
        result = _build_historial(facturas, pagos)
        elapsed = time.perf_counter() - t0

        assert len(result) == 2000
        # 2 * 1000 = 2000 rows; pure sort+walk should be well under 1s
        assert elapsed < 1.0, f"_build_historial took {elapsed:.2f}s — possibly O(n²)"

    def test_mixed_signs_at_boundary_pago_cancels_last_cent(self):
        """A pago of 0.01 that exactly cancels the previous factura's last 0.01."""
        from app.services.proveedor_service import _build_historial

        f1 = FakeFactura(uuid.uuid4(), date(2026, 6, 1), Decimal("100.00"), datetime(2026, 6, 1, 10, 0))
        f2 = FakeFactura(uuid.uuid4(), date(2026, 6, 2), Decimal("50.00"), datetime(2026, 6, 2, 10, 0))
        p1 = FakePago(uuid.uuid4(), date(2026, 6, 3), Decimal("150.00"), datetime(2026, 6, 3, 10, 0))

        result = _build_historial([f1, f2], [p1])

        # F1=100 → F2=150 → P1=0
        assert result[0]["saldo_acumulado"] == Decimal("100.00")
        assert result[1]["saldo_acumulado"] == Decimal("150.00")
        assert result[2]["saldo_acumulado"] == Decimal("0.00")

    def test_returns_dicts_not_orm_objects(self):
        """`_build_historial` returns plain dicts, not ORM objects. The service
        is Pydantic-agnostic (D13 — schemas are mapped at the router)."""
        from app.services.proveedor_service import _build_historial

        f1 = FakeFactura(uuid.uuid4(), date(2026, 6, 1), Decimal("100"), datetime(2026, 6, 1))
        result = _build_historial([f1], [])
        assert isinstance(result, list)
        assert isinstance(result[0], dict)
        assert set(result[0].keys()) >= {"id", "tipo", "fecha", "monto", "saldo_acumulado"}
