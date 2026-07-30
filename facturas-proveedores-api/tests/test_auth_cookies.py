"""
Regression tests for the auth cookie attributes (app/routers/auth.py).

These lock the two decisions that make the browser actually KEEP the session
cookie. Both were root causes of real bugs where login returned 200 but the
session silently vanished on page reload:

1. `Domain` is OMITTED for localhost. Browsers reject a cookie with
   `Domain=localhost` (RFC 6265 §5.1.3: the domain attribute must be a
   proper suffix of the host, and `localhost` has no embedded dot). The
   backend used to send it, the browser dropped the Set-Cookie without any
   error, and the next request arrived anonymous.
2. `Secure` is derived from the REQUEST SCHEME, not from ENVIRONMENT. A
   Secure cookie over plain HTTP is discarded by the browser, which breaks
   both local dev (http://localhost) and the HTTP-only VPS deployment.

Layer choice: these are unit tests over `_set_auth_cookies` /
`_clear_auth_cookies`. Cookie attribute assembly is a pure function of
(request scheme, settings, tokens) — no DB and no HTTP round-trip needed to
pin it down.
"""

from http.cookies import SimpleCookie

import pytest
from fastapi import Response
from starlette.requests import Request

from app.routers.auth import _clear_auth_cookies, _set_auth_cookies


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_request(scheme: str) -> Request:
    """Minimal ASGI scope carrying only what the cookie logic reads."""
    return Request(
        {
            "type": "http",
            "http_version": "1.1",
            "method": "POST",
            "scheme": scheme,
            "server": ("testserver", 443 if scheme == "https" else 80),
            "path": "/api/auth/login",
            "raw_path": b"/api/auth/login",
            "query_string": b"",
            "root_path": "",
            "headers": [],
        }
    )


def _parse_set_cookies(response: Response) -> dict[str, SimpleCookie]:
    """Parse every Set-Cookie header, keyed by cookie name.

    Each Set-Cookie line is parsed on its own so that attributes never bleed
    between the access_token and refresh_token cookies.
    """
    parsed: dict[str, SimpleCookie] = {}
    for header_name, header_value in response.raw_headers:
        if header_name.decode().lower() != "set-cookie":
            continue
        jar = SimpleCookie()
        jar.load(header_value.decode())
        for name in jar:
            parsed[name] = jar
    return parsed


def _set_cookies_with(monkeypatch, *, cookie_domain: str, scheme: str) -> Response:
    """Run _set_auth_cookies under a given COOKIE_DOMAIN and request scheme.

    `settings` is a read-through proxy over the live environment (C-16, D-3),
    so setting the env var is enough — no cache to clear.
    """
    monkeypatch.setenv("COOKIE_DOMAIN", cookie_domain)
    response = Response()
    _set_auth_cookies(
        request=_make_request(scheme),
        response=response,
        access_token="fake.access.jwt",
        raw_refresh_token="fake-opaque-refresh",
    )
    return response


# ── Domain attribute: the localhost carve-out ────────────────────────────────

class TestCookieDomain:
    """Spec: Domain omitted for local hosts, emitted for a real domain."""

    @pytest.mark.parametrize("local_host", ["localhost", "LOCALHOST", "127.0.0.1", ""])
    def test_domain_is_omitted_for_local_hosts(self, monkeypatch, local_host):
        """A cookie with Domain=localhost is rejected by the browser.

        This is the regression guard: if someone drops the carve-out in
        `_set_auth_cookies`, the session silently stops surviving reloads
        in local dev.
        """
        response = _set_cookies_with(
            monkeypatch, cookie_domain=local_host, scheme="http"
        )

        cookies = _parse_set_cookies(response)
        assert set(cookies) == {"access_token", "refresh_token"}
        for name, jar in cookies.items():
            assert jar[name]["domain"] == "", (
                f"{name} must not carry a Domain attribute for host "
                f"{local_host!r}; browsers reject it (RFC 6265)"
            )

    def test_domain_is_emitted_for_a_real_domain(self, monkeypatch):
        """Triangulate: a real domain IS sent, so front and back can share it."""
        response = _set_cookies_with(
            monkeypatch, cookie_domain=".midominio.com", scheme="https"
        )

        cookies = _parse_set_cookies(response)
        assert cookies["access_token"]["access_token"]["domain"] == ".midominio.com"
        assert cookies["refresh_token"]["refresh_token"]["domain"] == ".midominio.com"


