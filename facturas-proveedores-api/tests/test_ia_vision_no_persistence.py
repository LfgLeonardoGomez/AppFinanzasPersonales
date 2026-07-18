"""
No-persistence regression tests for /extraer-ia (C-14, RN-IA-04).

Hard rule re-asserted here: the IA endpoints MUST NOT write to the
factura, factura_item, pago, or proveedor tables. The handler does
not even receive a `Session` dependency — the listener below is a
defense-in-depth backstop that catches a future regression where
somebody accidentally adds `session.add(...)` to the handler.

Tests:
1. POST /api/facturas/extraer-ia success → 0 mutations
2. POST /api/facturas/extraer-ia with extractor error → 0 mutations
3. POST /api/pagos/extraer-ia success → 0 mutations
4. POST /api/pagos/extraer-ia with extractor error → 0 mutations
5. POST /api/facturas/extraer-ia with PDF rejected (422) → 0 mutations
6. POST /api/facturas/extraer-ia rate-limited (429) → 0 mutations
7. Control: POST /api/facturas (CRUD normal) → 1 INSERT in factura
"""

import json
import uuid
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlmodel import Session, SQLModel


VALID_PNG = (
    b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a" + b"\x00" * 50
)
PDF_BYTES = b"%PDF-1.4" + b"\x00" * 50


# ── Module-scoped engine ─────────────────────────────────────────────────────


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


# ── Static AST assertion: handler must not import get_db ────────────────────


class TestHandlerHasNoSessionDependency:
    def test_factura_handler_does_not_inject_session(self):
        import ast
        from app.routers import facturas

        source = facturas.__file__ and open(facturas.__file__, encoding="utf-8").read()
        tree = ast.parse(source)

        for node in ast.walk(tree):
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                for decorator in node.decorator_list:
                    decorator_repr = ast.unparse(decorator) if hasattr(ast, "unparse") else ""
                    if "extraer-ia" in decorator_repr or "extraer_ia" in node.name:
                        for arg in node.args.args:
                            assert arg.arg != "session", (
                                f"Function {node.name} must not inject a Session "
                                f"(RN-IA-04: IA endpoints do not persist)"
                            )

    def test_pago_handler_does_not_inject_session(self):
        import ast
        from app.routers import pagos

        source = pagos.__file__ and open(pagos.__file__, encoding="utf-8").read()
        tree = ast.parse(source)

        for node in ast.walk(tree):
            if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                for decorator in node.decorator_list:
                    decorator_repr = ast.unparse(decorator) if hasattr(ast, "unparse") else ""
                    if "extraer-ia" in decorator_repr or "extraer_ia" in node.name:
                        for arg in node.args.args:
                            assert arg.arg != "session", (
                                f"Function {node.name} must not inject a Session "
                                f"(RN-IA-04: IA endpoints do not persist)"
                            )


# ── Runtime listener: capture INSERT/UPDATE/DELETE ──────────────────────────


class _FakeTextBlock:
    def __init__(self, text):
        self.text = text


def _make_anthropic_message(text):
    return SimpleNamespace(content=[_FakeTextBlock(text)])


def _default_anthropic_response():
    return _make_anthropic_message(
        json.dumps(
            {
                "proveedor_nombre": "Acme",
                "numero": "0001-001",
                "fecha_emision": "2026-06-15",
                "monto_total": 1234.56,
                "monto": "500.00",
                "fecha": "2026-06-20",
            }
        )
    )


@pytest.fixture
def mutation_capture(engine):
    """Returns a list that captures every INSERT/UPDATE/DELETE."""
    from sqlalchemy.orm import Session as SASession

    captured = []

    def before_flush(session, flush_context, instances):
        for obj in session.new:
            captured.append(("INSERT", obj.__class__.__name__))
        for obj in session.dirty:
            if session.is_modified(obj):
                captured.append(("UPDATE", obj.__class__.__name__))
        for obj in session.deleted:
            captured.append(("DELETE", obj.__class__.__name__))

    event.listen(SASession, "before_flush", before_flush)
    try:
        yield captured
    finally:
        event.remove(SASession, "before_flush", before_flush)


