"""
Integration tests for /extraer-ia endpoints (C-14, tasks 9-10).

The two endpoints — `POST /api/facturas/extraer-ia` and
`POST /api/pagos/extraer-ia` — share the same contract:
- multipart upload with a single `file` part
- image-only (magic bytes validated, not Content-Type header)
- auth required (get_current_user)
- per-user rate limit (10/3600s, shared budget)
- no DB writes (RN-IA-04)
- graceful failure: SDK errors → 200 with `error=true`, fields=None
- route ordering: `/extraer-ia` declared BEFORE `/{id}` so the
  path param does not capture "extraer-ia" as a UUID

The vision SDKs are mocked at the router level — the factory
`get_vision_extractor` is monkey-patched to return a stub
VisionExtractor.
"""

import json
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel


# ── Fixtures ──────────────────────────────────────────────────────────────────


VALID_PNG = b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a" + b"\x00" * 50
VALID_JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00" + b"\x00" * 50
VALID_WEBP = b"RIFF\x10\x00\x00\x00WEBPVP8 " + b"\x00" * 50
PDF_BYTES = b"%PDF-1.4" + b"\x00" * 50
GIF_BYTES = b"GIF89a" + b"\x00" * 50
HEIC_BYTES = b"\x00\x00\x00\x20ftypheic" + b"\x00" * 50


@pytest.fixture(scope="module")
def engine(db_url: str):
    # Import lazy: si se importa a nivel de módulo, el engine global de
    # `app.core.deps` se crea con el DSN del `.env` de desarrollo (localhost:5432)
    # antes de que `env_vars` setee el DSN del testcontainer. Resultado:
    # tests posteriores que necesitan DB fallan con UnicodeDecodeError en psycopg2.
    import app.models  # noqa: F401 — registrar modelos en SQLModel.metadata
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def ia_client(engine, env_vars):
    """TestClient with the Anthropic SDK constructor mocked.

    Rather than patching the `get_vision_extractor` factory (which can
    confuse FastAPI's dependency introspection in some setups), we mock
    the SDK constructor so the real factory still returns a real
    `ClaudeVisionExtractor` whose `messages.create` is a MagicMock.
    """
    from unittest.mock import MagicMock, patch

    from app.core.rate_limit_ia import reset_ia_rate_limit_store
    from app.schemas.factura import PropuestaFactura
    from app.schemas.pago import PropuestaPago

    # C-16 (D-3): `get_settings` is no longer cached; the
    # `get_settings.cache_clear()` call was removed.
    reset_ia_rate_limit_store()

    from app.main import app
    from app.services.ia_extraccion_service import (
        ClaudeVisionExtractor,
        OpenAIVisionExtractor,
        get_vision_extractor,
    )

    # Clear the factory's lru_cache so the next call creates a new
    # extractor using the patched __init__ from THIS fixture.
    get_vision_extractor.cache_clear()

    # NOTE: we do NOT override get_db here. The real get_db uses the engine
    # created from settings.DATABASE_URL, which the env_vars fixture sets
    # to the test database. This avoids a FastAPI dependency-introspection
    # edge case where Annotated[Usuario, Depends(...)] gets mis-classified
    # as a query param when a parent dependency is overridden.

    default_factura = PropuestaFactura(
        proveedor_nombre="Acme",
        numero="0001-001",
        fecha_emision=date(2026, 6, 15),
        monto_total=Decimal("1234.56"),
    )
    default_pago = PropuestaPago(
        proveedor_nombre="Acme",
        monto=Decimal("500.00"),
        fecha=date(2026, 6, 20),
    )

    class _FakeTextBlock:
        def __init__(self, text):
            self.text = text

    def make_anthropic_message(text):
        return SimpleNamespace(content=[_FakeTextBlock(text)])

    def make_openai_message(text):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=text))]
        )

    class _SDKState:
        def __init__(self):
            self.anthropic_client = MagicMock()
            self.openai_client = MagicMock()
            self.anthropic_response_fn = lambda: make_anthropic_message(
                json.dumps(
                    {
                        "proveedor_nombre": "Acme",
                        "numero": "0001-001",
                        "fecha_emision": "2026-06-15",
                        "monto_total": 1234.56,
                        # pago fields (in case the test uses Claude SDK for pago)
                        "monto": "500.00",
                        "fecha": "2026-06-20",
                    }
                )
            )
            self.openai_response_fn = lambda: make_openai_message(
                json.dumps(
                    {
                        "proveedor_nombre": "Acme",
                        "monto": "500.00",
                        "fecha": "2026-06-20",
                    }
                )
            )

        def install(self):
            self.anthropic_client.messages.create.side_effect = (
                lambda **kw: self.anthropic_response_fn()
            )
            self.openai_client.chat.completions.create.side_effect = (
                lambda **kw: self.openai_response_fn()
            )

    state = _SDKState()
    state.install()

    from app.services import ia_extraccion_service as svc
    from unittest.mock import patch

    # Patch the SDK constructor in the ia_extraccion_service module
    # so the real extractors use our mocks.
    def patched_claude_init(self, api_key, model=None):
        self._client = state.anthropic_client
        self._model = model or ClaudeVisionExtractor.DEFAULT_MODEL

    def patched_openai_init(self, api_key, model=None):
        self._client = state.openai_client
        self._model = model or OpenAIVisionExtractor.DEFAULT_MODEL

    from app.routers.facturas import get_db
    from sqlmodel import Session

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    try:
        with patch.object(ClaudeVisionExtractor, "__init__", patched_claude_init), patch.object(
            OpenAIVisionExtractor, "__init__", patched_openai_init
        ):
            client = TestClient(app)
            yield client, state
    finally:
        app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_sdk_state(request):
    """Reset SDK mock state before each test so side_effects don't leak."""
    if "ia_client" in request.fixturenames:
        _, state = request.getfixturevalue("ia_client")
        state.install()  # re-install default responses
        from app.core.rate_limit_ia import reset_ia_rate_limit_store
        reset_ia_rate_limit_store()


