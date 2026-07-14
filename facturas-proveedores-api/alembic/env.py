"""
Entorno de ejecución de Alembic.

La URL de la base de datos se lee SIEMPRE desde la variable de entorno
DATABASE_URL (a través de app.core.config.settings). Nunca se hardcodea.

Migraciones online y offline están soportadas.
"""

import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Agregar el directorio raíz al path para importar app.*
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

# ── Config de Alembic ─────────────────────────────────────────────────────────
config = context.config

# Configurar logging desde alembic.ini
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ── Metadata de los modelos ───────────────────────────────────────────────────
# C-02: importar todos los modelos de dominio para que SQLModel los registre
# en su metadata antes de que Alembic compare contra el esquema real.
try:
    import app.models  # noqa: F401 — registra todas las tablas en SQLModel.metadata
    from sqlmodel import SQLModel
    target_metadata = SQLModel.metadata
except ImportError:
    target_metadata = None


def get_url() -> str:
    """
    Lee la URL de la base de datos desde la variable de entorno.

    Prioridad:
    1. Variable de entorno DATABASE_URL (directa, útil en CI/Docker)
    2. app.core.config.settings.DATABASE_URL (carga desde .env)
    """
    url = os.environ.get("DATABASE_URL")
    if not url:
        from app.core.config import settings
        url = settings.DATABASE_URL
    return url


def run_migrations_offline() -> None:
    """
    Ejecutar migraciones en modo 'offline' (genera SQL sin conectar a la DB).

    Útil para revisar las SQL antes de aplicarlas o en entornos sin DB.
    """
    url = get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # Comparar tipos para detectar cambios de tipo en columnas
        compare_type=True,
        # Comparar valores default
        compare_server_default=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Ejecutar migraciones en modo 'online' (conecta directamente a la DB).

    Modo habitual para aplicar migraciones en desarrollo y producción.
    """
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = get_url()

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
