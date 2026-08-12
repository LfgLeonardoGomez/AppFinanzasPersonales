"""
Auth router: registro, login, logout, refresh.

Design decisions:
- D-C03-3: Two cookies — access_token (short TTL, Path=/) and
  refresh_token (long TTL, Path=/api/auth/refresh).
- D-C03-4: Cookie secure flag controlled by environment (Secure in prod).
- D-C03-5: All service errors propagate as-is; routers add no logic.
- Regla dura: authorization and session logic live in the SERVICE LAYER.
"""

from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from sqlmodel import Session

from app.core.config import settings
from app.core.deps import get_db, rate_limit
from app.schemas.auth import (
    LoginRequest,
    RecuperarRequest,
    ResetRequest,
    RegistroEmpleadoRequest,
    RegistroRequest,
    UsuarioResponse,
)
from app.services.usuario_service import UsuarioService

router = APIRouter(prefix="/api/auth", tags=["auth"])

# ── Cookie configuration ──────────────────────────────────────────────────────

def _set_auth_cookies(
    request: Request,
    response: Response,
    access_token: str,
    raw_refresh_token: str,
) -> None:
    """Set both auth cookies on the response.

    secure is derived from the actual request scheme (HTTPS vs HTTP),
    not from ENVIRONMENT, so it works correctly behind reverse proxies
    and in mixed environments (e.g. Oracle Cloud Free Tier HTTP).

    domain is read from settings.COOKIE_DOMAIN so cookies are shared
    across the intended subdomains (front → back).
    """
    secure = request.url.scheme == "https"
    domain = settings.COOKIE_DOMAIN

    # For localhost development, omit domain entirely — browsers reject
    # cookies with domain=localhost per RFC 6265.
    cookie_kwargs: dict = {"httponly": True, "secure": secure, "samesite": "lax"}
    if domain and domain.lower() not in ("localhost", "127.0.0.1", ""):
        cookie_kwargs["domain"] = domain

    response.set_cookie(
        key="access_token",
        value=access_token,
        max_age=settings.ACCESS_TOKEN_TTL_MIN * 60,
        path="/",
        **cookie_kwargs,
    )
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh_token,
        max_age=settings.REFRESH_TOKEN_TTL_DAYS * 86400,
        path="/api/auth/refresh",  # scoped to minimize exposure (D-C03-3)
        **cookie_kwargs,
    )


