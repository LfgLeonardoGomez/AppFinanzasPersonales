"""
Facturas router — HTTP endpoints for invoice management.

Design decisions (C-08 design.md):
- D8: Router stays thin. All business logic + authorization in FacturaService.
- D7: Service raises HTTPException(404) for foreign resources; router does not add logic.
- RN-FAC-09: estado_filtro is a query param but filtering is done in the SERVICE
  LAYER in Python AFTER FIFO computation — NEVER in SQL.

Pattern mirrors app/routers/proveedores.py:
- Router owns the session.commit() after mutations.
- Service raises HTTPExceptions; router does not add logic.
- Annotated style for all params and deps.
"""

import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.core.image_validation import validate_image_bytes
from app.core.rate_limit_ia import rate_limit_ia
from app.models.enums import EstadoFactura
from app.models.usuario import Usuario
from app.schemas.factura import (
    FacturaCreate,
    FacturaItemResponse,
    FacturaListItem,
    FacturaResponse,
    FacturaUpdate,
    PropuestaFactura,
)
from app.services.factura_service import FacturaService
from app.services.ia_extraccion_service import get_vision_extractor

router = APIRouter(prefix="/api/facturas", tags=["facturas"])

# Type aliases for shared dependencies (FastAPI SKILL pattern)
CurrentUser = Annotated[Usuario, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


def _to_response(result) -> FacturaResponse:
    """Map a FacturaConEstado to FacturaResponse."""
    return FacturaResponse(
        id=result.id,
        usuario_id=result.usuario_id,
        proveedor_id=result.proveedor_id,
        numero=result.numero,
        fecha_emision=result.fecha_emision,
        fecha_vencimiento=result.fecha_vencimiento,
        monto_total=result.monto_total,
        archivo_url=result.archivo_url,
        origen=result.origen,
        estado=result.estado,
        items=[
            FacturaItemResponse(
                id=item.id,
                factura_id=item.factura_id,
                descripcion=item.descripcion,
                cantidad=item.cantidad,
                precio_unitario=item.precio_unitario,
            )
            for item in result.items
        ],
        items_sum_mismatch=result.items_sum_mismatch,
        created_at=result.created_at,
        updated_at=result.updated_at,
    )


# ── GET / — paginated listing ─────────────────────────────────────────────────


@router.get(
    "",
    response_model=list[FacturaListItem],
    summary="List invoices with computed FIFO estado",
)
def list_facturas(
    proveedor_id: Annotated[
        Optional[uuid.UUID],
        Query(description="Filter by supplier UUID"),
    ] = None,
    estado: Annotated[
        Optional[EstadoFactura],
        Query(description="Filter by estado (applied in Python after FIFO, not SQL)"),
    ] = None,
    fecha_desde: Annotated[
        Optional[date],
        Query(description="Filter: fecha_emision >= fecha_desde"),
    ] = None,
    fecha_hasta: Annotated[
        Optional[date],
        Query(description="Filter: fecha_emision <= fecha_hasta"),
    ] = None,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> list[FacturaListItem]:
    """
    Return invoices for the authenticated user.

    estado is computed on-demand via the FIFO algorithm (RN-FIFO).
    Filtering by estado is applied IN PYTHON after computation — never in SQL
    (RN-FAC-09: do not add WHERE estado=... to the query).
    """
    svc = FacturaService(session)
    results = svc.listar(
        current_user.id,
        proveedor_id=proveedor_id,
        estado_filtro=estado,
        fecha_desde=fecha_desde,
        fecha_hasta=fecha_hasta,
    )
    return [
        FacturaListItem(
            id=r.id,
            proveedor_id=r.proveedor_id,
            numero=r.numero,
            fecha_emision=r.fecha_emision,
            monto_total=r.monto_total,
            estado=r.estado,
        )
        for r in results
    ]


# ── POST / — create invoice ───────────────────────────────────────────────────


@router.post(
    "",
    response_model=FacturaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new invoice",
)
def create_factura(
    body: FacturaCreate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> FacturaResponse:
    """
    Create an invoice for a supplier owned by the authenticated user.

    usuario_id is taken from the session — the payload cannot override it.
    origen is set to MANUAL automatically (RN-FAC-08).
    Returns 404 if the proveedor belongs to another user.
    """
    svc = FacturaService(session)
    result = svc.crear(current_user.id, body)
    session.commit()
    return _to_response(result)


# ── POST /extraer-ia — extract invoice header from image (C-14) ───────────────
# IMPORTANT: this route MUST be declared BEFORE GET /{factura_id} so the
# path param does not capture "extraer-ia" as a UUID (D-IA-12).
#
# The handler does NOT inject a DB session (RN-IA-04: no persistence on
# the IA path). It validates magic bytes in `app/core/image_validation.py`
# and delegates to the cached `get_vision_extractor()` factory.


@router.post(
    "/extraer-ia",
    response_model=PropuestaFactura,
    status_code=status.HTTP_200_OK,
    summary="Extraer cabecera de factura desde imagen con IA",
    description=(
        "Recibe una imagen (JPEG/PNG/WebP, máximo 10 MB) y devuelve una "
        "propuesta Pydantic NO persistida con los campos leídos por la IA. "
        "El usuario confirma después contra POST /api/facturas."
    ),
)
async def extraer_factura_ia(
    file: Annotated[
        UploadFile,
        File(description="Imagen de factura (jpg/png/webp, máx 10 MB)"),
    ],
    current_user: Annotated[Usuario, Depends(get_current_user)],
    _: Annotated[None, Depends(rate_limit_ia)] = None,
) -> PropuestaFactura:
    """Extract an invoice header from an image using the configured vision provider.

    The endpoint never raises to the caller. Any failure of the vision
    SDK is encapsulated in `PropuestaFactura.error=True` (RN-IA-05), so
    the response is always 200 with a JSON body the frontend can branch on.
    """
    image_bytes = await file.read()
    try:
        validate_image_bytes(image_bytes)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    extractor = get_vision_extractor()
    propuesta = await extractor.extraer_factura(
        image_bytes, file.content_type or "image/jpeg"
    )
    return propuesta


# ── GET /{id} — read invoice ──────────────────────────────────────────────────


@router.get(
    "/{factura_id}",
    response_model=FacturaResponse,
    summary="Get an invoice by ID",
)
def get_factura(
    factura_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> FacturaResponse:
    """
    Return a single invoice with its computed estado and items.

    Returns 404 if the invoice belongs to another user or is soft-deleted.
    """
    svc = FacturaService(session)
    result = svc.get(current_user.id, factura_id)
    return _to_response(result)


# ── PATCH /{id} — update invoice ─────────────────────────────────────────────


@router.patch(
    "/{factura_id}",
    response_model=FacturaResponse,
    summary="Update an invoice (partial)",
)
def update_factura(
    factura_id: Annotated[uuid.UUID, ...],
    body: FacturaUpdate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> FacturaResponse:
    """
    Partially update an invoice owned by the authenticated user.

    If items are provided, they replace the existing items atomically.
    Returns 404 if the invoice belongs to another user or is soft-deleted.
    """
    svc = FacturaService(session)
    result = svc.actualizar(current_user.id, factura_id, body)
    session.commit()
    return _to_response(result)


# ── DELETE /{id} — soft-delete invoice ───────────────────────────────────────


@router.delete(
    "/{factura_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete an invoice",
)
def delete_factura(
    factura_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> None:
    """
    Soft-delete an invoice owned by the authenticated user.

    The row is preserved (FK integrity). Deleting an invoice does NOT affect
    payments (RN-FAC-06: pagos link to proveedor, not factura).
    Returns 404 if the invoice belongs to another user or is already deleted.
    """
    svc = FacturaService(session)
    svc.eliminar(current_user.id, factura_id)
    session.commit()


__all__ = ["router"]
