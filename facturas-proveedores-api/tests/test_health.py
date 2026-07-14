"""
Tests del endpoint GET /health.

TDD cycle:
  RED   → test escrito antes de que existiera el endpoint
  GREEN → app/main.py implementa el endpoint mínimo
  TRIANGULATE → segundo caso: health funciona aunque la DB no esté disponible

Spec: requirement "Aplicación FastAPI con health check"
  Scenario 1: Health check responde OK → 200 con cuerpo saludable
  Scenario 2: Health check no depende de la base de datos → 200 sin consultar DB
"""

import pytest
from fastapi.testclient import TestClient


class TestHealthEndpoint:
    """Verifica el endpoint GET /health."""

    def test_health_returns_200(self, client: TestClient):
        """
        Scenario 1: Health check responde OK.

        WHEN se hace GET /health
        THEN responde 200.
        """
        response = client.get("/health")
        assert response.status_code == 200

    def test_health_returns_ok_status(self, client: TestClient):
        """
        Scenario 1 (cuerpo): la respuesta indica estado saludable.

        WHEN se hace GET /health
        THEN el cuerpo contiene {"status": "ok"}.
        """
        response = client.get("/health")
        data = response.json()
        assert data["status"] == "ok"

    def test_health_does_not_require_database(self, client: TestClient):
        """
        Scenario 2: Health check no depende de la base de datos.

        WHEN se hace GET /health (independientemente del estado de la DB)
        THEN el endpoint no intenta conexión a la DB y responde 200.

        Verificamos indirectamente: el TestClient no tiene DB real configurada
        (db_url apunta al contenedor pero el endpoint no la usa),
        y el test pasa sin errores de conexión.
        """
        # El health check devuelve hardcoded "ok" sin tocar la DB.
        # Si tocara la DB sin que las tablas existan, fallaría.
        response = client.get("/health")
        assert response.status_code == 200
        # Asegurar que no hay error de DB en el cuerpo
        assert "error" not in response.json()


class TestCORSConfiguration:
    """Verifica que CORS no usa wildcard con credentials."""

    def test_cors_has_explicit_origin(self, client: TestClient):
        """
        WHEN se inspecciona la configuración CORS de la app
        THEN el origin permitido es explícito (no '*').
        """
        from app.core.config import get_settings
        settings = get_settings()
        assert settings.FRONTEND_ORIGIN != "*"
        assert settings.FRONTEND_ORIGIN.startswith("http")