def _clear_auth_cookies(response: Response) -> None:
    """Clear both auth cookies (logout)."""
    domain = settings.COOKIE_DOMAIN
    delete_kwargs: dict = {}
    if domain and domain.lower() not in ("localhost", "127.0.0.1", ""):
        delete_kwargs["domain"] = domain

    response.delete_cookie(key="access_token", path="/", **delete_kwargs)
    response.delete_cookie(key="refresh_token", path="/api/auth/refresh", **delete_kwargs)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post(
    "/registro",
    response_model=UsuarioResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
def registro(
    body: RegistroRequest,
    session: Session = Depends(get_db),
    _rate: None = Depends(rate_limit),
) -> UsuarioResponse:
    """
    Create a new user account.

    Validates email format and minimum password length (Pydantic).
    Returns 409 if the email is already registered.
    """
    svc = UsuarioService(session)
    usuario = svc.registrar(
        email=str(body.email),
        nombre=body.nombre,
        password=body.password,
        nombre_negocio=body.nombre_negocio,
    )
    session.commit()
    session.refresh(usuario)
    return UsuarioResponse.model_validate(usuario)


@router.post(
    "/registro-empleado",
    response_model=UsuarioResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Join an existing negocio with an invitation code",
)
def registro_empleado(
    body: RegistroEmpleadoRequest,
    session: Session = Depends(get_db),
    _rate: None = Depends(rate_limit),
) -> UsuarioResponse:
    """
    Create an account inside an EXISTING negocio, using an invitation code.

    Separate from `/registro` on purpose (D-30): that one creates a shop, this
    one joins one. Routing both through a single endpoint would mean an
    employee who mistypes the code silently gets their own empty business.

    The employee sets their own password here, which is why the admin never has
    to hand out credentials — relevant while password recovery does not exist.

    An unknown, expired or already-used code all return the same error: this is
    a public endpoint, and distinguishing them would let anyone probe which
    shops exist (D3).
    """
    svc = UsuarioService(session)
    usuario = svc.registrar_empleado(
        email=str(body.email),
        nombre=body.nombre,
        password=body.password,
        codigo=body.codigo,
    )
    session.commit()
    session.refresh(usuario)
    return UsuarioResponse.model_validate(usuario)


@router.post(
    "/recuperar",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Request a password recovery link",
)
def recuperar(
    body: RecuperarRequest,
    session: Session = Depends(get_db),
    _rate: None = Depends(rate_limit),
) -> dict:
    """
    Send a recovery link, if the email belongs to an account.

    The response is deliberately the same either way — same status, same body,
    and comparable timing. Anything else turns this into a way to find out who
    has an account here (D2).

    202 rather than 200 because that is literally what happened: the request was
    accepted, and whether anything was sent is not something the caller gets
    to learn.
    """
    svc = UsuarioService(session)
    svc.solicitar_reset(str(body.email))
    session.commit()
    return {
        "mensaje": "Si el email corresponde a una cuenta, te enviamos un enlace."
    }


@router.post(
    "/reset",
    status_code=status.HTTP_200_OK,
    summary="Set a new password using a recovery token",
)
def reset(
    body: ResetRequest,
    session: Session = Depends(get_db),
    _rate: None = Depends(rate_limit),
) -> dict:
    """
    Apply a new password.

    Consumes the token, kills every open session of that user and every other
    pending reset token, and does NOT log anyone in — the user goes through the
    normal login (D3, D7).
    """
    svc = UsuarioService(session)
    svc.aplicar_reset(body.token, body.password)
    session.commit()
    return {"mensaje": "Tu contraseña quedó actualizada. Ya podés ingresar."}


@router.post(
    "/login",
    response_model=UsuarioResponse,
    summary="Login and issue session cookies",
)
def login(
    body: LoginRequest,
    response: Response,
    request: Request,
    session: Session = Depends(get_db),
    _rate: None = Depends(rate_limit),
) -> UsuarioResponse:
    """
    Verify credentials and issue access + refresh token cookies.

    On success: sets httpOnly Secure SameSite=Lax cookies.
    On failure: 401 with a generic error message (never reveals which field failed).
    """
    svc = UsuarioService(session)
    access_token, raw_refresh, usuario = svc.login(
        email=str(body.email),
        password=body.password,
    )
    session.commit()

    _set_auth_cookies(request, response, access_token, raw_refresh)
    return UsuarioResponse.model_validate(usuario)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Logout and revoke refresh token",
)
def logout(
    response: Response,
    refresh_token: Annotated[str | None, Cookie()] = None,
    session: Session = Depends(get_db),
) -> None:
    """
    Revoke the current refresh token and clear session cookies.

    If the refresh token cookie is missing, cookies are still cleared
    (idempotent logout behavior).
    """
    if refresh_token:
        svc = UsuarioService(session)
        svc.logout(refresh_token)
        session.commit()

    _clear_auth_cookies(response)


@router.post(
    "/refresh",
    response_model=UsuarioResponse,
    summary="Rotate refresh token and issue new pair",
)
def refresh(
    response: Response,
    request: Request,
    refresh_token: Annotated[str | None, Cookie()] = None,
    session: Session = Depends(get_db),
) -> UsuarioResponse:
    """
    Use the refresh token cookie to issue a new access + refresh pair.

    The old refresh token is revoked (rotation). Returns 401 if the
    token is missing, revoked, or expired.
    """
    if refresh_token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No autenticado",
        )

    svc = UsuarioService(session)
    new_access, new_refresh, usuario = svc.refresh(refresh_token)
    session.commit()

    _set_auth_cookies(request, response, new_access, new_refresh)
    return UsuarioResponse.model_validate(usuario)


__all__ = ["router"]
