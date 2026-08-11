"""
Punto de entrada principal de la API.

Instancia la aplicación FastAPI, configura CORS y registra el
health check. Las variables de entorno se cargan al importar
app.core.config — si falta alguna obligatoria, el proceso falla aquí.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import auth as auth_router
from app.routers import usuarios as usuarios_router
from app.routers import proveedores as proveedores_router
from app.routers import facturas as facturas_router
from app.routers import pagos as pagos_router
from app.routers import cloudinary_preset as cloudinary_preset_router
from app.routers import actividad as actividad_router
from app.routers import equipo as equipo_router

# ── Instancia FastAPI ─────────────────────────────────────────────────────────
app = FastAPI(
    title="Facturas Proveedores API",
    description="API REST para gestión de facturas de proveedores.",
    version="0.1.0",
    # Deshabilitar /docs y /redoc en producción (se habilitará via env flag en C-03)
    docs_url="/docs",
    redoc_url="/redoc",
)

# ── CORS ──────────────────────────────────────────────────────────────────────
# REGLA: origen explícito + credentials:true. Nunca allow_origins=["*"]
# con allow_credentials=True (viola la spec CORS y el baseline de seguridad).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router.router)
app.include_router(usuarios_router.router)
app.include_router(proveedores_router.router)
app.include_router(facturas_router.router)
app.include_router(pagos_router.router)
app.include_router(cloudinary_preset_router.router)
app.include_router(actividad_router.router)
app.include_router(equipo_router.router)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get(
    "/health",
    tags=["infraestructura"],
    summary="Liveness probe",
    description=(
        "Responde 200 indicando que el proceso está vivo. "
        "NO consulta la base de datos para que funcione como liveness probe "
        "incluso cuando la DB no está disponible."
    ),
)
async def health_check() -> dict[str, str]:
    """
    Liveness probe — no depende de la base de datos.

    Retorna:
        {"status": "ok"}
    """
    return {"status": "ok"}
