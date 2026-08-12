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


class FormaPago(str, enum.Enum):
    """How a Venta was paid (C-33).

    CUENTA_CORRIENTE is the fiado: the sale happened, the money did not. It is
    a payment method rather than a separate entity on purpose (D-33) — that one
    row is both the day's sale and the charge on the customer's account, so the
    two can never drift apart.

    Deliberately not MetodoPago: that one is for money going OUT to suppliers
    and carries MERCADOPAGO but no notion of credit. Sharing them would mean a
    supplier payment could be "on account", which is not a thing here.
    """

    EFECTIVO = "EFECTIVO"
    TRANSFERENCIA = "TRANSFERENCIA"
    TARJETA = "TARJETA"
    CUENTA_CORRIENTE = "CUENTA_CORRIENTE"
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


class MetodoCobro(str, enum.Enum):
    """Payment method for a CobroCliente — money coming IN from a customer (C-35).

    Deliberately not MetodoPago: that one is for money going OUT to suppliers
    and carries MERCADOPAGO, which has no place here. Deliberately no
    CUENTA_CORRIENTE either — debt is not cancelled with debt.
    """

    EFECTIVO = "EFECTIVO"
    TRANSFERENCIA = "TRANSFERENCIA"
    TARJETA = "TARJETA"
    OTRO = "OTRO"


class EstadoVentaFiada(str, enum.Enum):
    """
    Derived state of a fiado (a Venta with forma_pago=CUENTA_CORRIENTE),
    computed by the same FIFO allocation that drives EstadoFactura (C-35, D2).

    NEVER stored as a database column — always computed on-demand (D-01).

    Deliberately not EstadoFactura's PAGADA: a customer's sale reported as
    PAGADA would read as though the shop had paid it. COBRADA is the
    customer-side word for the same arithmetic outcome.
    """

    PENDIENTE = "PENDIENTE"
    PARCIAL = "PARCIAL"
    COBRADA = "COBRADA"


__all__ = [
    "TemaPreferido",
    "CategoriaProveedor",
    "OrigenDocumento",
    "MetodoPago",
    "FormaPago",
    "EstadoFactura",
    "MetodoCobro",
    "EstadoVentaFiada",
]
