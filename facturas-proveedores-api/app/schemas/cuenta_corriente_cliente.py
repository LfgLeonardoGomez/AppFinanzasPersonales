"""
Pydantic schemas for the customer cuenta-corriente endpoint (C-35).

Output-only schemas — mirrors app/schemas/cuenta_corriente.py exactly, mapped
onto the customer ledger's own vocabulary (D2, D7):
- VentaConEstado: a fiado (Venta) with its FIFO-computed EstadoVentaFiada.
- EntradaHistorialCliente: one row of the chronological merge — `tipo` is
  VENTA (debit) or COBRO (credit), never FACTURA/PAGO.
- CuentaCorrienteClienteResponse: the top-level triple — cliente_id, saldo,
  ventas_con_estado, historial. `saldo` is SIGNED and MAY be negative (D4).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EstadoVentaFiada, FormaPago


class VentaConEstado(BaseModel):
    """A fiado (Venta with forma_pago=CUENTA_CORRIENTE) with its FIFO estado."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    negocio_id: uuid.UUID
    cliente_id: Optional[uuid.UUID] = None
    fecha: date
    monto: Decimal
    forma_pago: FormaPago
    notas: Optional[str] = None

    # Computed on-demand by FIFO — never persisted on the row.
    estado: EstadoVentaFiada

    created_at: datetime
    updated_at: datetime


class EntradaHistorialCliente(BaseModel):
    """
    A single row in the chronological merge of ventas fiadas (debe) and
    cobros (haber).

    - `id`: underlying row's id (venta_id or cobro_id).
    - `tipo`: discriminator — VENTA adds, COBRO subtracts.
    - `monto`: always positive. The sign is implicit in `tipo`.
    - `saldo_acumulado`: signed running balance at this row.
    - `archivo_url`: the attached file for this row — `comprobante_url` for
      COBRO rows, always `None` for VENTA rows (a sale has no attachment
      today, see design.md Open Question 3).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tipo: Literal["VENTA", "COBRO"]
    fecha: date
    monto: Decimal = Field(gt=0, description="Amount (always positive; sign implicit in tipo)")
    saldo_acumulado: Decimal
    archivo_url: Optional[str] = None


class CuentaCorrienteClienteResponse(BaseModel):
    """
    Top-level cuenta-corriente response for one customer.

    - `saldo`: SIGNED Decimal. Positive = customer owes money. MAY be
      negative (D4) — deleting a paid-off fiado or moving it out of
      CUENTA_CORRIENTE can leave more credited than charged; the API
      reports that honestly instead of clamping to zero.
    - `ventas_con_estado`: active fiados, each with its FIFO estado.
    - `historial`: chronological merge with row-by-row saldo_acumulado.
    """

    model_config = ConfigDict(from_attributes=True)

    cliente_id: uuid.UUID
    saldo: Decimal
    ventas_con_estado: list[VentaConEstado]
    historial: list[EntradaHistorialCliente]


__all__ = [
    "VentaConEstado",
    "EntradaHistorialCliente",
    "CuentaCorrienteClienteResponse",
]