def _client(fixture):
    return fixture[0]


def _state(fixture):
    return fixture[1]


def _register_login(ia_client):
    """Register + login. Returns headers dict."""
    email = f"ia_{uuid.uuid4().hex[:8]}@test.com"
    password = "testpass123"
    ip = f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.3"

    ia_client.post(
        "/api/auth/registro",
        json={"email": email, "password": password, "nombre": "Test"},
        headers={"X-Forwarded-For": ip},
    )
    login = ia_client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": ip},
    )
    assert login.status_code == 200
    token = login.cookies.get("access_token")
    return {"Cookie": f"access_token={token}"}


# ── /api/facturas/extraer-ia — happy paths ────────────────────────────────────


class TestFacturaHappyPath:
    def test_jpeg_returns_200_with_proposal(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("f.jpg", VALID_JPEG, "image/jpeg")},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["error"] is False
        assert data["error_message"] is None
        assert data["proveedor_nombre"] == "Acme"
        assert data["monto_total"] == "1234.56"
        assert data["fecha_emision"] == "2026-06-15"

    def test_png_returns_200(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("f.png", VALID_PNG, "image/png")},
            headers=headers,
        )
        if resp.status_code != 200:
            print(f"DEBUG: status={resp.status_code} body={resp.text}")
        assert resp.status_code == 200
        assert resp.json()["error"] is False

    def test_webp_returns_200(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("f.webp", VALID_WEBP, "image/webp")},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["error"] is False


# ── /api/facturas/extraer-ia — rejection paths ────────────────────────────────


