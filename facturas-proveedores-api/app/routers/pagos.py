"""
Pagos router — HTTP endpoints for payment management.

Design decisions (C-10 design.md):
- D1: Schemas live in app.schemas.pago; the router imports from there.
  The C-08 inline `PagoCreate` / `PagoResponse` BaseModel definitions
  have been REMOVED — the C-08 stub was upgraded to the full CRUD in C-10.
- D9: Router stays thin. No business logic, no auth, no date validation.
  Each handler: dependency → service call → commit (on mutations) →
  schema mapping.
- D8: PATCH on proveedor_id is rejected at the schema level (extra="forbid").
- D11: GET listing returns a paginated response shaped as
  {items, total, page, page_size} so the frontend can use the same
  hook pattern as C-08's FacturaListItem.

Compatibility with C-08:
- The POST response shape (same fields, same order) is preserved so the
  C-08 integration test in test_factura_integration.py still passes.
- negocio_id comes from the session (get_current_user), never from the
  payload.
- origen is stamped MANUAL by the service — the schema has no such field.
"""

import uuid
from typing import Annotated, Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from pydantic import BaseModel, ConfigDict
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.core.image_validation import validate_image_bytes
from app.core.rate_limit_ia import rate_limit_ia
from app.models.pago import Pago
from app.models.usuario import Usuario
from app.repositories.proveedor_repository import ProveedorRepository
from app.schemas.pago import (
    PagoCreate,
    PagoListItem,
    PagoResponse,
    PagoUpdate,
    PropuestaPago,
)
from app.services.ia_extraccion_service import get_vision_extractor
from app.services.pago_service import PagoService


# ── Paginated list response ──────────────────────────────────────────────────


class PagoListResponse(BaseModel):
    """Paginated response wrapper for GET /api/pagos."""

    model_config = ConfigDict(from_attributes=True)

    items: list[PagoListItem]
    total: int
    page: int
    page_size: int


# ── Router setup ─────────────────────────────────────────────────────────────


router = APIRouter(prefix="/api/pagos", tags=["pagos"])

# Type aliases for shared dependencies (FastAPI SKILL pattern)
CurrentUser = Annotated[Usuario, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


def _to_response(
    pago: Pago,
    proveedor_nombre: Optional[str] = None,
) -> PagoResponse:
    """
    Map a Pago ORM entity to a PagoResponse schema.

    C-18 (FE-005): `proveedor_nombre` is an optional lookup passed in
    by the caller. The router fetches the supplier name (one extra
    query per call) so the frontend can show the supplier's name on
    the edit form instead of the UUID. When the supplier is
    soft-deleted, the caller passes `None` and the field defaults to
    `None` on the response (the field is Optional).
    """
    return PagoResponse(
        id=pago.id,
        negocio_id=pago.negocio_id,
        proveedor_id=pago.proveedor_id,
        monto=pago.monto,
        fecha=pago.fecha,
        metodo=pago.metodo,
        comprobante_url=pago.comprobante_url,
        origen=pago.origen,
        created_at=pago.created_at,
        updated_at=pago.updated_at,
        proveedor_nombre=proveedor_nombre,
    )


def _to_list_item(pago: Pago) -> PagoListItem:
    """Map a Pago ORM entity to a PagoListItem schema (lean row)."""
    return PagoListItem(
        id=pago.id,
        proveedor_id=pago.proveedor_id,
        monto=pago.monto,
        fecha=pago.fecha,
        metodo=pago.metodo,
        origen=pago.origen,
        created_at=pago.created_at,
    )


# ── Supplier-name lookup helper (c-18 FE-005) ───────────────────────────────


def _resolve_proveedor_nombre(
    session: Session,
    proveedor_id: uuid.UUID,
) -> Optional[str]:
    """
    Return the supplier's name for the given id, or None if the
    supplier is soft-deleted / does not exist.

    Used by the single-pago routes (POST/PATCH/GET /{id}) to populate
    the new `PagoResponse.proveedor_nombre` field (c-18 FE-005). The
    list endpoint does not carry proveedor_nombre on PagoListItem
    (per Q-C18-3 in the design), so the list path does not need this
    lookup.
    """
    repo = ProveedorRepository(session)
    proveedor = repo.get(proveedor_id)
    if proveedor is None or getattr(proveedor, "deleted_at", None) is not None:
        return None
    return proveedor.nombre


# ── GET / — paginated listing ─────────────────────────────────────────────────
#
# c-27 (design.md D1): the collection route is registered on BOTH "" and "/"
# so neither form redirects (307 would let a client rebuild the request from
# its own cookie jar, dropping an explicit Cookie header — see C-22). The
# "/" registration is kept out of the OpenAPI schema (include_in_schema=False)
# so the generated client sees one operation, not two.


@router.get(
    "",
    response_model=PagoListResponse,
    summary="List active payments for the authenticated user",
)
@router.get(
    "/",
    response_model=PagoListResponse,
    include_in_schema=False,
)
def list_pagos(
    proveedor_id: Annotated[
        Optional[uuid.UUID],
        Query(description="Filter by supplier UUID (foreign → 404)"),
    ] = None,
    page: Annotated[
        int,
        Query(ge=1, description="1-indexed page number"),
    ] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=200, description="Items per page (default 50)"),
    ] = 50,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> PagoListResponse:
    """
    Return active payments for the authenticated user.

    Soft-deleted pagos are excluded. When `proveedor_id` is provided, the
    list is filtered to that supplier (a foreign `proveedor_id` returns 404,
    not an empty list — same security baseline as the other endpoints).

    Returns a paginated response: {items, total, page, page_size}.
    """
    svc = PagoService(session)
    items, total = svc.listar(
        current_user.negocio_id,
        proveedor_id=proveedor_id,
        page=page,
        page_size=page_size,
    )
    return PagoListResponse(
        items=[_to_list_item(p) for p in items],
        total=total,
        page=page,
        page_size=page_size,
    )


