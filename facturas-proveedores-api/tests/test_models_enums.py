"""
Tests for domain enums (TDD - RED phase).

Spec: Enums de dominio
- TemaPreferido: CLARO, OSCURO
- CategoriaProveedor: INSUMO, SERVICIO, OTRO
- OrigenDocumento: MANUAL, IA
- MetodoPago: EFECTIVO, TRANSFERENCIA, TARJETA, MERCADOPAGO, OTRO
"""

import pytest


def test_tema_preferido_values():
    """Spec: TemaPreferido must have exactly CLARO and OSCURO."""
    from app.models.enums import TemaPreferido

    members = {m.value for m in TemaPreferido}
    assert members == {"CLARO", "OSCURO"}


def test_categoria_proveedor_values():
    """Spec: CategoriaProveedor must have exactly INSUMO, SERVICIO, OTRO."""
    from app.models.enums import CategoriaProveedor

    members = {m.value for m in CategoriaProveedor}
    assert members == {"INSUMO", "SERVICIO", "OTRO"}


def test_origen_documento_values():
    """Spec: OrigenDocumento must have exactly MANUAL and IA."""
    from app.models.enums import OrigenDocumento

    members = {m.value for m in OrigenDocumento}
    assert members == {"MANUAL", "IA"}


def test_metodo_pago_values():
    """Spec: MetodoPago must have exactly 5 values."""
    from app.models.enums import MetodoPago

    members = {m.value for m in MetodoPago}
    assert members == {"EFECTIVO", "TRANSFERENCIA", "TARJETA", "MERCADOPAGO", "OTRO"}


def test_enums_are_str_enum():
    """Enums must be str subclasses (allow direct string comparison)."""
    from app.models.enums import TemaPreferido, CategoriaProveedor, OrigenDocumento, MetodoPago

    assert isinstance(TemaPreferido.CLARO, str)
    assert isinstance(CategoriaProveedor.INSUMO, str)
    assert isinstance(OrigenDocumento.MANUAL, str)
    assert isinstance(MetodoPago.EFECTIVO, str)


def test_enum_string_comparison():
    """Spec: str,Enum allows direct comparison with string values."""
    from app.models.enums import MetodoPago, TemaPreferido

    assert MetodoPago.TRANSFERENCIA == "TRANSFERENCIA"
    assert TemaPreferido.OSCURO == "OSCURO"
