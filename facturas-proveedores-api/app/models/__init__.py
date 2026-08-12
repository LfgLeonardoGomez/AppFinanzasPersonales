"""
Domain models package.

Import order matters for SQLModel metadata registration:
enums → base → negocio → usuario → proveedor → factura → pago
(dependency order: FKs must reference already-registered tables)

`negocio` leads because every other business table has an FK to it (D-27).
"""

from app.models.enums import (
    TemaPreferido,
    CategoriaProveedor,
    OrigenDocumento,
    MetodoPago,
    FormaPago,
)
from app.models.base import TimestampUUIDMixin, SoftDeleteMixin
from app.models.negocio import Negocio
from app.models.usuario import Usuario
from app.models.proveedor import Proveedor
from app.models.factura import Factura, FacturaItem
from app.models.pago import Pago
from app.models.refresh_token import RefreshToken
from app.models.invitacion_empleado import InvitacionEmpleado
from app.models.cliente import Cliente
from app.models.token_reset import TokenReset
from app.models.venta import Venta

__all__ = [
    "TemaPreferido",
    "CategoriaProveedor",
    "OrigenDocumento",
    "MetodoPago",
    "TimestampUUIDMixin",
    "SoftDeleteMixin",
    "Negocio",
    "Usuario",
    "Proveedor",
    "Factura",
    "FacturaItem",
    "Pago",
    "RefreshToken",
    "InvitacionEmpleado",
    "Cliente",
    "TokenReset",
    "Venta",
    "FormaPago",
]
