"""
Negocio model — the isolation unit of the system (D-27).

Every business entity (Proveedor, Factura, Pago) is scoped by `negocio_id`,
not by `usuario_id`: several people work the same shop, each with their own
account and device.

A Negocio is created ONLY by public registration, in the same transaction as
its first Usuario (D-30). There is no standalone "create negocio" endpoint.
"""

from sqlmodel import Field, SQLModel

from app.models.base import TimestampUUIDMixin


class Negocio(TimestampUUIDMixin, SQLModel, table=True):
    """
    Business entity — the tenant boundary.

    No soft delete: a negocio is not something the UI removes.
    """

    __tablename__ = "negocio"

    nombre: str = Field(nullable=False, max_length=120)


__all__ = ["Negocio"]
