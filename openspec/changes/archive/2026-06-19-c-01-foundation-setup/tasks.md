## 1. Estructura de repos y control de versiones

- [x] 1.1 Crear el repo/directorio `facturas-proveedores-api/` con `app/` y los subdirectorios vacíos `core/`, `models/`, `schemas/`, `repositories/`, `services/`, `routers/` (con `__init__.py` para que sean importables) y `tests/`
- [x] 1.2 Crear el repo/directorio `facturas-proveedores-web/` con `src/features/`, `src/shared/` y `src/app/`
- [x] 1.3 Agregar `.gitignore` que excluya `.env`, `__pycache__/` y `node_modules/`
- [x] 1.4 Agregar `.env.example` documentando todas las variables: `DATABASE_URL`, `SECRET_KEY`, `CLOUDINARY_URL`, `VISION_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`, `FRONTEND_ORIGIN`, `COOKIE_DOMAIN` (sin secretos reales)

## 2. Backend — dependencias y configuración

- [x] 2.1 Declarar dependencias backend (`pyproject.toml` preferido, o `requirements.txt`): FastAPI, SQLModel, Pydantic, alembic, `passlib[argon2]`, `python-jose`, httpx, pytest, `testcontainers[postgres]`
- [x] 2.2 Implementar `app/core/config.py` con Pydantic `BaseSettings` que exponga todas las variables de entorno tipadas y falle en arranque si falta una obligatoria
- [x] 2.3 Documentar la convención D-16 (`id` = UUID, preferir UUIDv7) en el código/README de fundación; si aplica, dejar disponible la utilidad/extensión para generar UUIDv7, SIN crear modelos de dominio

## 3. Backend — app FastAPI y health check

- [x] 3.1 Implementar `app/main.py` con la instancia FastAPI
- [x] 3.2 Configurar CORS con origen explícito desde `FRONTEND_ORIGIN` y `credentials: true` (nunca `*` con credenciales)
- [x] 3.3 Implementar el endpoint `GET /health` que responda `200` sin acceder a la base de datos

## 4. Backend — Alembic

- [x] 4.1 Inicializar Alembic (`alembic/` y `alembic.ini`)
- [x] 4.2 Configurar `sqlalchemy.url` para que se resuelva desde la variable de entorno (no hardcodeado)
- [x] 4.3 Verificar que NO se generen migraciones de tablas de dominio (el esquema inicial es de C-02)

## 5. Backend — arnés de tests

- [x] 5.1 Implementar `tests/conftest.py` con fixture de PostgreSQL descartable vía testcontainers (o Docker efímero); nunca SQLite
- [x] 5.2 Escribir un test de humo que verifique `GET /health` → `200`
- [x] 5.3 Correr la suite de tests y confirmar que pasa con la base descartable

## 6. Frontend — dependencias y tooling

- [x] 6.1 Inicializar `package.json` con React 18, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS v4, Axios, `vite-plugin-pwa`, `openapi-typescript`
- [x] 6.2 Agregar `tsconfig.json` en modo estricto (que prohíba `any`) y `vite.config.ts`
- [x] 6.3 Definir scripts npm: `dev`, `build`, `preview`, `generate-types` (`openapi-typescript` contra `/openapi.json`)
- [x] 6.4 Configurar Tailwind CSS v4 mínimo para que el build funcione

## 7. Frontend — PWA mínima

- [x] 7.1 Agregar `manifest.json` básico (nombre, iconos, theme)
- [x] 7.2 Configurar `vite-plugin-pwa` con service worker mínimo para que la app sea instalable (sin estrategias de caché de negocio)

## 8. Entorno de desarrollo Docker

- [x] 8.1 Crear `docker-compose.yml` con servicios `db` (`postgres:15`), `api` (FastAPI) y `web` (Vite dev)
- [x] 8.2 Crear `docker-compose.override.yml` para desarrollo (hot reload, volúmenes de código)
- [x] 8.3 Levantar el stack con `docker compose up` y verificar que `GET /health` responde `200` desde el contenedor `api`

## 9. Verificación final

- [x] 9.1 Confirmar que ambos repos tienen su estructura objetivo y los paquetes son importables
- [x] 9.2 Confirmar que `.env` está ignorado y `.env.example` lista todas las variables
- [x] 9.3 Confirmar que la suite de tests pasa y que el stack Docker arranca con el health check OK