# ── Secure flag: derived from the request scheme ─────────────────────────────

class TestCookieSecureFlag:
    """Spec: Secure follows request.url.scheme, not ENVIRONMENT."""

    def test_secure_is_absent_over_http(self, monkeypatch):
        """A Secure cookie over http:// is discarded — local dev and the
        HTTP-only VPS both depend on this staying off."""
        response = _set_cookies_with(
            monkeypatch, cookie_domain="localhost", scheme="http"
        )

        cookies = _parse_set_cookies(response)
        assert cookies["access_token"]["access_token"]["secure"] == ""
        assert cookies["refresh_token"]["refresh_token"]["secure"] == ""

    def test_secure_is_present_over_https(self, monkeypatch):
        """Triangulate: behind TLS the flag must be on."""
        response = _set_cookies_with(
            monkeypatch, cookie_domain=".midominio.com", scheme="https"
        )

        cookies = _parse_set_cookies(response)
        assert cookies["access_token"]["access_token"]["secure"] is True
        assert cookies["refresh_token"]["refresh_token"]["secure"] is True


# ── Hardening attributes and cookie scoping (D-C03-3) ────────────────────────

class TestCookieHardeningAndPaths:
    """Spec: HttpOnly + SameSite=lax on both; refresh scoped to its endpoint."""

    def test_both_cookies_are_httponly_and_samesite_lax(self, monkeypatch):
        """HttpOnly keeps the tokens out of JS (no localStorage — regla dura)."""
        response = _set_cookies_with(
            monkeypatch, cookie_domain="localhost", scheme="http"
        )

        cookies = _parse_set_cookies(response)
        for name, jar in cookies.items():
            assert jar[name]["httponly"] is True, f"{name} must be HttpOnly"
            assert jar[name]["samesite"].lower() == "lax", f"{name} must be SameSite=Lax"

    def test_paths_scope_access_broadly_and_refresh_narrowly(self, monkeypatch):
        """D-C03-3: access_token on /, refresh_token only on its endpoint.

        The refresh path must also match what the frontend calls
        (axios baseURL '/api' + '/auth/refresh'), or the browser never
        attaches it and the silent refresh dies.
        """
        response = _set_cookies_with(
            monkeypatch, cookie_domain="localhost", scheme="http"
        )

        cookies = _parse_set_cookies(response)
        assert cookies["access_token"]["access_token"]["path"] == "/"
        assert cookies["refresh_token"]["refresh_token"]["path"] == "/api/auth/refresh"


# ── Logout must mirror the set attributes ────────────────────────────────────

class TestClearAuthCookies:
    """Spec: deletion only works when domain and path match the original."""

    def test_clear_omits_domain_for_localhost(self, monkeypatch):
        monkeypatch.setenv("COOKIE_DOMAIN", "localhost")
        response = Response()

        _clear_auth_cookies(response)

        cookies = _parse_set_cookies(response)
        assert set(cookies) == {"access_token", "refresh_token"}
        for name, jar in cookies.items():
            assert jar[name]["domain"] == ""

    def test_clear_matches_the_set_domain_and_paths(self, monkeypatch):
        """A delete with a mismatched domain/path leaves the cookie alive —
        the user would appear logged out and come back on reload."""
        monkeypatch.setenv("COOKIE_DOMAIN", ".midominio.com")
        response = Response()

        _clear_auth_cookies(response)

        cookies = _parse_set_cookies(response)
        assert cookies["access_token"]["access_token"]["domain"] == ".midominio.com"
        assert cookies["refresh_token"]["refresh_token"]["domain"] == ".midominio.com"
        assert cookies["access_token"]["access_token"]["path"] == "/"
        assert cookies["refresh_token"]["refresh_token"]["path"] == "/api/auth/refresh"
