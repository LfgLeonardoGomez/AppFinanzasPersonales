"""
Tests for the FIFO estado computation algorithm (Task 3.1 — TDD RED, then GREEN).

_compute_estado_fifo is a PURE FUNCTION in the service layer.
No DB access needed. Tests are fast and deterministic.

RN-FIFO rules exercised:
- RN-FIFO-01: order by (fecha_emision ASC, created_at ASC, id ASC)
- RN-FIFO-02: pool = ALL active payments for the proveedor (not per-date)
- RN-FIFO-03: adding/editing/deleting changes multiple invoice states at once

Invariants:
- pool=0 → all PENDIENTE
- pool >= sum(all facturas) → all PAGADA, leftover pool is saldo a favor
- partial pool → covers oldest first; PAGADA→PARCIAL→PENDIENTE waterfall
- pool exactly equal to one invoice → PAGADA (not PARCIAL)
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import MagicMock

import pytest

from app.models.enums import EstadoFactura


def _make_factura_mock(
    id: uuid.UUID | None = None,
    monto_total: Decimal = Decimal("100.00"),
    fecha_emision: date | None = None,
    created_at: datetime | None = None,
) -> MagicMock:
    """Create a minimal Factura-like mock for FIFO testing."""
    m = MagicMock()
    m.id = id or uuid.uuid4()
    m.monto_total = monto_total
    m.fecha_emision = fecha_emision or date.today()
    m.created_at = created_at or datetime.now(timezone.utc)
    return m


# ── Pool = 0 ──────────────────────────────────────────────────────────────────


class TestFifoPoolZero:
    def test_all_pendiente_when_pool_zero(self):
        from app.services.factura_service import _compute_estado_fifo

        f1 = _make_factura_mock(monto_total=Decimal("100.00"))
        f2 = _make_factura_mock(monto_total=Decimal("200.00"))
        f3 = _make_factura_mock(monto_total=Decimal("50.00"))

        result = _compute_estado_fifo([f1, f2, f3], pool=Decimal("0"))

        assert result[f1.id] == EstadoFactura.PENDIENTE
        assert result[f2.id] == EstadoFactura.PENDIENTE
        assert result[f3.id] == EstadoFactura.PENDIENTE

    def test_single_factura_pendiente_when_pool_zero(self):
        from app.services.factura_service import _compute_estado_fifo

        f = _make_factura_mock(monto_total=Decimal("500.00"))
        result = _compute_estado_fifo([f], pool=Decimal("0"))
        assert result[f.id] == EstadoFactura.PENDIENTE


# ── Pool >= sum ───────────────────────────────────────────────────────────────


class TestFifoPoolCoversAll:
    def test_all_pagada_when_pool_covers_all(self):
        from app.services.factura_service import _compute_estado_fifo

        f1 = _make_factura_mock(monto_total=Decimal("100.00"))
        f2 = _make_factura_mock(monto_total=Decimal("200.00"))

        result = _compute_estado_fifo([f1, f2], pool=Decimal("300.00"))

        assert result[f1.id] == EstadoFactura.PAGADA
        assert result[f2.id] == EstadoFactura.PAGADA

    def test_pagada_with_overpayment(self):
        """Pool > sum → all PAGADA. Leftover is saldo a favor (not tested here)."""
        from app.services.factura_service import _compute_estado_fifo

        f = _make_factura_mock(monto_total=Decimal("100.00"))
        result = _compute_estado_fifo([f], pool=Decimal("150.00"))
        assert result[f.id] == EstadoFactura.PAGADA

    def test_exactly_covers_invoice_is_pagada_not_parcial(self):
        """pool == monto_total → PAGADA (boundary: 0 < applied >= monto_total)."""
        from app.services.factura_service import _compute_estado_fifo

        f = _make_factura_mock(monto_total=Decimal("100.00"))
        result = _compute_estado_fifo([f], pool=Decimal("100.00"))
        assert result[f.id] == EstadoFactura.PAGADA


# ── Partial pool ──────────────────────────────────────────────────────────────


class TestFifoPartialPool:
    def test_oldest_paid_newest_pending(self):
        """
        3 invoices of 100 each. Pool = 150.
        Expected: f_oldest=PAGADA, f_middle=PARCIAL, f_newest=PENDIENTE.
        Facturas must be passed in FIFO order (oldest first).
        """
        from app.services.factura_service import _compute_estado_fifo

        yesterday = date.today() - timedelta(days=2)
        two_days_ago = date.today() - timedelta(days=3)
        today = date.today()

        f1 = _make_factura_mock(monto_total=Decimal("100.00"), fecha_emision=two_days_ago)
        f2 = _make_factura_mock(monto_total=Decimal("100.00"), fecha_emision=yesterday)
        f3 = _make_factura_mock(monto_total=Decimal("100.00"), fecha_emision=today)

        # Pool of 150 → f1 gets 100 (PAGADA), f2 gets 50 (PARCIAL), f3 gets 0 (PENDIENTE)
        result = _compute_estado_fifo([f1, f2, f3], pool=Decimal("150.00"))

        assert result[f1.id] == EstadoFactura.PAGADA
        assert result[f2.id] == EstadoFactura.PARCIAL
        assert result[f3.id] == EstadoFactura.PENDIENTE

    def test_single_factura_partial(self):
        """Single invoice with partial payment → PARCIAL."""
        from app.services.factura_service import _compute_estado_fifo

        f = _make_factura_mock(monto_total=Decimal("200.00"))
        result = _compute_estado_fifo([f], pool=Decimal("50.00"))
        assert result[f.id] == EstadoFactura.PARCIAL

    def test_pool_covers_first_two_not_third(self):
        """Pool = 300. Invoices: 100, 200, 150. First two PAGADA, third PENDIENTE."""
        from app.services.factura_service import _compute_estado_fifo

        today = date.today()
        f1 = _make_factura_mock(
            monto_total=Decimal("100.00"),
            fecha_emision=today - timedelta(days=2),
        )
        f2 = _make_factura_mock(
            monto_total=Decimal("200.00"),
            fecha_emision=today - timedelta(days=1),
        )
        f3 = _make_factura_mock(
            monto_total=Decimal("150.00"),
            fecha_emision=today,
        )

        result = _compute_estado_fifo([f1, f2, f3], pool=Decimal("300.00"))

        assert result[f1.id] == EstadoFactura.PAGADA
        assert result[f2.id] == EstadoFactura.PAGADA
        assert result[f3.id] == EstadoFactura.PENDIENTE


# ── Deterministic tiebreak ────────────────────────────────────────────────────


class TestFifoDeterministicOrder:
    def test_tiebreak_by_created_at_when_same_fecha_emision(self):
        """
        Two invoices with the same fecha_emision. Pool covers only one.
        The one with earlier created_at should be PAGADA (RN-FIFO-01).
        Caller is responsible for ordering; _compute_estado_fifo receives
        pre-ordered list.
        """
        from app.services.factura_service import _compute_estado_fifo

        today = date.today()
        earlier = datetime(2024, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
        later = datetime(2024, 1, 1, 11, 0, 0, tzinfo=timezone.utc)

        f_earlier = _make_factura_mock(
            monto_total=Decimal("100.00"),
            fecha_emision=today,
            created_at=earlier,
        )
        f_later = _make_factura_mock(
            monto_total=Decimal("100.00"),
            fecha_emision=today,
            created_at=later,
        )

        # Pool covers exactly one invoice. f_earlier is first in list (FIFO).
        result = _compute_estado_fifo([f_earlier, f_later], pool=Decimal("100.00"))

        assert result[f_earlier.id] == EstadoFactura.PAGADA
        assert result[f_later.id] == EstadoFactura.PENDIENTE

    def test_empty_facturas_returns_empty_dict(self):
        from app.services.factura_service import _compute_estado_fifo

        result = _compute_estado_fifo([], pool=Decimal("1000.00"))
        assert result == {}
