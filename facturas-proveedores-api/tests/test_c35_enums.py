"""
Tests for the two enums C-35 introduces: `MetodoCobro` and `EstadoVentaFiada`.

Task 3.1 / 3.2 (TDD RED, then GREEN).
"""

import enum

import pytest


def test_metodo_cobro_values():
    """MetodoCobro: exactly EFECTIVO, TRANSFERENCIA, TARJETA, OTRO.

    No MERCADOPAGO (that is a supplier-payment method, MetodoPago) and no
    CUENTA_CORRIENTE (debt is not cancelled with debt).
    """
    from app.models.enums import MetodoCobro

    members = {m.value for m in MetodoCobro}
    assert members == {"EFECTIVO", "TRANSFERENCIA", "TARJETA", "OTRO"}


def test_metodo_cobro_is_str_enum():
    from app.models.enums import MetodoCobro

    assert isinstance(MetodoCobro.EFECTIVO, str)
    assert MetodoCobro.EFECTIVO == "EFECTIVO"


def test_estado_venta_fiada_values():
    """EstadoVentaFiada: exactly PENDIENTE, PARCIAL, COBRADA — never PAGADA,
    which would read as though the shop had paid its own customer."""
    from app.models.enums import EstadoVentaFiada

    members = {m.value for m in EstadoVentaFiada}
    assert members == {"PENDIENTE", "PARCIAL", "COBRADA"}


def test_estado_venta_fiada_is_python_only_str_enum():
    """D-01: derived state is never a Postgres type — a plain Python str,Enum."""
    from app.models.enums import EstadoVentaFiada

    assert issubclass(EstadoVentaFiada, str)
    assert issubclass(EstadoVentaFiada, enum.Enum)
    assert EstadoVentaFiada.COBRADA == "COBRADA"


def test_estado_venta_fiada_has_no_postgres_type():
    """No `estadoventafiada` (or similar) Postgres enum type should ever be
    created by any migration — this state is computed, never stored (D-01)."""
    from pathlib import Path

    alembic_dir = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    for path in alembic_dir.glob("*.py"):
        contents = path.read_text(encoding="utf-8")
        assert "estadoventafiada" not in contents.lower(), (
            f"{path.name} references an estado-venta-fiada Postgres type — "
            f"this state must never be persisted (D-01)."
        )
