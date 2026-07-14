"""
Domain enums — all are str,Enum so they serialize directly and
compare with plain strings (convenient for Pydantic schemas).

Decision D-C02-3: str,Enum mapped to enum/varchar in Postgres.
"""

import enum


class TemaPreferido(str, enum.Enum):
    """Preferred UI theme for a user."""

    CLARO = "CLARO"
    OSCURO = "OSCURO"


class CategoriaProveedor(str, enum.Enum):
    """Classification of a supplier."""

    INSUMO = "INSUMO"
    SERVICIO = "SERVICIO"
    OTRO = "OTRO"


class OrigenDocumento(str, enum.Enum):
    """Origin of a document (invoice or payment record)."""

    MANUAL = "MANUAL"
    IA = "IA"


class MetodoPago(str, enum.Enum):
    """Payment method for a Pago."""

    EFECTIVO = "EFECTIVO"
    TRANSFERENCIA = "TRANSFERENCIA"
    TARJETA = "TARJETA"
    MERCADOPAGO = "MERCADOPAGO"
    OTRO = "OTRO"


class EstadoFactura(str, enum.Enum):
    """
    Derived state of an invoice computed by the FIFO algorithm (RN-FIFO).

    NEVER stored as a database column — always computed on-demand in the service
    layer by applying virtual payment allocation from oldest to newest invoice.
    """

    PENDIENTE = "PENDIENTE"
    PARCIAL = "PARCIAL"
    PAGADA = "PAGADA"


__all__ = [
    "TemaPreferido",
    "CategoriaProveedor",
    "OrigenDocumento",
    "MetodoPago",
    "EstadoFactura",
]
