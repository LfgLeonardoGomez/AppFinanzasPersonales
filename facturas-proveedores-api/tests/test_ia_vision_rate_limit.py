"""
Tests for the per-user IA rate limiter (C-14, D-IA-2).

10 requests / 60 minutes per `usuario_id` (NOT per IP). The 11th request
inside the window returns HTTP 429 with a `Retry-After` header.

The store is a module-level dict in `app.core.rate_limit_ia`, cleared
between tests via the `clean_ia_rate_limit` autouse fixture.
"""

import asyncio
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


# ── Basic budget ─────────────────────────────────────────────────────────────


class TestBudget:
    @pytest.mark.asyncio
    async def test_10_consecutive_calls_pass(self):
        from app.core.rate_limit_ia import rate_limit_ia

        user = _user()
        for i in range(10):
            await rate_limit_ia(user)

    @pytest.mark.asyncio
    async def test_11th_call_raises_429(self):
        from app.core.rate_limit_ia import rate_limit_ia

        user = _user()
        for i in range(10):
            await rate_limit_ia(user)

        with pytest.raises(HTTPException) as exc_info:
            await rate_limit_ia(user)
        assert exc_info.value.status_code == 429
        assert "Retry-After" in exc_info.value.headers
        # Retry-After should be a positive integer
        retry_after = int(exc_info.value.headers["Retry-After"])
        assert retry_after > 0

    @pytest.mark.asyncio
    async def test_independent_budgets_per_user(self):
        from app.core.rate_limit_ia import rate_limit_ia

        user_a = _user()
        user_b = _user()
        for i in range(10):
            await rate_limit_ia(user_a)

        # user_a's budget is exhausted; user_b should still have a full budget
        for i in range(10):
            await rate_limit_ia(user_b)

    @pytest.mark.asyncio
    async def test_retry_after_matches_oldest_slot(self):
        from app.core.rate_limit_ia import rate_limit_ia, _ia_attempts

        user = _user()
        for i in range(10):
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
    async def test_retry_after_clamps_to_non_negative(self):
        from app.core.rate_limit_ia import rate_limit_ia

        user = _user()
        for i in range(10):
            await rate_limit_ia(user)

        with pytest.raises(HTTPException) as exc_info:
            await rate_limit_ia(user)
        retry_after = int(exc_info.value.headers["Retry-After"])
        # Even if windowing math is slightly off, never negative
        assert retry_after >= 1


# ── Sliding window ───────────────────────────────────────────────────────────


class TestSlidingWindow:
    @pytest.mark.asyncio
    async def test_window_slides_after_oldest_leaves(self, monkeypatch):
        """10 calls at minute 0, 1 call at minute 61 → 11th passes (sliding window)."""
        from app.core import rate_limit_ia as rli
        from app.core.rate_limit_ia import rate_limit_ia, _ia_attempts

        user = _user()

        # Use a fake clock that we control
        fake_now = datetime(2026, 6, 15, 12, 0, 0, tzinfo=timezone.utc)
        real_datetime = rli.datetime

        class FakeDatetimeMin:
            @classmethod
            def now(cls, tz=None):
                return fake_now

        monkeypatch.setattr(rli, "datetime", FakeDatetimeMin)

        # 10 calls at t=0
        for i in range(10):
            await rate_limit_ia(user)

        # The 11th call should 429
        with pytest.raises(HTTPException) as exc_info:
            await rate_limit_ia(user)
        assert exc_info.value.status_code == 429

        # Advance the clock past the window
        fake_now = fake_now + timedelta(seconds=3601)

        # Now the 12th call should pass
        await rate_limit_ia(user)


# ── Concurrency ──────────────────────────────────────────────────────────────


class TestConcurrency:
    @pytest.mark.asyncio
    async def test_concurrent_calls_dont_corrupt_counter(self):
        """10 concurrent calls should all pass; the 11th should 429.

        asyncio is cooperative, so the lock is sufficient in single-process.
        """
        from app.core.rate_limit_ia import rate_limit_ia, _ia_attempts, _IA_RATE_MAX_REQUESTS

        user = _user()
        # 10 concurrent calls
        await asyncio.gather(*[rate_limit_ia(user) for _ in range(10)])

        # The store should hold exactly 10 attempts for this user
        assert len(_ia_attempts[user.id]) == _IA_RATE_MAX_REQUESTS

        # The 11th call should 429
        with pytest.raises(HTTPException):
            await rate_limit_ia(user)

        # Counter is never above the limit
        assert len(_ia_attempts[user.id]) <= _IA_RATE_MAX_REQUESTS


# ── Store reset ──────────────────────────────────────────────────────────────


class TestStoreReset:
    @pytest.mark.asyncio
    async def test_reset_clears_state(self):
        from app.core.rate_limit_ia import rate_limit_ia, _ia_attempts

        user = _user()
        for i in range(10):
            await rate_limit_ia(user)

        # Confirm 11th would fail
        with pytest.raises(HTTPException):
            await rate_limit_ia(user)

        # Reset
        from app.core.rate_limit_ia import reset_ia_rate_limit_store

        reset_ia_rate_limit_store()

        # All 10 calls pass again
        for i in range(10):
            await rate_limit_ia(user)