class TestFacturaRejection:
    def test_pdf_rejected_with_422(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("doc.pdf", PDF_BYTES, "application/pdf")},
            headers=headers,
        )
        assert resp.status_code == 422
        assert "PDF" in resp.text

    def test_gif_rejected_with_422(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("anim.gif", GIF_BYTES, "image/gif")},
            headers=headers,
        )
        assert resp.status_code == 422
        assert "GIF" in resp.text

    def test_heic_rejected_with_422(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("photo.heic", HEIC_BYTES, "image/heic")},
            headers=headers,
        )
        assert resp.status_code == 422
        assert "HEIC" in resp.text

    def test_oversize_rejected_with_422(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        # 10 MB + 1 byte of PNG
        oversize = VALID_PNG + b"\x00" * (10 * 1024 * 1024)
        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("huge.png", oversize, "image/png")},
            headers=headers,
        )
        assert resp.status_code == 422
        assert "10 MB" in resp.text

    def test_pdf_rejected_even_if_content_type_lies(self, ia_client):
        """The router validates magic bytes, not the Content-Type header."""
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("sneaky.jpg", PDF_BYTES, "image/jpeg")},
            headers=headers,
        )
        assert resp.status_code == 422
        assert "PDF" in resp.text

    def test_missing_file_part_rejected(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        # No `file` part at all
        resp = client.post(
            "/api/facturas/extraer-ia",
            headers=headers,
        )
        assert resp.status_code == 422


# ── /api/facturas/extraer-ia — auth & error ──────────────────────────────────


class TestFacturaAuthAndError:
    def test_unauthenticated_returns_401(self, ia_client):
        client = _client(ia_client)
        # No register, no login

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("f.png", VALID_PNG, "image/png")},
        )
        assert resp.status_code == 401

    def test_extractor_error_returns_200_with_error(self, ia_client):
        """RN-IA-05: SDK failure → 200 with `error=true`, fields=None."""
        client = _client(ia_client)
        state = _state(ia_client)

        # Make the SDK raise — the extractor should catch and return
        # PropuestaFactura(error=True, error_message=...)
        state.anthropic_client.messages.create.side_effect = RuntimeError(
            "simulated SDK failure"
        )

        headers = _register_login(client)

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("f.png", VALID_PNG, "image/png")},
            headers=headers,
        )
        data = resp.json()
        assert data["error"] is True
        assert "simulated" in (data["error_message"] or "")
        assert data["proveedor_nombre"] is None
        assert data["monto_total"] is None


# ── /api/facturas/extraer-ia — route ordering ────────────────────────────────


class TestFacturaRouteOrdering:
    def test_extraer_ia_route_listed_before_factura_id_route(self, ia_client):
        """D-IA-12: POST /extraer-ia must be registered BEFORE /{factura_id}."""
        from app.routers.facturas import router

        routes = [(r.path, r.methods) for r in router.routes if hasattr(r, "path")]
        # Find indices
        idx_extraer = next(
            (i for i, (p, _) in enumerate(routes) if p.endswith("/extraer-ia")),
            None,
        )
        idx_id = next(
            (
                i
                for i, (p, _) in enumerate(routes)
                if p.endswith("/{factura_id}") and "POST" in (routes[i][1] or set())
            ),
            None,
        )
        # Note: a `{factura_id}` path can match either PATCH or DELETE too.
        # The relevant ordering is: extraer-ia must be before ANY /{factura_id}
        idx_any_id = next(
            (i for i, (p, _) in enumerate(routes) if p.endswith("/{factura_id}")),
            None,
        )
        assert idx_extraer is not None, f"No /extraer-ia route in {routes}"
        assert idx_any_id is not None, f"No /{{factura_id}} route in {routes}"
        assert idx_extraer < idx_any_id, (
            f"/extraer-ia must be declared BEFORE /{{factura_id}} (D-IA-12). "
            f"Routes: {routes}"
        )

    def test_post_to_extraer_ia_does_not_match_factura_id(self, ia_client):
        """Sending a POST to /api/facturas/extraer-ia must NOT be captured by
        the /{factura_id} path param."""
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("f.png", VALID_PNG, "image/png")},
            headers=headers,
        )
        # If captured by /{factura_id} with a UUID validator, it would be 422
        # (not a valid UUID). The IA route handles it and returns 200.
        assert resp.status_code == 200, (
            f"POST /extraer-ia was wrongly captured by /{{factura_id}}: {resp.status_code}"
        )


# ── /api/facturas/extraer-ia — rate limit ─────────────────────────────────────


class TestFacturaRateLimit:
    def test_11th_request_returns_429(self, ia_client, monkeypatch):
        """C-21: the limit is driven by IA_RATE_MAX_REQUESTS (here set to 10
        to preserve this test's original scenario), not a hardcoded constant."""
        from app.core.rate_limit_ia import reset_ia_rate_limit_store

        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "10")
        reset_ia_rate_limit_store()
        client = _client(ia_client)
        headers = _register_login(client)

        # 10 calls in a row
        for _ in range(10):
            r = client.post(
                "/api/facturas/extraer-ia",
                files={"file": ("f.png", VALID_PNG, "image/png")},
                headers=headers,
            )
            assert r.status_code == 200

        # 11th is rate-limited
        r11 = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("f.png", VALID_PNG, "image/png")},
            headers=headers,
        )
        assert r11.status_code == 429
        assert "Retry-After" in r11.headers
        assert int(r11.headers["Retry-After"]) > 0