@pytest.fixture
def client_with_mocked_sdk(engine, env_vars):
    """TestClient with the SDK constructor mocked via patch.object.

    The patch is scoped to the fixture's lifetime (function scope), so
    it doesn't leak to other test modules. Yields (client, mock_client).

    C-16 (D-3): the unused `get_settings` import (was only there for
    `cache_clear()`) is removed.
    """
    from app.core.rate_limit_ia import reset_ia_rate_limit_store
    from app.services.ia_extraccion_service import (
        ClaudeVisionExtractor,
        OpenAIVisionExtractor,
    )

    # C-16 (D-3): `get_settings` is no longer cached; the
    # `get_settings.cache_clear()` call was removed.
    reset_ia_rate_limit_store()

    from app.main import app
    from app.services.ia_extraccion_service import get_vision_extractor

    # Clear the factory's lru_cache so the next call creates a new
    # extractor using the patched __init__ from THIS fixture.
    get_vision_extractor.cache_clear()

    mock_anthropic_client = MagicMock()
    mock_anthropic_client.messages.create.return_value = _default_anthropic_response()

    def patched_init(self, api_key, model=None):
        self._client = mock_anthropic_client
        self._model = "test-model"

    with patch.object(ClaudeVisionExtractor, "__init__", patched_init), patch.object(
        OpenAIVisionExtractor, "__init__", patched_init
    ):
        from app.routers.facturas import get_db
        from sqlmodel import Session

        def override_get_db():
            with Session(engine) as s:
                yield s

        app.dependency_overrides[get_db] = override_get_db
        try:
            client = TestClient(app)
            yield client, mock_anthropic_client
        finally:
            app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _reset_rate_limit(request):
    """Reset rate limit between tests (avoid bleed from shared budget)."""
    if "client_with_mocked_sdk" in request.fixturenames:
        from app.core.rate_limit_ia import reset_ia_rate_limit_store
        reset_ia_rate_limit_store()


def _register_login(client):
    """Register + login; return headers with cookie."""
    email = f"ia_{uuid.uuid4().hex[:8]}@test.com"
    password = "testpass123"
    ip = f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.3"

    client.post(
        "/api/auth/registro",
        json={"email": email, "password": password, "nombre": "Test"},
        headers={"X-Forwarded-For": ip},
    )
    login = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": ip},
    )
    assert login.status_code == 200
    token = login.cookies.get("access_token")
    return {"Cookie": f"access_token={token}"}


# ── 1. POST /api/facturas/extraer-ia success → 0 mutations ────────────────


