## Why

El proyecto no tiene aún ningún andamiaje de código: ni los dos repos (`facturas-proveedores-api` y `facturas-proveedores-web`), ni gestión de dependencias, ni configuración de entorno, ni tooling de tests, ni base para correr en local con Docker. Sin esta base, ningún change posterior (modelos, auth, facturas, pagos, cuenta corriente, IA) puede arrancar.

C-01 es el primer eslabón del camino crítico (`C-01 → C-02 → … → C-13`) y no tiene dependencias. Su objetivo es dejar **el esqueleto técnico ejecutable**: estructura de carpetas según el patrón Repository/Service/Router, dependencias declaradas, carga de variables de entorno tipada, health check, Alembic inicializado, entorno Docker de desarrollo, manifest PWA mínimo y el arnés de tests con Postgres descartable. Nada de lógica de dominio: esa llega en C-02 en adelante.

## What Changes

- **Estructura de carpetas** de los dos repos en su layout objetivo:
  - `facturas-proveedores-api/` con `app/` (`core/`, `models/`, `schemas/`, `repositories/`, `services/`, `routers/`) y `tests/`. Los subdirectorios de dominio quedan creados pero **vacíos** (los rellenan changes posteriores).
  - `facturas-proveedores-web/` con `src/` (`features/`, `shared/`, `app/`).
- **Backend — dependencias** (`pyproject.toml` o `requirements.txt`): FastAPI, SQLModel, Pydantic, alembic, `passlib[argon2]`, `python-jose`, httpx, pytest, `testcontainers[postgres]`. Solo se declaran; no se usan todavía.
- **Frontend — dependencias** (`package.json`): React 18, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS v4, Axios, `vite-plugin-pwa`, `openapi-typescript`. Más `tsconfig.json` (modo estricto, prohibido `any`) y `vite.config.ts`.
- **`app/main.py`**: instancia FastAPI con CORS configurado (origen explícito desde env, `credentials: true`, nunca `*` con credenciales) y health check `GET /health` que responde sin tocar la base de datos.
- **`app/core/config.py`**: carga de variables de entorno vía Pydantic `BaseSettings` para `DATABASE_URL`, `SECRET_KEY`, `CLOUDINARY_URL`, `VISION_PROVIDER`, `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`, `FRONTEND_ORIGIN`, `COOKIE_DOMAIN`. Falla en arranque si falta una variable obligatoria.
- **Alembic inicializado**: `alembic/` y `alembic.ini` con `sqlalchemy.url` leído desde env. **Sin migraciones de tablas** (el esquema inicial es de C-02).
- **`docker-compose.yml`** con servicios `db` (postgres:15), `api` (FastAPI) y `web` (Vite dev), más `docker-compose.override.yml` para desarrollo.
- **`.env.example`** con todas las variables documentadas (sin secretos reales) y **`.gitignore`** excluyendo `.env`, `__pycache__`, `node_modules`.
- **PWA básica**: `manifest.json` y service worker mínimo vía `vite-plugin-pwa` (instalable; sin estrategias de caché de negocio).
- **Scripts npm**: `dev`, `build`, `preview`, `generate-types` (`openapi-typescript` contra `/openapi.json`).
- **Arnés de tests**: `tests/conftest.py` con fixture de Postgres descartable (testcontainers / Docker) y un test de humo del health check. **Nunca SQLite.**
- **Decisión de fundación (D-16):** se documenta y se deja listo el default de `id = UUID (preferentemente UUIDv7)` para que C-02 lo aplique al escribir los modelos. C-01 **no** crea modelos; solo fija la convención y, si aplica, deja la utilidad/extensión disponible.

> **Fuera de alcance (lo cubren changes posteriores):** modelos SQLModel y migración inicial (C-02), auth y seguridad de sesión (C-03/C-04), Cloudinary firmado y extracción por IA, cualquier endpoint de dominio, despliegue productivo en Oracle Cloud / Vercel.

## Capabilities

### New Capabilities
- `project-foundation`: andamiaje ejecutable de ambos repos — estructura de carpetas en capas, dependencias declaradas, configuración tipada de entorno, health check, Alembic inicializado, entorno Docker de desarrollo, PWA mínima y arnés de tests con Postgres descartable.

### Modified Capabilities
<!-- Ninguna: es el primer change, no hay specs previas que modificar. -->

## Impact

- **Repos creados:** `facturas-proveedores-api/` y `facturas-proveedores-web/` (estructura y tooling; sin lógica de dominio).
- **Backend afectado:** `app/main.py`, `app/core/config.py`, `pyproject.toml`/`requirements.txt`, `alembic/` + `alembic.ini`, `tests/conftest.py`.
- **Frontend afectado:** `package.json`, `tsconfig.json`, `vite.config.ts`, `manifest.json`, service worker.
- **Infra/dev:** `docker-compose.yml`, `docker-compose.override.yml`, `.env.example`, `.gitignore`.
- **Dependencias externas declaradas (no integradas aún):** Postgres 15, Cloudinary, proveedor de visión (`VISION_PROVIDER`).
- **Governance:** BAJO (tooling/fundación, sin dominio crítico). Habilita C-02 (`core-models-backend`).
- **Decisión sembrada:** D-16 (id = UUID, preferir UUIDv7) — convención de fundación que C-02 hereda.
