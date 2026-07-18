"""
Per-user IA rate limiter (C-14, D-IA-2; made configurable in C-21, D6).

Sliding window in-memory: `settings.IA_RATE_MAX_REQUESTS` requests /
`settings.IA_RATE_WINDOW_SECONDS` seconds per `usuario_id`. Default
60 requests / 3600 seconds (comfortable for a single-user MVP).

Key differences from the auth rate limiter in `app/core/deps.py:rate_limit`:
- Keyed by `usuario_id` (UUID), NOT by IP. A user behind NAT does not share
  budget with other users; a user with a dynamic IP does not lose their quota.
- Lower volume than auth (5/60s) because each request spends external API
  budget (Anthropic / OpenAI).
- `Retry-After` is computed from the OLDEST in-window attempt, so the
  client knows exactly when one slot frees up.

C-21 (D6): the limit/window are read from `settings.IA_RATE_MAX_REQUESTS` /
`settings.IA_RATE_WINDOW_SECONDS` AT EVALUATION TIME (call time), via the
C-16 read-through `settings` proxy — NOT captured as module constants at
import time. This lets env changes take effect without a code change or
`cache_clear()`. Do NOT reintroduce module-level hardcoded constants.

The store is intentionally a module-level dict, cleared between tests via
`reset_ia_rate_limit_store()`. Single-instance MVP (D-C03-7); migration to
Redis is a follow-up.
"""

import asyncio
import uuid
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status

from app.core.config import settings
from app.core.deps import get_current_user
from app.models.usuario import Usuario

# In-memory store: usuario_id → deque of attempt timestamps (UTC).
# Single-instance MVP. Migration to Redis is a follow-up (Q-IA-3 in design.md).
_ia_attempts: dict[uuid.UUID, deque] = defaultdict(deque)
_ia_lock = asyncio.Lock()


def reset_ia_rate_limit_store() -> None:
    """
    Clear the in-memory rate limit store.

    Intended for tests only — allows each test module to start clean so
    rate limit state from previous test classes does not leak.
    """
    _ia_attempts.clear()


async def rate_limit_ia(
    current_user: Usuario = Depends(get_current_user),
) -> None:
    """
    Sliding window rate limiter: `settings.IA_RATE_MAX_REQUESTS` attempts /
    `settings.IA_RATE_WINDOW_SECONDS` seconds per `usuario_id`.

    Called as a dependency on `POST /api/facturas/extraer-ia` and
    `POST /api/pagos/extraer-ia`. Runs AFTER `get_current_user`, so a
    401 short-circuits before the rate limit is consumed (the spec scenario
    "unauthenticated request does not consume budget").

    Raises HTTPException(429) with a `Retry-After` header computed from
    the oldest in-window attempt.

    Concurrency: protected by `asyncio.Lock`. Since asyncio is cooperative
    and FastAPI runs handlers on a single event loop per worker, the lock
    is sufficient in single-process. In uvicorn with `workers > 1`, each
    worker has its own counter — this is acceptable for the MVP.
    """
    max_requests = settings.IA_RATE_MAX_REQUESTS
    window_seconds = settings.IA_RATE_WINDOW_SECONDS

    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=window_seconds)

    async with _ia_lock:
        attempts = _ia_attempts[current_user.id]

        # Evict timestamps outside the current window
        while attempts and attempts[0] < window_start:
            attempts.popleft()

        if len(attempts) >= max_requests:
            # Compute Retry-After from the oldest in-window attempt:
            # the slot frees when (oldest + window) elapses.
            oldest = attempts[0]
            retry_after_seconds = int(
                (oldest + timedelta(seconds=window_seconds) - now).total_seconds()
            )
            # Clamp: never negative, never zero
            retry_after_seconds = max(retry_after_seconds, 1)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Demasiadas solicitudes a la IA. Intente nuevamente en "
                    f"{retry_after_seconds} segundos."
                ),
                headers={"Retry-After": str(retry_after_seconds)},
            )

        attempts.append(now)


def __getattr__(name: str) -> int:
    """
    PEP 562 module-level attribute access — keeps the C-14 module constant
    names (`_IA_RATE_MAX_REQUESTS`, `_IA_RATE_WINDOW_SECONDS`) importable
    for existing test helpers, but sourced live from `settings` (C-21, D6)
    instead of frozen at import time.
    """
    if name == "_IA_RATE_MAX_REQUESTS":
        return settings.IA_RATE_MAX_REQUESTS
    if name == "_IA_RATE_WINDOW_SECONDS":
        return settings.IA_RATE_WINDOW_SECONDS
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "rate_limit_ia",
    "reset_ia_rate_limit_store",
    "_IA_RATE_MAX_REQUESTS",
    "_IA_RATE_WINDOW_SECONDS",
    "_ia_attempts",
    "_ia_lock",
]
