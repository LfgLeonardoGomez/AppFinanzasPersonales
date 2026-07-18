"""
Tests for the per-user IA rate limiter (C-14, D-IA-2; made configurable in C-21).

The limit is driven by `settings.IA_RATE_MAX_REQUESTS` /
`settings.IA_RATE_WINDOW_SECONDS` (C-21, D6) instead of hardcoded module
constants. Default: 60 requests / 3600 seconds per `usuario_id` (NOT per IP).
The (max+1)th request inside the window returns HTTP 429 with a
`Retry-After` header.

The store is a module-level dict in `app.core.rate_limit_ia`, cleared
between tests via the `clean_ia_rate_limit` autouse fixture. Each test
that needs a non-default limit drives it via `monkeypatch.setenv` — the
C-16 read-through settings proxy makes the change visible immediately,
no `cache_clear()` needed.
"""

import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException


@pytest.fixture(autouse=True)
def clean_ia_rate_limit():
    """Reset the in-memory store before and after each test."""
    from app.core import rate_limit_ia

    rate_limit_ia.reset_ia_rate_limit_store()
    yield
    rate_limit_ia.reset_ia_rate_limit_store()


@pytest.fixture(autouse=True)
def clean_ia_rate_limit_env():
    """
    Ensure each test starts from the Settings defaults (60/3600) unless it
    explicitly overrides via `monkeypatch.setenv`. Prevents a leaked env
    var from one test polluting the next (C-21).
    """
    original_max = os.environ.pop("IA_RATE_MAX_REQUESTS", None)
    original_window = os.environ.pop("IA_RATE_WINDOW_SECONDS", None)
    yield
    if original_max is not None:
        os.environ["IA_RATE_MAX_REQUESTS"] = original_max
    else:
        os.environ.pop("IA_RATE_MAX_REQUESTS", None)
    if original_window is not None:
        os.environ["IA_RATE_WINDOW_SECONDS"] = original_window
    else:
        os.environ.pop("IA_RATE_WINDOW_SECONDS", None)


def _user():
    """Create a fresh Usuario with a real id, populated enough to satisfy
    the rate_limit_ia dependency (which only reads `current_user.id`)."""
    from app.models.usuario import Usuario

    return Usuario(
        id=uuid.uuid4(),
        email=f"u_{uuid.uuid4().hex[:8]}@test.com",
        nombre="Test",
        password_hash="$argon2id$fake",
    )


# ── Basic budget — defaults (env unset) ────────────────────────────────────────


class TestDefaultBudget:
    @pytest.mark.asyncio
    async def test_60_consecutive_calls_pass_with_default_env(self, env_vars):
        """WHEN env vars are unset THEN the default of 60/3600s applies."""
        from app.core.rate_limit_ia import rate_limit_ia

        user = _user()
        for _ in range(60):
            await rate_limit_ia(user)

    @pytest.mark.asyncio
    async def test_61st_call_raises_429_with_default_env(self, env_vars):
        from app.core.rate_limit_ia import rate_limit_ia

        user = _user()
        for _ in range(60):
            await rate_limit_ia(user)

        with pytest.raises(HTTPException) as exc_info:
            await rate_limit_ia(user)
        assert exc_info.value.status_code == 429
        assert "Retry-After" in exc_info.value.headers
        retry_after = int(exc_info.value.headers["Retry-After"])
        assert retry_after > 0


# ── Limit driven by env, not a hardcoded constant ──────────────────────────────


