"""
ExportacionCuentaCorrienteService — orchestrates a cuenta-corriente export
(C-39).

Design decisions implemented (design.md D1, D2, D4, D5, D6):

- D1: this service calls `ProveedorService.get_cuenta_corriente` /
  `ClienteService.get_cuenta_corriente` — the SAME on-demand composition the
  screen uses — and hands the result to the pure `armar_documento`. It never
  imports a repository and never imports `cuenta_corriente_engine`
  (verified structurally in `tests/test_c39_exportacion_service.py`,
  mirroring the spirit of the C-28 scoping guard). The one direct model
  lookup here — `session.get(Negocio, negocio_id)` — is metadata for the
  header (the business name), not financial data; it carries no divergence
  risk because it is not part of saldo/historial at all.

- D2: ownership verification happens by calling `get_cuenta_corriente`
  FIRST — it raises 404 on a foreign/missing/deleted resource before this
  service does anything else, so a foreign resource never reaches document
  generation (task 6.5).

- D4: `desde`/`hasta` with `incluir_historial=False` is rejected with 422 —
  never silently ignored (a document with a requested range and zero rows
  reads as a bug, not a response).

- D5: the row cap (`exportacion_topes.verificar_tope`) is checked AFTER the
  document is armed (so the row count is post-filter) and BEFORE any bytes
  are generated.

- D6: the download filename is built here, from the SAME `nombre_cuenta`
  used inside the document (never composed twice).

Fechas: "hoy" se calcula en America/Argentina/Buenos_Aires (UTC-3, regla
dura #11) — mismo huso que el resto del backend (`pago_service`,
`factura_service`, `cobro_cliente_service`).
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.negocio import Negocio
from app.services.cliente_service import ClienteService
from app.services.exportacion_armador import armar_documento
from app.services.exportacion_generadores import (
    CONTENT_TYPE_PDF,
    CONTENT_TYPE_XLSX,
    construir_nombre_archivo,
    generar_pdf,
    generar_xlsx,
)
from app.services.exportacion_topes import TOPE_FILAS, verificar_tope
from app.services.proveedor_service import ProveedorService

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

Formato = Literal["pdf", "xlsx"]

_RANGO_SIN_HISTORIAL = HTTPException(
    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    detail=(
        "desde/hasta requieren incluir_historial=true — un rango de fechas "
        "sin historial no tiene qué filtrar."
    ),
)


def _hoy_ar() -> date:
    return datetime.now(_TZ_AR).date()


@dataclass(frozen=True)
class ArchivoExportado:
    contenido: bytes
    content_type: str
    filename: str


class ExportacionCuentaCorrienteService:
    def __init__(self, session: Session) -> None:
        self._session = session
        self._proveedor_service = ProveedorService(session)
        self._cliente_service = ClienteService(session)

    # ── Public API ─────────────────────────────────────────────────────────

    def exportar_proveedor(
        self,
        negocio_id: uuid.UUID,
        proveedor_id: uuid.UUID,
        *,
        formato: Formato,
        incluir_historial: bool = False,
        desde: Optional[date] = None,
        hasta: Optional[date] = None,
    ) -> ArchivoExportado:
        self._validar_parametros(incluir_historial, desde, hasta)

        # Ownership check FIRST (raises 404 before anything else — task 6.5).
        cuenta = self._proveedor_service.get_cuenta_corriente(negocio_id, proveedor_id)
        proveedor = self._proveedor_service.get(negocio_id, proveedor_id)
        negocio = self._session.get(Negocio, negocio_id)

        documento = armar_documento(
            saldo=cuenta.saldo,
            historial=cuenta.historial,
            nombre_cuenta=proveedor.nombre,
            nombre_negocio=negocio.nombre if negocio is not None else "",
            fecha_emision=_hoy_ar(),
            incluir_historial=incluir_historial,
            desde=desde,
            hasta=hasta,
        )
        verificar_tope(len(documento.filas), formato)
        return self._generar_archivo(documento, formato)

    def exportar_cliente(
        self,
        negocio_id: uuid.UUID,
        cliente_id: uuid.UUID,
        *,
        formato: Formato,
        incluir_historial: bool = False,
        desde: Optional[date] = None,
        hasta: Optional[date] = None,
    ) -> ArchivoExportado:
        self._validar_parametros(incluir_historial, desde, hasta)

        # Ownership check FIRST (raises 404 before anything else — task 6.5).
        cuenta = self._cliente_service.get_cuenta_corriente(negocio_id, cliente_id)
        cliente = self._cliente_service.get(negocio_id, cliente_id)
        negocio = self._session.get(Negocio, negocio_id)

        documento = armar_documento(
            saldo=cuenta.saldo,
            historial=cuenta.historial,
            nombre_cuenta=cliente.nombre,
            nombre_negocio=negocio.nombre if negocio is not None else "",
            fecha_emision=_hoy_ar(),
            incluir_historial=incluir_historial,
            desde=desde,
            hasta=hasta,
        )
        verificar_tope(len(documento.filas), formato)
        return self._generar_archivo(documento, formato)

    # ── Private helpers ────────────────────────────────────────────────────

    @staticmethod
    def _validar_parametros(
        incluir_historial: bool, desde: Optional[date], hasta: Optional[date]
    ) -> None:
        if not incluir_historial and (desde is not None or hasta is not None):
            raise _RANGO_SIN_HISTORIAL

    @staticmethod
    def _generar_archivo(documento, formato: Formato) -> ArchivoExportado:
        if formato == "pdf":
            contenido = generar_pdf(documento)
            content_type = CONTENT_TYPE_PDF
        else:
            contenido = generar_xlsx(documento)
            content_type = CONTENT_TYPE_XLSX

        filename = construir_nombre_archivo(documento.nombre_cuenta, documento.fecha_emision, formato)
        return ArchivoExportado(contenido=contenido, content_type=content_type, filename=filename)


__all__ = ["ExportacionCuentaCorrienteService", "ArchivoExportado", "TOPE_FILAS"]
