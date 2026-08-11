"""
FastAPI dependency functions for auth and rate limiting.

Design decisions implemented here:
- D-C03-6: get_current_user — stateless JWT validation, one DB get for user hydration.
- D-C03-7: rate_limit — sliding window in-memory, 5 attempts / 60s per IP.
- C-16 (D-2): the SQLAlchemy engine is built lazily on first use, not at
  module-import time. This is a belt-and-suspenders measure layered on top
  of the read-through `settings` proxy (D-1) so that future import-time
  code paths cannot re-introduce the cached-`DATABASE_URL` bug.

Rules:
- get_current_user returns 401 on any auth failure (missing cookie,
  invalid token, expired token, user not found).
- Rate limit is per IP; X-Forwarded-For trusted only in production
  (behind the deploy-time Vercel→VPS rewrite).
- Authorization (404 on foreign resource) is NOT here — it lives
  in the business service layer (C-06+).
"""

import os
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from typing import Annotated, Generator

from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy import Engine
from sqlmodel import Session, create_engine

from app.core.config import settings
from app.core.security import decode_token
from app.models.usuario import Usuario
from app.repositories.usuario_repository import UsuarioRepository

# ── Database session dependency ───────────────────────────────────────────────

_engine: Engine | None = None


def _get_engine() -> Engine:
    """
    Return the SQLAlchemy engine, building it on first use (C-16 D-2).

    The engine is constructed lazily so importing `app.core.deps` does
    NOT call `create_engine(...)` (which would freeze the DSN at import
    time). After the first call the engine is cached for the process
    lifetime.
    """
    global _engine
    if _engine is None:
        _engine = create_engine(settings.DATABASE_URL)
    return _engine


def get_db() -> Generator[Session, None, None]:
    """
    Yield a SQLModel Session tied to the PostgreSQL database.

    The session is closed automatically after the request.
    Transaction commit is the router's responsibility.
    """
    with Session(_get_engine()) as session:
        yield session


# ── get_current_user ──────────────────────────────────────────────────────────

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="No autenticado",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    access_token: Annotated[str | None, Cookie()] = None,
    session: Session = Depends(get_db),
) -> Usuario:
    """
    Validate the access token cookie and return the authenticated Usuario.

    Steps:
        1. Read 'access_token' cookie.
        2. decode_token: validates JWT signature, expiry, and type="access" (D-C03-6).
        3. Extract 'sub' (= usuario_id).
        4. Fetch the Usuario by ID (one SELECT — acceptable per design).
        5. Reject deactivated users (D-32).

    This single SELECT is also why `negocio_id` is NOT a token claim (C-28, D1):
    the row is already here, so the scoping key costs nothing extra, and the
    session reflects the user's current state rather than the state at issue time.

    Returns:
        The authenticated Usuario instance, carrying the `negocio_id` used by
        the service layer for scoping (RN-NEG-01).

    Raises:
        HTTPException(401) if the cookie is missing, the token is invalid or
        expired, the user no longer exists, or the user is deactivated.
    """
    if access_token is None:
        raise _UNAUTHORIZED

    try:
        payload = decode_token(access_token)
    except HTTPException:
        raise _UNAUTHORIZED

    user_id_str: str | None = payload.get("sub")
    if not user_id_str:
        raise _UNAUTHORIZED

    import uuid
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise _UNAUTHORIZED

    repo = UsuarioRepository(session)
    usuario = repo.get_by_id(user_id)
    if usuario is None:
        raise _UNAUTHORIZED

    # D-32 / RN-NEG-07: access revocation is checked here, on the row, not on a
    # token claim. A deactivated member loses access on their very next request
    # instead of surviving until their access token expires.
    if usuario.desactivado:
        raise _UNAUTHORIZED

    return usuario


_FORBIDDEN_ADMIN = HTTPException(
    status_code=status.HTTP_403_FORBIDDEN,
    detail="Requiere privilegios de administrador del negocio.",
)


def require_admin(
    current_user: Annotated[Usuario, Depends(get_current_user)],
) -> Usuario:
    """
    Authenticated user who also administers their negocio (C-29, D1).

    Declared as a dependency rather than checked inside each handler so the
    privilege is visible in the endpoint signature: a new team endpoint that
    forgets it is obvious in review, whereas a missing `if` is not.

    Deactivated users never get here — get_current_user already rejected them.

    403 rather than 404 on purpose: unlike a foreign resource, there is nothing
    to hide. The caller is a legitimate member of this negocio and knows the
    endpoint exists; what they lack is the privilege, and saying so is the only
    way they can act on it (ask an admin).
    """
    if not current_user.es_admin:
        raise _FORBIDDEN_ADMIN
    return current_user


# ── Rate limiting ─────────────────────────────────────────────────────────────

_RATE_LIMIT_WINDOW_SECONDS = 60
_RATE_LIMIT_MAX_ATTEMPTS = 5

# In-memory store: IP → deque of attempt timestamps (UTC).
# This is intentionally simple (D-C03-7): single-instance MVP.
# Migration path: swap for Redis without touching routers.
_attempt_log: dict[str, deque] = defaultdict(deque)


def reset_rate_limit_store() -> None:
    """
    Clear the in-memory rate limit store.

    Intended for tests only — allows each test module to start clean
    so rate limit state from previous test classes does not leak.
    """
    _attempt_log.clear()


def _get_client_ip(request: Request) -> str:
    """
    Extract the client IP for rate limiting.

    In production behind the Vercel→VPS rewrite, X-Forwarded-For contains
    the real client IP (first entry). In local dev, request.client.host
    is used directly.

    NOTE: X-Forwarded-For is trusted ONLY because this service runs behind
    a controlled reverse proxy. Do not trust it in a public-facing context
    without the proxy rewrite.
    """
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def rate_limit(request: Request) -> None:
    """
    Sliding window rate limiter: 5 attempts / 60 seconds per IP.

    Called as a dependency on /api/auth/registro and /api/auth/login.
    Raises HTTPException(429) if the limit is exceeded.

    Thread safety: not thread-safe (asyncio single-thread model assumed).
    In uvicorn with workers > 1, each worker has its own counter.
    This is acceptable for the single-instance MVP (D-C03-7).
    """
    ip = _get_client_ip(request)
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=_RATE_LIMIT_WINDOW_SECONDS)

    attempts = _attempt_log[ip]

    # Evict timestamps outside the current window
    while attempts and attempts[0] < window_start:
        attempts.popleft()

    if len(attempts) >= _RATE_LIMIT_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Demasiados intentos. Intente nuevamente en 60 segundos.",
            headers={"Retry-After": "60"},
        )

    attempts.append(now)


__all__ = ["get_db", "get_current_user", "require_admin", "rate_limit"]
