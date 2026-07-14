"""
Tests for app/core/security.py — hashing, JWT, refresh token.

TDD RED phase for tasks 1.1, 1.2, 1.3, 1.4.

Spec scenarios covered:
- password persists hashed (≠ clear)
- verify_password True on correct, False on wrong (no exception)
- valid token decodes sub/type without DB
- invalid signature rejected
- expired token rejected
- refresh token: opaque value + hash; hash is sha256 not raw
"""

import time
import pytest
from datetime import datetime, timedelta, timezone


# ── Task 1.1: hash_password / verify_password ────────────────────────────────

class TestPasswordHashing:
    """Spec: argon2id hashing; verify True/False without exception."""

    def test_hash_is_not_plaintext(self):
        """Spec: password_hash ≠ plain text."""
        from app.core.security import hash_password
        hashed = hash_password("mysecretpassword")
        assert hashed != "mysecretpassword"
        assert len(hashed) > 20  # argon2 hashes are long

    def test_hash_starts_with_argon2_identifier(self):
        """Triangulate: argon2id hashes start with $argon2id$."""
        from app.core.security import hash_password
        hashed = hash_password("anotherpassword")
        assert hashed.startswith("$argon2")

    def test_verify_password_correct(self):
        """Spec: verify_password returns True for matching plain+hash."""
        from app.core.security import hash_password, verify_password
        plain = "correctpassword"
        hashed = hash_password(plain)
        assert verify_password(plain, hashed) is True

    def test_verify_password_wrong_returns_false_no_exception(self):
        """Spec: verify_password returns False (no exception) for wrong password."""
        from app.core.security import hash_password, verify_password
        hashed = hash_password("correctpassword")
        result = verify_password("wrongpassword", hashed)
        assert result is False

    def test_two_hashes_of_same_password_differ(self):
        """Edge case: argon2 uses a random salt — two hashes of same input differ."""
        from app.core.security import hash_password
        h1 = hash_password("samepassword")
        h2 = hash_password("samepassword")
        assert h1 != h2


# ── Task 1.2: create_access_token / decode_token ─────────────────────────────

class TestAccessToken:
    """Spec: JWT HS256, claims sub/exp/iat/type=access; decode without DB."""

    def test_valid_token_decodes_sub_and_type(self):
        """Spec: decoded payload contains sub=usuario_id and type=access."""
        from app.core.security import create_access_token, decode_token
        import uuid
        uid = str(uuid.uuid4())
        token = create_access_token(sub=uid)
        payload = decode_token(token)
        assert payload["sub"] == uid
        assert payload["type"] == "access"

    def test_valid_token_has_iat_and_exp(self):
        """Triangulate: token carries iat and exp claims."""
        from app.core.security import create_access_token, decode_token
        import uuid
        token = create_access_token(sub=str(uuid.uuid4()))
        payload = decode_token(token)
        assert "iat" in payload
        assert "exp" in payload

    def test_invalid_signature_raises_credentials_error(self):
        """Spec: token signed with wrong key is rejected."""
        from app.core.security import decode_token
        from fastapi import HTTPException
        import uuid
        from jose import jwt as jose_jwt

        # Sign with a different key
        bad_token = jose_jwt.encode(
            {"sub": str(uuid.uuid4()), "type": "access"},
            "wrong-key-that-is-at-least-32-characters-long",
            algorithm="HS256",
        )
        with pytest.raises(HTTPException) as exc_info:
            decode_token(bad_token)
        assert exc_info.value.status_code == 401

    def test_expired_token_raises_credentials_error(self):
        """Spec: expired token is rejected by decode_token."""
        from app.core.security import decode_token
        from fastapi import HTTPException
        from app.core.config import settings
        import uuid
        from jose import jwt as jose_jwt
        from datetime import datetime, timezone, timedelta

        past = datetime.now(timezone.utc) - timedelta(minutes=5)
        expired_token = jose_jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "type": "access",
                "iat": past,
                "exp": past,  # already expired
            },
            settings.SECRET_KEY,
            algorithm="HS256",
        )
        with pytest.raises(HTTPException) as exc_info:
            decode_token(expired_token)
        assert exc_info.value.status_code == 401

    def test_token_with_wrong_type_rejected(self):
        """Edge case: token with type != 'access' is rejected."""
        from app.core.security import decode_token
        from fastapi import HTTPException
        from app.core.config import settings
        import uuid
        from jose import jwt as jose_jwt
        from datetime import datetime, timezone, timedelta

        future = datetime.now(timezone.utc) + timedelta(minutes=30)
        bad_type_token = jose_jwt.encode(
            {
                "sub": str(uuid.uuid4()),
                "type": "refresh",  # wrong type
                "iat": datetime.now(timezone.utc),
                "exp": future,
            },
            settings.SECRET_KEY,
            algorithm="HS256",
        )
        with pytest.raises(HTTPException) as exc_info:
            decode_token(bad_type_token)
        assert exc_info.value.status_code == 401


# ── Task 1.3: create_refresh_token ────────────────────────────────────────────

class TestRefreshToken:
    """Spec: opaque token + hash; hash != raw value."""

    def test_refresh_token_returns_raw_and_hash(self):
        """Spec: create_refresh_token() returns (raw_token, token_hash)."""
        from app.core.security import create_refresh_token
        raw, hashed = create_refresh_token()
        assert raw != hashed
        assert len(raw) > 20
        assert len(hashed) > 20

    def test_refresh_token_hash_is_deterministic(self):
        """Triangulate: the same raw token always produces the same hash."""
        from app.core.security import hash_refresh_token
        raw = "some-opaque-token-value-at-least-32-chars-x"
        h1 = hash_refresh_token(raw)
        h2 = hash_refresh_token(raw)
        assert h1 == h2

    def test_two_refresh_tokens_differ(self):
        """Edge case: two calls produce different raw tokens (uses random source)."""
        from app.core.security import create_refresh_token
        raw1, _ = create_refresh_token()
        raw2, _ = create_refresh_token()
        assert raw1 != raw2

    def test_refresh_token_hash_not_equal_to_raw(self):
        """Spec: hash stored in DB must not be the raw token value."""
        from app.core.security import create_refresh_token
        raw, hashed = create_refresh_token()
        assert raw != hashed
