"""
Domain models package.

Import order matters for SQLModel metadata registration:
enums → base → usuario → proveedor → factura → pago
(dependency order: FKs must reference already-registered tables)
"""

from app.models.enums import TemaPreferido, CategoriaProveedor, OrigenDocumento, MetodoPago
from app.models.base import TimestampUUIDMixin, SoftDeleteMixin
from app.models.usuario import Usuario
from app.models.proveedor import Proveedor
from app.models.factura import Factura, FacturaItem
from app.models.pago import Pago
from app.models.refresh_token import RefreshToken

__all__ = [
    "TemaPreferido",
    "CategoriaProveedor",
    "OrigenDocumento",
    "MetodoPago",
    "TimestampUUIDMixin",
    "SoftDeleteMixin",
    "Usuario",
    "Proveedor",
    "Factura",
    "FacturaItem",
    "Pago",
    "RefreshToken",
]
