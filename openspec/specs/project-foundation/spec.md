# project-foundation Specification

## Purpose

Establish the executable scaffolding of both repos — `facturas-proveedores-api` and `facturas-proveedores-web` — so every subsequent change in the 15-change roadmap can start from a runnable, testable, type-safe base instead of an empty directory. Shipped by C-01, this capability defines the layered backend structure (`app/{core,models,schemas,repositories,services,routers}` + `tests/`, with the domain subdirectories created but empty, reserved for later changes) and the PWA frontend structure (`src/{features,shared,app}`), declares the full dependency manifests in `pyproject.toml` (FastAPI, SQLModel, Pydantic, alembic, `passlib[argon2]`, `python-jose`, httpx, pytest, `testcontainers[postgres]`) and `package.json` (React 18, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS v4, Axios, `vite-plugin-pwa`, `openapi-typescript`), configures a fail-fast Pydantic `BaseSettings` in `app/core/config.py` for `DATABASE_URL`, `SECRET_KEY`, `CLOUDINARY_URL`, `VISION_PROVIDER`, the access/refresh token TTLs, `FRONTEND_ORIGIN`, and `COOKIE_DOMAIN` (with `.env.example` documented and `.env` in `.gitignore`), and ships a minimal FastAPI app with a `GET /health` probe that does NOT touch the database (so it works as a liveness probe even when Postgres is down). Alembic is initialized with `sqlalchemy.url` read from env but ships no table migrations (those land in C-02), and a `docker-compose.yml` with `db` (postgres:15) / `api` (FastAPI) / `web` (Vite dev) plus `docker-compose.override.yml` provides a reproducible local environment. The PWA is installable (`manifest.json` + a minimal service worker via `vite-plugin-pwa`, no business cache strategies), npm scripts include `dev` / `build` / `preview` / `generate-types`, and the test harness uses real Postgres via testcontainers (never SQLite, per the project's hard rule #9) with a smoke test of the health check. Foundation decision D-16 (resolves Q-01) seeds the convention `id = UUID, prefer UUIDv7` — UUID over serial for enumeration resistance, UUIDv7 over UUIDv4 for time-ordered insertion and FIFO-friendly `(fecha_emision, created_at, id)` tie-breaking; the actual generation utility ships in C-02 when the models land.
## Requirements
### Requirement: Estructura de carpetas del backend en capas
El repositorio `facturas-proveedores-api` SHALL contener el directorio `app/` con los subdirectorios `core/`, `models/`, `schemas/`, `repositories/`, `services/` y `routers/`, más un directorio `tests/`. Los subdirectorios de dominio SHALL quedar creados pero vacíos (sin lógica de negocio), reservados para changes posteriores.

#### Scenario: Layout en capas presente
- **WHEN** se inspecciona el repositorio backend tras aplicar el change
- **THEN** existen `app/core/`, `app/models/`, `app/schemas/`, `app/repositories/`, `app/services/`, `app/routers/` y `tests/`

#### Scenario: Subdirectorios de dominio sin lógica
- **WHEN** se revisan los subdirectorios de dominio (`models/`, `schemas/`, `repositories/`, `services/`, `routers/`)
- **THEN** no contienen modelos, schemas ni endpoints de negocio (solo el andamiaje necesario para que el paquete sea importable)

### Requirement: Estructura de carpetas del frontend por features
El repositorio `facturas-proveedores-web` SHALL contener el directorio `src/` con los subdirectorios `features/`, `shared/` y `app/`, siguiendo la organización por features.

#### Scenario: Layout por features presente
- **WHEN** se inspecciona el repositorio frontend tras aplicar el change
- **THEN** existen `src/features/`, `src/shared/` y `src/app/`

### Requirement: Dependencias del backend declaradas
El backend SHALL declarar sus dependencias (en `pyproject.toml` o `requirements.txt`) incluyendo FastAPI, SQLModel, Pydantic, alembic, `passlib[argon2]`, `python-jose`, httpx, pytest y `testcontainers[postgres]`.

#### Scenario: Dependencias instalables
- **WHEN** se instala el entorno del backend desde el archivo de dependencias
- **THEN** la instalación incluye FastAPI, SQLModel, Pydantic, alembic, passlib[argon2], python-jose, httpx, pytest y testcontainers para Postgres, sin errores de resolución

### Requirement: Dependencias y configuración del frontend declaradas
El frontend SHALL declarar en `package.json` las dependencias React 18, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS v4, Axios, `vite-plugin-pwa` y `openapi-typescript`, y SHALL incluir `tsconfig.json` en modo estricto (que prohíbe `any`) y `vite.config.ts`.

#### Scenario: Dependencias e instalación
- **WHEN** se instalan las dependencias del frontend
- **THEN** quedan disponibles React 18, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS v4, Axios, vite-plugin-pwa y openapi-typescript

#### Scenario: TypeScript en modo estricto
- **WHEN** se compila el frontend con un uso de `any` explícito
- **THEN** el compilador de TypeScript reporta error por la configuración estricta

### Requirement: Aplicación FastAPI con health check
El backend SHALL exponer una instancia FastAPI en `app/main.py` con un endpoint `GET /health` que responda estado satisfactorio sin acceder a la base de datos.

#### Scenario: Health check responde OK
- **WHEN** se hace `GET /health` contra la app arrancada
- **THEN** responde `200` con un cuerpo que indica estado saludable

#### Scenario: Health check no depende de la base de datos
- **WHEN** la base de datos no está disponible y se hace `GET /health`
- **THEN** el endpoint igualmente responde `200` (no consulta la base de datos)

### Requirement: CORS configurado por origen explícito
La aplicación FastAPI SHALL configurar CORS con un origen explícito tomado de la variable de entorno `FRONTEND_ORIGIN` y `credentials: true`, y SHALL NOT usar `*` como origen cuando se permiten credenciales.

#### Scenario: Origen explícito permitido
- **WHEN** una request preflight llega desde el origen configurado en `FRONTEND_ORIGIN`
- **THEN** la respuesta CORS permite ese origen con credenciales habilitadas

#### Scenario: Nunca comodín con credenciales
- **WHEN** se inspecciona la configuración CORS
- **THEN** el origen permitido es explícito y nunca `*` mientras `credentials` esté en `true`

### Requirement: Carga tipada de variables de entorno
El backend SHALL cargar la configuración en `app/core/config.py` mediante Pydantic `BaseSettings`, exponiendo al menos `DATABASE_URL`, `SECRET_KEY`, `CLOUDINARY_URL`, `VISION_PROVIDER`, `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`, `FRONTEND_ORIGIN` y `COOKIE_DOMAIN`, y SHALL fallar en el arranque si falta una variable obligatoria.

#### Scenario: Configuración válida carga
- **WHEN** todas las variables obligatorias están definidas en el entorno
- **THEN** la configuración se instancia correctamente y expone los valores tipados

#### Scenario: Falla en arranque si falta una variable obligatoria
- **WHEN** falta una variable obligatoria (por ejemplo `DATABASE_URL`) al instanciar la configuración
- **THEN** se lanza un error de validación que impide el arranque

### Requirement: Alembic inicializado sin migraciones de tablas
El backend SHALL incluir Alembic inicializado (`alembic/` y `alembic.ini`) con `sqlalchemy.url` resuelto desde la variable de entorno, y SHALL NOT incluir migraciones que creen tablas de dominio (el esquema inicial corresponde a un change posterior).

#### Scenario: Alembic operativo
- **WHEN** se ejecuta el comando de estado/historial de Alembic
- **THEN** Alembic responde usando la URL de base de datos del entorno sin error de configuración

#### Scenario: Sin migraciones de tablas de dominio
- **WHEN** se revisa el directorio de versiones de Alembic
- **THEN** no existen migraciones que creen tablas de dominio (usuario, proveedor, factura, pago)

### Requirement: Entorno de desarrollo con Docker Compose
El proyecto SHALL incluir `docker-compose.yml` con los servicios `db` (postgres:15), `api` (FastAPI) y `web` (Vite dev), más un `docker-compose.override.yml` para desarrollo.

#### Scenario: Servicios definidos
- **WHEN** se inspecciona `docker-compose.yml`
- **THEN** define los servicios `db` sobre `postgres:15`, `api` para FastAPI y `web` para el servidor de desarrollo de Vite

### Requirement: Plantilla de entorno y exclusiones de git
El proyecto SHALL incluir `.env.example` documentando todas las variables de entorno sin secretos reales, y `.gitignore` que excluya `.env`, `__pycache__` y `node_modules`.

#### Scenario: Plantilla completa sin secretos
- **WHEN** se revisa `.env.example`
- **THEN** lista todas las variables requeridas con valores de ejemplo o vacíos, sin secretos reales

#### Scenario: Secretos fuera del control de versiones
- **WHEN** se revisa `.gitignore`
- **THEN** excluye `.env`, `__pycache__` y `node_modules`

### Requirement: PWA instalable mínima
El frontend SHALL incluir un `manifest.json` y un service worker mínimo configurado vía `vite-plugin-pwa`, de modo que la aplicación sea instalable, sin estrategias de caché de negocio.

#### Scenario: App instalable
- **WHEN** se sirve el build del frontend en un navegador compatible
- **THEN** el manifest y el service worker permiten instalar la PWA

### Requirement: Scripts npm del frontend
El frontend SHALL definir en `package.json` los scripts `dev`, `build`, `preview` y `generate-types`, donde `generate-types` ejecuta `openapi-typescript` para derivar tipos desde el OpenAPI de la API.

#### Scenario: Scripts disponibles
- **WHEN** se listan los scripts de `package.json`
- **THEN** existen `dev`, `build`, `preview` y `generate-types`

### Requirement: Arnés de tests con Postgres descartable
El backend SHALL incluir `tests/conftest.py` con una fixture que provea una base de datos PostgreSQL descartable (mediante testcontainers o Docker) y SHALL NOT usar SQLite para los tests.

#### Scenario: Fixture de Postgres descartable
- **WHEN** se ejecuta la suite de tests del backend
- **THEN** la fixture levanta una base de datos PostgreSQL efímera y la descarta al terminar

#### Scenario: Test de humo del health check
- **WHEN** se corre el test de humo del endpoint `GET /health`
- **THEN** el test pasa verificando respuesta `200`

#### Scenario: Nunca SQLite
- **WHEN** se inspecciona la configuración de tests
- **THEN** ningún test usa SQLite como motor de base de datos

### Requirement: Convención de identificadores UUID sembrada (D-16)
El change SHALL documentar y dejar como default de fundación que el identificador `id` de las entidades será UUID, preferentemente UUIDv7, para que los modelos creados en el change posterior hereden esta convención. El change SHALL NOT crear modelos de dominio.

#### Scenario: Convención documentada
- **WHEN** se revisa la documentación del change (proposal/design)
- **THEN** queda registrado que `id` es UUID (preferentemente UUIDv7) como decisión de fundación D-16, con su justificación

#### Scenario: Sin modelos de dominio
- **WHEN** se revisa el resultado del change
- **THEN** no existen modelos SQLModel de dominio (se crean en el change siguiente)