def test_factura_extraer_ia_success_no_mutations(
    client_with_mocked_sdk, mutation_capture
):
    client, _ = client_with_mocked_sdk
    headers = _register_login(client)
    mutation_capture.clear()

    resp = client.post(
        "/api/facturas/extraer-ia",
        files={"file": ("factura.png", VALID_PNG, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["error"] is False
    assert mutation_capture == [], (
        f"Successful /facturas/extraer-ia triggered mutations: {mutation_capture}"
    )


# ── 2. POST /api/facturas/extraer-ia with extractor error → 0 mutations ───


def test_factura_extraer_ia_extractor_error_no_mutations(
    client_with_mocked_sdk, mutation_capture
):
    client, mock_client = client_with_mocked_sdk
    mock_client.messages.create.side_effect = RuntimeError("simulated failure")

    headers = _register_login(client)
    mutation_capture.clear()

    resp = client.post(
        "/api/facturas/extraer-ia",
        files={"file": ("factura.png", VALID_PNG, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["error"] is True
    assert mutation_capture == [], (
        f"Error-path /facturas/extraer-ia triggered mutations: {mutation_capture}"
    )


# ── 3. POST /api/pagos/extraer-ia success → 0 mutations ────────────────────


def test_pago_extraer_ia_success_no_mutations(
    client_with_mocked_sdk, mutation_capture
):
    client, _ = client_with_mocked_sdk
    headers = _register_login(client)
    mutation_capture.clear()

    resp = client.post(
        "/api/pagos/extraer-ia",
        files={"file": ("pago.png", VALID_PNG, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["error"] is False
    assert mutation_capture == [], (
        f"Successful /pagos/extraer-ia triggered mutations: {mutation_capture}"
    )


# ── 4. POST /api/pagos/extraer-ia with extractor error → 0 mutations ───────


def test_pago_extraer_ia_extractor_error_no_mutations(
    client_with_mocked_sdk, mutation_capture
):
    client, mock_client = client_with_mocked_sdk
    mock_client.messages.create.side_effect = RuntimeError("simulated failure")

    headers = _register_login(client)
    mutation_capture.clear()

    resp = client.post(
        "/api/pagos/extraer-ia",
        files={"file": ("pago.png", VALID_PNG, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["error"] is True
    assert mutation_capture == [], (
        f"Error-path /pagos/extraer-ia triggered mutations: {mutation_capture}"
    )


# ── 5. POST /api/facturas/extraer-ia with PDF rejected → 0 mutations ─────


def test_factura_extraer_ia_pdf_rejected_no_mutations(
    client_with_mocked_sdk, mutation_capture
):
    client, _ = client_with_mocked_sdk
    headers = _register_login(client)
    mutation_capture.clear()

    resp = client.post(
        "/api/facturas/extraer-ia",
        files={"file": ("doc.pdf", PDF_BYTES, "application/pdf")},
        headers=headers,
    )
    assert resp.status_code == 422
    assert mutation_capture == [], (
        f"PDF-rejected /facturas/extraer-ia triggered mutations: {mutation_capture}"
    )


# ── 6. POST /api/facturas/extraer-ia rate-limited → 0 mutations ──────────


def test_factura_extraer_ia_rate_limited_no_mutations(
    client_with_mocked_sdk, mutation_capture, monkeypatch
):
    """C-21: IA_RATE_MAX_REQUESTS is set explicitly to 10 to preserve this
    test's original scenario now that the Settings default is 60."""
    from app.core.rate_limit_ia import reset_ia_rate_limit_store

    monkeypatch.setenv("IA_RATE_MAX_REQUESTS", "10")
    reset_ia_rate_limit_store()
    client, _ = client_with_mocked_sdk
    headers = _register_login(client)
    for _ in range(10):
        client.post(
            "/api/facturas/extraer-ia",
            files={"file": ("f.png", VALID_PNG, "image/png")},
            headers=headers,
        )

    mutation_capture.clear()

    resp = client.post(
        "/api/facturas/extraer-ia",
        files={"file": ("f.png", VALID_PNG, "image/png")},
        headers=headers,
    )
    assert resp.status_code == 429
    assert "Retry-After" in resp.headers
    assert mutation_capture == [], (
        f"Rate-limited /facturas/extraer-ia triggered mutations: {mutation_capture}"
    )


# ── 7. Control: POST /api/facturas (CRUD) → 1 INSERT in factura ──────────


def test_control_factura_crud_does_mutate(
    client_with_mocked_sdk, mutation_capture
):
    client, _ = client_with_mocked_sdk
    headers = _register_login(client)
    prov = client.post(
        "/api/proveedores/",
        json={"nombre": "Prov2", "categoria": "OTRO"},
        headers=headers,
    ).json()

    mutation_capture.clear()

    resp = client.post(
        "/api/facturas/",
        json={
            "proveedor_id": prov["id"],
            "fecha_emision": date.today().isoformat(),
            "monto_total": "100.00",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    inserts = [e for e in mutation_capture if e[0] == "INSERT"]
    assert len(inserts) >= 1, (
        f"Listener did not capture the expected INSERT in `factura`. "
        f"Got: {mutation_capture}"
    )
