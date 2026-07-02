## Context

Es el primer change del proyecto: no existe código todavía. La arquitectura objetivo está definida en `knowledge-base/08_arquitectura_propuesta.md` (backend en capas Repository/Service/Router con UnitOfWork; frontend React/Vite por features; dos repos separados; tipos TS generados desde OpenAPI). El baseline de seguridad y la lista de variables de entorno también están fijados ahí y son requisitos, no sugerencias.

Restricciones de fundación relevantes para C-01:
- **Tests con Postgres real/contenedor, nunca SQLite** (regla dura #9).
- **Secretos en env vars, `.env` en `.gitignore`** (regla dura #10).
- **CORS solo con origen explícito + `credentials:true`, nunca `*` con credenciales** (baseline de seguridad).
- **Infra productiva**: backend en Oracle Cloud Free Tier (1GB RAM) y frontend estático (Vercel). C-01 NO despliega; solo deja el entorno local con Docker Compose.
- **D-16** (resuelve Q-01): `id = UUID, preferir UUIDv7`. C-01 siembra la convención; C-02 la aplica al escribir los modelos.

## Goals / Non-Goals

**Goals:**
- Dejar ambos repos con su estructura de carpetas objetivo y paquetes importables.
- Declarar todas las dependencias backend y frontend (sin integrarlas a dominio).
- Configuración de entorno tipada (Pydantic `BaseSettings`) que falle rápido si falta algo.
- App FastAPI mínima con `GET /health` y CORS correcto.
- Alembic inicializado y apuntando a la URL del entorno, sin migraciones de tablas.
- Entorno de desarrollo reproducible con Docker Compose (`db`/`api`/`web`).
- PWA instalable mínima y scripts npm (incluido `generate-types`).
- Arnés de tests con Postgres descartable y un test de humo del health check.
- Documentar la convención D-16 (UUID/UUIDv7) como default de fundación.

**Non-Goals:**
- Modelos SQLModel, migración de esquema inicial e índices (C-02).
- Autenticación, manejo de sesión, hashing real de password, autorización por `usuario_id` (C-03/C-04).
- Cálculo de saldo/estado FIFO, lógica de proveedores/facturas/pagos/cuenta corriente.
- Integración real con Cloudinary (preset firmado) y con el proveedor de visión / IA.
- Despliegue productivo (Oracle Cloud / Vercel), TLS, rate limiting, backups.

## Decisions

**D-16 — `id` = UUID, preferir UUIDv7 (resuelve Q-01).** Se elige UUID sobre serial por dos razones: (1) resistencia a enumeración, alineada con el baseline (recurso ajeno → 404 sin revelar existencia); (2) UUIDv7 es time-ordered, evita la fragmentación de índices en Postgres que sufre UUIDv4 y alinea el desempate FIFO `(fecha_emision, created_at, id)` con el orden de inserción. **En C-01** esto se traduce solo en: documentar la convención y, si la implementación lo requiere, dejar disponible la utilidad/extensión para generar UUIDv7 (p. ej. helper en Python o `pg_uuidv7`), **sin crear modelos**. Alternativa descartada: serial/bigint autoincremental — más simple pero enumerable y no portable para multi-usuario.

**Gestión de dependencias backend: `pyproject.toml` (preferido) o `requirements.txt`.** Se prefiere `pyproject.toml` por ser el estándar actual y permitir separar deps de runtime y de dev; si la implementación opta por `requirements.txt` por simplicidad de la imagen Docker, es aceptable mientras declare el set completo. Decisión delegada a apply, documentada aquí para no bloquear.

**Config con Pydantic `BaseSettings` y fail-fast.** La configuración se valida al instanciarse; variables obligatorias sin default hacen fallar el arranque. Esto previene desplegar con configuración incompleta. Los TTL se exponen tipados (int) aunque su uso real llegue en auth.

**Health check sin DB.** `GET /health` no consulta la base para que sirva como probe de liveness del proceso aun cuando la DB esté caída; un readiness check con DB puede agregarse cuando exista capa de datos (no en C-01).

**Postgres descartable en tests vía testcontainers (preferido) o Docker Compose efímero.** Se descarta SQLite por divergencias de tipos (UUID, numeric, constraints) que invalidarían los tests de los changes de dominio. Decisión vinculante (regla dura #9).

**Service worker mínimo vía `vite-plugin-pwa`.** Solo lo necesario para instalabilidad (manifest + SW registrado). Sin estrategias de caché de datos: definirlas ahora sería especular sobre features que no existen.

## Risks / Trade-offs

- **UUIDv7 aún sin soporte universal en librerías Python/Postgres** → C-01 no obliga a generar UUIDv7 todavía; deja la convención documentada y la utilidad disponible. La generación real se valida en C-02. Si UUIDv7 no fuera viable, el fallback es UUIDv4 (la convención "id = UUID" se mantiene).
- **testcontainers requiere Docker disponible en CI/local** → documentar el prerrequisito en `.env.example`/README de tests; el entorno ya usa Docker Compose, así que la dependencia de Docker es coherente con el proyecto.
- **1GB RAM en la VPS productiva** → no impacta C-01 (solo entorno local), pero las imágenes Docker deben pensarse livianas desde el inicio para no rehacerlas luego. Mitigación: base slim para la imagen `api`.
- **Declarar dependencias sin usarlas** (passlib, python-jose, etc.) → riesgo de drift de versiones hasta que se usen en C-03+. Mitigación: fijar rangos razonables ahora; revisar con `pip-audit`/`npm audit` antes de los changes que las activen.
- **CORS mal configurado filtra credenciales** → la spec fija explícitamente origen desde `FRONTEND_ORIGIN` y prohíbe `*` con credenciales; cubierto por escenario de la spec.

## Migration Plan

No aplica migración de datos (no hay esquema todavía). Despliegue de C-01 = bootstrap local:
1. Crear estructura de ambos repos y archivos de dependencias.
2. `docker compose up` levanta `db`, `api`, `web`; `GET /health` responde 200.
3. `alembic` resuelve la URL desde env sin migraciones de tablas.
4. Suite de tests (Postgres descartable) verde con el test de humo del health check.

Rollback: al ser fundación sin estado persistente, revertir = descartar los archivos creados; no hay datos ni esquema que migrar hacia atrás.

## Open Questions

- Gestión de dependencias backend definitiva (`pyproject.toml` vs `requirements.txt`): a confirmar en apply según la estrategia de la imagen Docker.
- Mecanismo concreto de generación de UUIDv7 (helper en Python vs extensión `pg_uuidv7`): se decide en C-02 al escribir los modelos; C-01 solo deja la convención.
