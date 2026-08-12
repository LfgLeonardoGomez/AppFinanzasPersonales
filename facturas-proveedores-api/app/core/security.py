"""
Security utilities: password hashing (argon2id) and JWT handling.

Design decisions (D-C03-1, D-C03-4, D-C03-5):
- Passwords: argon2id via passlib. Never stored in plain text.
- Access token: JWT HS256, stateless, signed with SECRET_KEY.
  Claims: sub (usuario_id), exp, iat, type="access".
  Verified by decode_token WITHOUT querying the database.
- Refresh token: opaque (secrets.token_urlsafe), stored as SHA-256 hash.
  The raw value is returned once and never stored.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from jose import JWTError, ExpiredSignatureError, jwt
from passlib.context import CryptContext

from app.core.config import settings

# ── Password hashing ──────────────────────────────────────────────────────────

_pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

# Dummy hash used for constant-time comparison when email is not found (D-C03-5)
_DUMMY_HASH: str = _pwd_context.hash("dummy-constant-time-password")


def hash_password(plain: str) -> str:
    """
    Hash a plaintext password with argon2id.

    Returns an argon2id hash string suitable for storage.
    Each call produces a different hash (random salt).
    """
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """
    Verify a plaintext password against an argon2id hash.

    Returns True if the password matches, False otherwise.
    Never raises an exception for a wrong password.
    """
    try:
        return _pwd_context.verify(plain, hashed)
    except Exception:
        return False


def dummy_verify() -> None:
    """
    Perform a constant-time dummy password verification.

    Call this when the email is not found in the DB to prevent
    timing attacks that distinguish email-not-found from wrong-password.
    (D-C03-5)
    """
    _pwd_context.verify("arbitrary-input", _DUMMY_HASH)


# ── Access token (JWT) ────────────────────────────────────────────────────────

_ALGORITHM = "HS256"
_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Credenciales inválidas",
    headers={"WWW-Authenticate": "Bearer"},
)


def create_access_token(sub: str) -> str:
    """
    Create a signed JWT access token.

    Claims:
        sub  — the usuario_id (string)
        iat  — issued-at (UTC)
        exp  — expiry derived from ACCESS_TOKEN_TTL_MIN
        type — always "access"

    Returns the encoded JWT string.
    """
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.ACCESS_TOKEN_TTL_MIN)
    payload = {
        "sub": sub,
        "iat": now,
        "exp": expire,
        "type": "access",
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=_ALGORITHM)


def decode_token(token: str) -> dict:
    """
    Decode and validate a JWT access token.

    Validates:
        - Signature (SECRET_KEY)
        - Expiration
        - type claim must be "access"

    Does NOT query the database (stateless per D-C03-1).

    Returns the decoded payload dict.
    Raises HTTPException(401) on any validation failure.
    """
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[_ALGORITHM])
    except ExpiredSignatureError:
        raise _CREDENTIALS_EXCEPTION
    except JWTError:
        raise _CREDENTIALS_EXCEPTION

    if payload.get("type") != "access":
        raise _CREDENTIALS_EXCEPTION

    return payload


# ── Refresh token (opaque) ────────────────────────────────────────────────────

def create_refresh_token() -> tuple[str, str]:
    """
    Generate an opaque refresh token.

    Returns:
        (raw_token, token_hash)

        raw_token  — high-entropy URL-safe string; returned to the client once
                     via cookie and NEVER stored in the DB.
        token_hash — SHA-256 hex digest of raw_token; stored in refresh_token table.

    (D-C03-1: only the hash is persisted. A DB leak does not expose raw tokens.)
    """
    raw = secrets.token_urlsafe(40)  # 40 bytes → ~54 chars URL-safe
    return raw, hash_refresh_token(raw)


def hash_refresh_token(raw: str) -> str:
    """
    Compute the SHA-256 hex digest of a raw refresh token.

    Deterministic: same input always produces the same hash.
    Used for DB lookup on /refresh and /logout endpoints.
    """
    return hashlib.sha256(raw.encode()).hexdigest()


# ── Password reset token (C-31) ───────────────────────────────────────────────


def generar_token_reset() -> tuple[str, str]:
    """
    Generate a password-reset token.

    Returns (token, token_hash). Only the hash is persisted; the raw value
    travels once, in the email, and exists nowhere else.

    URL-safe and long, unlike the invitation code (C-29, D2): that one is
    dictated over the phone, so it trades entropy for readability. This one
    rides in a link nobody reads, so entropy wins.
    """
    raw = secrets.token_urlsafe(32)
    return raw, hash_token_reset(raw)


def hash_token_reset(raw: str) -> str:
    """SHA-256 hex digest of a reset token, for lookup."""
    return hashlib.sha256(raw.encode()).hexdigest()


# ── Invitation code (C-29) ────────────────────────────────────────────────────

# Uppercase alphanumerics minus the characters people confuse when reading a
# code aloud or off a screenshot: 0/O and 1/I/L. 32 symbols (D2).
_ALFABETO_INVITACION = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_LARGO_INVITACION = 8


def generar_codigo_invitacion() -> tuple[str, str]:
    """
    Generate a single-use invitation code.

    Returns:
        (codigo, codigo_hash)

        codigo      — 8 chars from an unambiguous alphabet, shown to the admin
                      exactly once and never persisted.
        codigo_hash — SHA-256 hex digest, the only thing stored.

    8 positions over 32 symbols is ~40 bits. That is deliberately not
    password-grade: the code is single-use, expires in hours, and sits behind
    rate limiting. What it has to survive is being dictated over the phone.

    Uses `secrets`, never `random`: the latter's output is predictable from
    previous draws, which for an access token is the whole ballgame.
    """
    codigo = "".join(
        secrets.choice(_ALFABETO_INVITACION) for _ in range(_LARGO_INVITACION)
    )
    return codigo, hash_codigo_invitacion(codigo)


def hash_codigo_invitacion(codigo: str) -> str:
    """
    SHA-256 hex digest of an invitation code, for lookup.

    Deterministic, so the raw code never has to be stored to be verified.
    """
    return hashlib.sha256(codigo.encode()).hexdigest()


__all__ = [
    "hash_password",
    "verify_password",
    "dummy_verify",
    "create_access_token",
    "decode_token",
    "create_refresh_token",
    "hash_refresh_token",
    "generar_codigo_invitacion",
    "hash_codigo_invitacion",
    "generar_token_reset",
    "hash_token_reset",
]