# ── /api/pagos/extraer-ia — happy & error paths ──────────────────────────────


class TestPagoHappyPath:
    def test_png_returns_200_with_pago_proposal(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/pagos/extraer-ia",
            files={"file": ("p.png", VALID_PNG, "image/png")},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        assert data["monto"] == "500.00"
        assert data["fecha"] == "2026-06-20"

    def test_pdf_rejected_with_422(self, ia_client):
        client = _client(ia_client)
        headers = _register_login(client)

        resp = client.post(
            "/api/pagos/extraer-ia",
            files={"file": ("doc.pdf", PDF_BYTES, "application/pdf")},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_unauthenticated_returns_401(self, ia_client):
        client = _client(ia_client)

        resp = client.post(
            "/api/pagos/extraer-ia",
            files={"file": ("p.png", VALID_PNG, "image/png")},
        )
        assert resp.status_code == 401

    def test_extractor_error_returns_200_with_error(self, ia_client):
        client = _client(ia_client)
        state = _state(ia_client)

        # VISION_PROVIDER=claude → factory returns ClaudeVisionExtractor
        # for both endpoints, so the SDK in use is Anthropic.
        state.anthropic_client.messages.create.side_effect = RuntimeError(
            "simulated failure"
        )

        headers = _register_login(client)

        resp = client.post(
            "/api/pagos/extraer-ia",
            files={"file": ("p.png", VALID_PNG, "image/png")},
            headers=headers,
        )
        data = resp.json()
        assert data["error"] is True
        assert "simulated" in (data["error_message"] or "")


# ── /api/pagos/extraer-ia — route ordering ───────────────────────────────────


class TestPagoRouteOrdering:
    def test_extraer_ia_before_pago_id(self, ia_client):
        from app.routers.pagos import router

        routes = [(r.path, r.methods) for r in router.routes if hasattr(r, "path")]
        idx_extraer = next(
            (i for i, (p, _) in enumerate(routes) if p.endswith("/extraer-ia")),
            None,
        )
        idx_id = next(
            (i for i, (p, _) in enumerate(routes) if p.endswith("/{pago_id}")),
            None,
        )
        assert idx_extraer is not None
        assert idx_id is not None
        assert idx_extraer < idx_id, (
            f"/extraer-ia must be declared BEFORE /{{pago_id}} (D-IA-12). "
            f"Routes: {routes}"
        )


# ── Shared rate limit budget ────────────────────────────────────────────────


class TestSharedRateLimit:
    def test_budget_shared_between_factura_and_pago_endpoints(
        self, ia_client, monkeypatch
    ):
        """D-IA-2: 10 requests TOTAL per usuario_id across BOTH endpoints.

        C-21: IA_RATE_MAX_REQUESTS is set explicitly to 10 to preserve this
        test's original scenario now that the Settings default is 60.
        """
        from app.core.rate_limit_ia import reset_ia_rate_limit_store

        monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "10")
        reset_ia_rate_limit_store()
        client = _client(ia_client)
        headers = _register_login(client)

        # 6 to /facturas + 4 to /pagos = 10 total
        for _ in range(6):
            r = client.post(
                "/api/facturas/extraer-ia",
                files={"file": ("f.png", VALID_PNG, "image/png")},
                headers=headers,
            )
            assert r.status_code == 200
        for _ in range(4):
            r = client.post(
                "/api/pagos/extraer-ia",
                files={"file": ("p.png", VALID_PNG, "image/png")},
                headers=headers,
            )
            assert r.status_code == 200

        # 11th — regardless of which endpoint — is rate-limited
        r11 = client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("f.png", VALID_PNG, "image/png")},
            headers=headers,
        )
        assert r11.status_code == 429
        r12 = client.post(
            "/api/pagos/extraer-ia",
            files={"file": ("p.png", VALID_PNG, "image/png")},
            headers=headers,
        )
        assert r12.status_code == 429