class TestBudget:
    @pytest.mark.asyncio
    async def test_limit_driven_by_env_not_hardcoded(self, monkeypatch, env_vars):
        """C-21: setting IA_RATE_MAX_REQUESTS=2 makes the 3rd request 429."""
        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "2")
        from app.core.rate_limit_ia import rate_limit_ia

        user = _user()
        await rate_limit_ia(user)
        await rate_limit_ia(user)

        with pytest.raises(HTTPException) as exc_info:
            await rate_limit_ia(user)
        assert exc_info.value.status_code == 429
        assert "Retry-After" in exc_info.value.headers
        assert int(exc_info.value.headers["Retry-After"]) > 0

    @pytest.mark.asyncio
    async def test_limit_driven_by_env_second_value_triangulate(
        self, monkeypatch, env_vars
    ):
        """TRIANGULATE: a different env value (5) also drives the cutoff."""
        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "5")
        from app.core.rate_limit_ia import rate_limit_ia

        user = _user()
        for _ in range(5):
            await rate_limit_ia(user)

        with pytest.raises(HTTPException) as exc_info:
            await rate_limit_ia(user)
        assert exc_info.value.status_code == 429

    @pytest.mark.asyncio
    async def test_independent_budgets_per_user(self, monkeypatch, env_vars):
        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "3")
        from app.core.rate_limit_ia import rate_limit_ia

        user_a = _user()
        user_b = _user()
        for _ in range(3):
            await rate_limit_ia(user_a)

        # user_a's budget is exhausted; user_b should still have a full budget
        for _ in range(3):
            await rate_limit_ia(user_b)

    @pytest.mark.asyncio
    async def test_retry_after_matches_oldest_slot(self, monkeypatch, env_vars):
        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "2")
        monkeypatch.setenv("IA_RATE_WINDOW_SECONDS", "3600")
        from app.core.rate_limit_ia import _ia_attempts, rate_limit_ia

        user = _user()
        for _ in range(2):
            await rate_limit_ia(user)

        # Simulate that the oldest attempt was 3700 seconds ago (well outside
        # the 3600s window). It should be evicted on the next call, so the
        # next call passes (not 429).
        q = _ia_attempts[user.id]
        old = q.popleft()
        q.appendleft(old - timedelta(seconds=3700))

        # Now call again — should pass because the oldest is outside the window
        await rate_limit_ia(user)

    @pytest.mark.asyncio
    async def test_retry_after_clamps_to_non_negative(self, monkeypatch, env_vars):
        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "2")
        from app.core.rate_limit_ia import rate_limit_ia

        user = _user()
        for _ in range(2):
            await rate_limit_ia(user)

        with pytest.raises(HTTPException) as exc_info:
            await rate_limit_ia(user)
        retry_after = int(exc_info.value.headers["Retry-After"])
        # Even if windowing math is slightly off, never negative
        assert retry_after >= 1


# ── Sliding window ───────────────────────────────────────────────────────────


class TestSlidingWindow:
    @pytest.mark.asyncio
    async def test_window_slides_after_oldest_leaves(self, monkeypatch, env_vars):
        """2 calls at minute 0, 1 call after the window elapsed → 3rd passes (sliding window)."""
        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "2")
        monkeypatch.setenv("IA_RATE_WINDOW_SECONDS", "3600")
        from app.core import rate_limit_ia as rli
        from app.core.rate_limit_ia import rate_limit_ia

        user = _user()

        # Use a fake clock that we control
        fake_now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)

        class FakeDatetimeMin:
            @classmethod
            def now(cls, tz=None):
                return fake_now

        monkeypatch.setattr(rli, "datetime", FakeDatetimeMin)

        # 2 calls at t=0
        for _ in range(2):
            await rate_limit_ia(user)

        # The 3rd call should 429
        with pytest.raises(HTTPException) as exc_info:
            await rate_limit_ia(user)
        assert exc_info.value.status_code == 429

        # Advance the clock past the window
        fake_now = fake_now + timedelta(seconds=3601)

        # Now the next call should pass
        await rate_limit_ia(user)


# ── Concurrency ──────────────────────────────────────────────────────────────


class TestConcurrency:
    @pytest.mark.asyncio
    async def test_concurrent_calls_dont_corrupt_counter(self, monkeypatch, env_vars):
        """10 concurrent calls should all pass; the 11th should 429.

        asyncio is cooperative, so the lock is sufficient in single-process.
        """
        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "10")
        from app.core.config import settings
        from app.core.rate_limit_ia import _ia_attempts, rate_limit_ia

        user = _user()
        # 10 concurrent calls
        await asyncio.gather(*[rate_limit_ia(user) for _ in range(10)])

        # The store should hold exactly settings.IA_RATE_MAX_REQUESTS attempts
        assert len(_ia_attempts[user.id]) == settings.IA_RATE_MAX_REQUESTS

        # The 11th call should 429
        with pytest.raises(HTTPException):
            await rate_limit_ia(user)

        # Counter is never above the limit
        assert len(_ia_attempts[user.id]) <= settings.IA_RATE_MAX_REQUESTS


# ── Store reset ──────────────────────────────────────────────────────────────


class TestStoreReset:
    @pytest.mark.asyncio
    async def test_reset_clears_state(self, monkeypatch, env_vars):
        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "3")
        from app.core.rate_limit_ia import rate_limit_ia, reset_ia_rate_limit_store

        user = _user()
        for _ in range(3):
            await rate_limit_ia(user)

        # Confirm the next call would fail
        with pytest.raises(HTTPException):
            await rate_limit_ia(user)

        # Reset
        reset_ia_rate_limit_store()

        # All 3 calls pass again
        for _ in range(3):
            await rate_limit_ia(user)
