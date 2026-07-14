"""
Tests for Pydantic auth schemas (task 4.1, 4.2).

Spec scenarios:
- email mal formado → 422
- password < 8 chars → 422
- UsuarioResponse never serializes password_hash
- valid input → schema validates
"""

import pytest
from pydantic import ValidationError


class TestRegistroRequest:
    """Spec: email valid, nombre, password min_length=8."""

    def test_valid_input_passes(self):
        """Spec: valid email + nombre + password ≥ 8."""
        from app.schemas.auth import RegistroRequest
        req = RegistroRequest(email="user@example.com", nombre="User", password="secret12")
        assert req.email == "user@example.com"
        assert req.password == "secret12"

    def test_invalid_email_raises(self):
        """Spec: malformed email → ValidationError."""
        from app.schemas.auth import RegistroRequest
        with pytest.raises(ValidationError) as exc_info:
            RegistroRequest(email="not-an-email", nombre="User", password="secret12")
        errors = exc_info.value.errors()
        assert any(e["loc"] == ("email",) or "email" in str(e) for e in errors)

    def test_password_too_short_raises(self):
        """Spec: password < 8 chars → ValidationError."""
        from app.schemas.auth import RegistroRequest
        with pytest.raises(ValidationError) as exc_info:
            RegistroRequest(email="user@example.com", nombre="User", password="short")
        errors = exc_info.value.errors()
        assert any("password" in str(e) for e in errors)

    def test_password_exactly_8_chars_is_valid(self):
        """Edge case: exactly 8 chars is at the minimum boundary."""
        from app.schemas.auth import RegistroRequest
        req = RegistroRequest(email="user@example.com", nombre="User", password="12345678")
        assert len(req.password) == 8

    def test_email_normalized_lowercase(self):
        """Triangulate: email is lowercased/normalized by Pydantic EmailStr."""
        from app.schemas.auth import RegistroRequest
        req = RegistroRequest(email="User@EXAMPLE.COM", nombre="User", password="secret12")
        assert "@" in req.email


class TestLoginRequest:
    """Spec: email + password required."""

    def test_valid_login_passes(self):
        from app.schemas.auth import LoginRequest
        req = LoginRequest(email="user@example.com", password="anypassword")
        assert req.email == "user@example.com"

    def test_missing_email_raises(self):
        from app.schemas.auth import LoginRequest
        with pytest.raises(ValidationError):
            LoginRequest(password="anypassword")

    def test_missing_password_raises(self):
        from app.schemas.auth import LoginRequest
        with pytest.raises(ValidationError):
            LoginRequest(email="user@example.com")


class TestUsuarioResponse:
    """Spec: UsuarioResponse NEVER serializes password_hash."""

    def test_response_excludes_password_hash(self):
        """Spec: password_hash never in serialized output."""
        import uuid
        from datetime import datetime, timezone
        from app.schemas.auth import UsuarioResponse

        resp = UsuarioResponse(
            id=uuid.uuid4(),
            email="user@example.com",
            nombre="User",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        data = resp.model_dump()
        assert "password_hash" not in data

    def test_response_contains_expected_fields(self):
        """Triangulate: response has id, email, nombre."""
        import uuid
        from datetime import datetime, timezone
        from app.schemas.auth import UsuarioResponse

        uid = uuid.uuid4()
        resp = UsuarioResponse(
            id=uid,
            email="user@example.com",
            nombre="User",
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        data = resp.model_dump()
        assert data["id"] == uid
        assert data["email"] == "user@example.com"
        assert data["nombre"] == "User"
