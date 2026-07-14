"""
Tests for the Cloudinary signing helper (C-05 task 3.1 — TDD RED).

The signing helper:
- Computes a signature from the CLOUDINARY_URL env secret.
- Constrains content-type (PDF/JPG/PNG) and max size (~10 MB).
- Returns only public params (signature, timestamp, api_key, cloud_name,
  folder, allowed_formats, max_file_size). The secret is NEVER returned
  or written to logs.

The `cloudinary` Python SDK is mocked to verify the helper uses the
correct signing API (D3).
"""

import os
from unittest.mock import patch

import pytest


class TestSigningHelper:
    """Spec: signing helper returns public params, never the secret."""

    def test_sign_avatar_preset_returns_public_params(self, monkeypatch):
        """Spec: helper returns signature + timestamp + api_key + constraints."""
        from app.core.cloudinary_signer import sign_avatar_preset

        # Simulate a known timestamp for determinism.
        fixed_ts = 1_700_000_000
        monkeypatch.setattr(
            "app.core.cloudinary_signer._now_timestamp", lambda: fixed_ts
        )

        # Mock cloudinary's signing function.
        with patch(
            "app.core.cloudinary_signer._call_cloudinary_sign"
        ) as mock_sign:
            mock_sign.return_value = "deadbeefsignature"

            result = sign_avatar_preset()

        # All public fields are present
        assert result["signature"] == "deadbeefsignature"
        assert result["timestamp"] == fixed_ts
        assert "api_key" in result
        assert "cloud_name" in result
        # Constraints
        assert set(result["allowed_formats"]) == {"pdf", "jpg", "png"}
        assert result["max_file_size"] <= 10_485_760  # ~10 MB
        assert result["folder"] == "avatars"

    def test_sign_avatar_preset_constraints_actually_used(self, monkeypatch):
        """Spec: the signed params passed to Cloudinary include the constraints
        (content-type, max size, folder). The signing helper must call
        the cloudinary SDK with these parameters so Cloudinary enforces them
        server-side even if the client is tampered with."""
        from app.core.cloudinary_signer import sign_avatar_preset

        with patch(
            "app.core.cloudinary_signer._call_cloudinary_sign"
        ) as mock_sign:
            mock_sign.return_value = "sig"

            result = sign_avatar_preset()

        # Inspect the kwargs the helper passed to the cloudinary SDK.
        assert mock_sign.called, "expected the helper to call the cloudinary signer"
        kwargs = mock_sign.call_args.kwargs
        signed_params = kwargs.get("params", {})
        # Constraints baked into the signed params
        assert signed_params.get("folder") == "avatars"
        assert set(signed_params.get("allowed_formats", [])) == {"pdf", "jpg", "png"}
        assert signed_params.get("max_file_size", 0) <= 10_485_760
        # The secret is passed in (to sign) but never returned
        assert kwargs.get("api_secret")  # present, used to sign
        assert "api_secret" not in result  # absent from response

    def test_sign_avatar_preset_never_returns_api_secret(self, monkeypatch):
        """Spec: the helper must NEVER include the api_secret in the response."""
        from app.core.cloudinary_signer import sign_avatar_preset

        with patch(
            "app.core.cloudinary_signer._call_cloudinary_sign"
        ) as mock_sign:
            mock_sign.return_value = "sig"
            result = sign_avatar_preset()

        for forbidden in ("api_secret", "secret", "cloudinary_secret"):
            assert forbidden not in result, (
                f"sign_avatar_preset must NOT return '{forbidden}'"
            )

    def test_sign_avatar_preset_does_not_log_secret(self, monkeypatch, caplog):
        """Spec: the api_secret must not appear in logs."""
        import logging

        from app.core.cloudinary_signer import sign_avatar_preset

        with patch(
            "app.core.cloudinary_signer._call_cloudinary_sign"
        ) as mock_sign:
            mock_sign.return_value = "sig"

            with caplog.at_level(logging.DEBUG):
                sign_avatar_preset()

        # No log line contains the secret substring
        for record in caplog.records:
            assert "super-secret-key" not in record.getMessage(), (
                f"Secret leaked in log: {record.getMessage()}"
            )
