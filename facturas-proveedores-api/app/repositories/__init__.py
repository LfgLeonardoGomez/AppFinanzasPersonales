"""
Repositories package — data access layer.

All repositories extend BaseRepository and enforce:
- CRUD + soft delete operations only
- NO business logic, NO invariant validation
- NO authorization (service layer handles that)
"""

from app.repositories.base_repository import BaseRepository
from app.repositories.usuario_repository import UsuarioRepository
from app.repositories.proveedor_repository import ProveedorRepository
from app.repositories.factura_repository import FacturaRepository, FacturaItemRepository
from app.repositories.pago_repository import PagoRepository

__all__ = [
    "BaseRepository",
    "UsuarioRepository",
    "ProveedorRepository",
    "FacturaRepository",
    "FacturaItemRepository",
    "PagoRepository",
]
