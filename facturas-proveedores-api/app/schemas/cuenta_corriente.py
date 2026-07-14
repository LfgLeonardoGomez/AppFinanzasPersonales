"""
Pydantic schemas for the cuenta-corriente endpoint (C-12).

Output-only schemas. The endpoint has no request body and no query params,
so no input schemas are required (RN-PAG-01 precedent: no extra="forbid"
needed on outputs).

Design decisions (design.md D5):
- FacturaConEstado: mirrors FacturaResponse (C-08) without `items` and
  `items_sum_mismatch`. Adds `estado: EstadoFactura` (computed by FIFO).
- EntradaHistorial: a row in the chronological merge. `id` is the underlying
  row's id (factura_id or pago_id). `monto` is always positive (the sign
  is implicit in `tipo`); `saldo_acumulado` is signed.
- CuentaCorrienteResponse: top-level — proveedor_id, saldo, facturas_con_estado,
  historial. `from_attributes=True` so the router can `model_validate` the
  service-layer result directly.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import EstadoFactura, OrigenDocumento


class FacturaConEstado(BaseModel):
    """
    Supplier-facing invoice with its FIFO-computed estado.

    Omits `items` and `items_sum_mismatch` (the cuenta-corriente view does
    not need line items; the detalle page fetches them separately).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    usuario_id: uuid.UUID
    proveedor_id: uuid.UUID
    numero: Optional[str] = None
    fecha_emision: date
    fecha_vencimiento: Optional[date] = None
    monto_total: Decimal
    archivo_url: Optional[str] = None
    origen: OrigenDocumento

    # Computed on-demand by FIFO — never persisted on the row.
    estado: EstadoFactura

    created_at: datetime
    updated_at: datetime


class EntradaHistorial(BaseModel):
    """
    A single row in the chronological merge of facturas (debe) and pagos (haber).

    - `id`: underlying row's id (factura_id or pago_id). Frontend can deep-link.
    - `tipo`: discriminator — FACTURA adds, PAGO subtracts.
    - `monto`: always positive. The sign is implicit in `tipo`.
    - `saldo_acumulado`: signed running balance at this row. Positive = deuda.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    tipo: Literal["FACTURA", "PAGO"]
    fecha: date
    monto: Decimal = Field(gt=0, description="Amount (always positive; sign implicit in tipo)")
    saldo_acumulado: Decimal


class CuentaCorrienteResponse(BaseModel):
    """
    Top-level cuenta-corriente response for one supplier.

    - `saldo`: signed Decimal — > 0 deuda, = 0 al día, < 0 a favor.
    - `facturas_con_estado`: active invoices with their FIFO estado.
    - `historial`: chronological merge of active facturas and pagos with
      row-by-row `saldo_acumulado`.
    """

    model_config = ConfigDict(from_attributes=True)

    proveedor_id: uuid.UUID
    saldo: Decimal
    facturas_con_estado: list[FacturaConEstado]
    historial: list[EntradaHistorial]


__all__ = [
    "FacturaConEstado",
    "EntradaHistorial",
    "CuentaCorrienteResponse",
]