# ── POST / — create payment ──────────────────────────────────────────────────


@router.post(
    "",
    response_model=PagoResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new payment",
)
@router.post(
    "/",
    response_model=PagoResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
def create_pago(
    body: PagoCreate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> PagoResponse:
    """
    Create a payment for a supplier owned by the authenticated user.

    - negocio_id is taken from the session — the payload cannot override it.
    - origen is set to MANUAL automatically by the service.
    - NO factura_id is accepted — RN-PAG-01 is enforced at three levels:
      1) the Pago SQLModel has no such column,
      2) PagoCreate / PagoUpdate don't declare the field,
      3) `extra="forbid"` on both input schemas rejects any payload
         attempting to send it.
    - Returns 404 if the proveedor belongs to another user or is soft-deleted.
    - Returns 422 if fecha is in the future (UTC-3) or monto <= 0.
    """
    svc = PagoService(session)
    pago = svc.crear(
        current_user.negocio_id, body, creado_por_usuario_id=current_user.id
    )
    session.commit()
    session.refresh(pago)
    # C-18 (FE-005): populate proveedor_nombre for the response.
    proveedor_nombre = _resolve_proveedor_nombre(session, pago.proveedor_id)
    return _to_response(pago, proveedor_nombre=proveedor_nombre)


# ── POST /extraer-ia — extract payment header from image (C-14) ────────────────
# IMPORTANT: this route MUST be declared BEFORE GET /{pago_id} so the
# path param does not capture "extraer-ia" as a UUID (D-IA-12).
#
# The handler does NOT inject a DB session (RN-IA-04: no persistence on
# the IA path). It validates magic bytes in `app/core/image_validation.py`
# and delegates to the cached `get_vision_extractor()` factory.


@router.post(
    "/extraer-ia",
    response_model=PropuestaPago,
    status_code=status.HTTP_200_OK,
    summary="Extraer cabecera de pago desde imagen con IA",
    description=(
        "Recibe una imagen (JPEG/PNG/WebP, máximo 10 MB) y devuelve una "
        "propuesta Pydantic NO persistida con los campos leídos por la IA. "
        "El usuario confirma después contra POST /api/pagos."
    ),
)
async def extraer_pago_ia(
    file: Annotated[
        UploadFile,
        File(description="Imagen de comprobante de pago (jpg/png/webp, máx 10 MB)"),
    ],
    current_user: Annotated[Usuario, Depends(get_current_user)],
    _: Annotated[None, Depends(rate_limit_ia)] = None,
) -> PropuestaPago:
    """Extract a payment header from an image using the configured vision provider.

    The endpoint never raises to the caller. Any failure of the vision
    SDK is encapsulated in `PropuestaPago.error=True` (RN-IA-05), so
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
    propuesta = await extractor.extraer_pago(
        image_bytes, file.content_type or "image/jpeg"
    )
    return propuesta


# ── GET /{id} — read payment ──────────────────────────────────────────────────


@router.get(
    "/{pago_id}",
    response_model=PagoResponse,
    summary="Get a payment by ID",
)
def get_pago(
    pago_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> PagoResponse:
    """
    Return a single payment owned by the authenticated user.

    Returns 404 if the payment belongs to another user or is soft-deleted
    (never 403 — foreign and missing are indistinguishable).
    """
    svc = PagoService(session)
    pago = svc.get(current_user.negocio_id, pago_id)
    # C-18 (FE-005): populate proveedor_nombre for the response.
    proveedor_nombre = _resolve_proveedor_nombre(session, pago.proveedor_id)
    return _to_response(pago, proveedor_nombre=proveedor_nombre)


# ── PATCH /{id} — update payment ──────────────────────────────────────────────


@router.patch(
    "/{pago_id}",
    response_model=PagoResponse,
    summary="Update a payment (partial)",
)
def update_pago(
    pago_id: Annotated[uuid.UUID, ...],
    body: PagoUpdate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> PagoResponse:
    """
    Partially update a payment owned by the authenticated user.

    Only fields explicitly set (non-None) are applied. PATCH cannot:
    - re-link the payment to a different supplier (D7 — would corrupt
      the FIFO pool's history);
    - set the `origen` field (immutable — MANUAL is automatic);
    - set the `negocio_id` (immutable — taken from the session).
    Returns 404 if the payment belongs to another user or is soft-deleted.
    Returns 422 if monto <= 0 or fecha is in the future (UTC-3).
    """
    svc = PagoService(session)
    pago = svc.actualizar(current_user.negocio_id, pago_id, body)
    session.commit()
    session.refresh(pago)
    # C-18 (FE-005): populate proveedor_nombre for the response.
    proveedor_nombre = _resolve_proveedor_nombre(session, pago.proveedor_id)
    return _to_response(pago, proveedor_nombre=proveedor_nombre)


# ── DELETE /{id} — soft-delete payment ───────────────────────────────────────


@router.delete(
    "/{pago_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a payment",
)
def delete_pago(
    pago_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> None:
    """
    Soft-delete a payment owned by the authenticated user.

    The row is preserved in the database (FK integrity). After this call,
    the next re-aggregation of the FIFO pool (C-08 / C-12) automatically
    excludes the soft-deleted payment. Returns 204 on success, 404 if the
    payment is missing, foreign, or already soft-deleted.
    """
    svc = PagoService(session)
    svc.eliminar(current_user.negocio_id, pago_id)
    session.commit()


__all__ = ["router", "PagoListResponse"]
