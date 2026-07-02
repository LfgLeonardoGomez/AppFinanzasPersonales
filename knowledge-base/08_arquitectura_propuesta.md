# 08 · Arquitectura Propuesta

> Fuente: `docs/03-arquitectura-tecnica.md`, `docs/04-baseline-seguridad.md`.

## Repositorios

Dos repos separados, sin monorepo:
- **`facturas-proveedores-api`** (backend, FastAPI)
- **`facturas-proveedores-web`** (frontend, PWA)

El frontend consume la API solo vía HTTP/JSON. Tipos TS generados desde `/openapi.json` con `openapi-typescript`.

## Backend — patrón Repository / Service / Router

```
app/
├── main.py
├── core/
│   ├── config.py          # variables de entorno
│   ├── security.py        # hash de password, cookie/JWT
│   └── unit_of_work.py    # UnitOfWork (operaciones atómicas)
├── models/                # SQLModel (tablas)
│   ├── usuario.py · proveedor.py · factura.py · pago.py
├── schemas/               # Pydantic (request/response)
│   ├── proveedor.py · factura.py · pago.py
├── repositories/          # acceso a datos, SIN lógica de negocio
│   ├── proveedor_repository.py · factura_repository.py · pago_repository.py
├── services/              # lógica de negocio (saldo, estado, reglas)
│   ├── usuario_service.py · proveedor_service.py · factura_service.py
│   ├── pago_service.py · ia_extraccion_service.py
└── routers/               # endpoints HTTP, autorización
    ├── auth.py · usuarios.py · proveedores.py · facturas.py · pagos.py
```

### Reglas de capas (vinculantes)
- La **autorización** (recurso pertenece al usuario autenticado) vive en el **service layer**, no en el router.
- El **cálculo de saldo y estado FIFO** vive en el **service layer**, no en repository (solo queries) ni router.
- Operaciones que tocan >1 tabla en una sola operación usan **`UnitOfWork`** para atomicidad.

### Abstracción de IA de visión
```
class VisionExtractor (interfaz)
    extraer_factura(imagen) -> PropuestaFactura   # proveedor, numero, fecha, monto_total
    extraer_pago(imagen)    -> PropuestaPago      # proveedor, monto, fecha, metodo

Implementaciones: ClaudeVisionExtractor, OpenAIVisionExtractor, ...
```
- Extractor concreto elegido por `VISION_PROVIDER`.
- Prompt y schema JSON **compartidos**; cada implementación adapta la llamada pero devuelve la misma estructura Pydantic normalizada.
- El service **parsea y valida** contra schema estricto: campo ausente → `null`, nunca inventado. **Nunca persiste**: devuelve propuesta al router.

## Frontend — feature-based

```
src/
├── features/
│   ├── auth/ · proveedores/ · facturas/ · pagos/ · cuenta-corriente/
├── shared/
│   ├── components/ · hooks/ · api/   # Axios + tipos generados de OpenAPI
└── app/
    ├── router.tsx · theme/           # claro/oscuro
```
Stack: React + TS + Vite, TanStack Query (servidor), Zustand (UI local), Axios, Tailwind v4. **PWA** instalable (manifest + service worker vía plugin Vite).

## Subida de archivos (Cloudinary)

Tres usos: `archivo_url` (factura), `comprobante_url` (pago), `avatar_url` (usuario). Flujo: frontend sube directo a Cloudinary con **upload preset firmado desde el backend**, y envía solo la URL. Validar **tipo (PDF/jpg/png) y tamaño** (máx ~10 MB) en cliente **y** al persistir — no confiar en el `content-type` del cliente.

## Baseline de seguridad (requisitos, no sugerencias)

| # | Requisito |
|---|---|
| Transporte | HTTPS/TLS obligatorio en front y back. VPS con Let's Encrypt (Caddy/Nginx). |
| Contraseñas | argon2id (o bcrypt). Mín 8 chars, sin máximo bajo. Nunca en logs. |
| Sesión | Access token corto httpOnly + refresh. Flags `HttpOnly`/`Secure`/`SameSite`. Logout invalida sesión. |
| Autorización | Filtrar por `usuario_id` en service layer. Recurso ajeno → **404** (no 403). |
| Validación | Pydantic en backend. `monto>0`, fechas no futuras (UTC-3), CUIT, enums. Queries parametrizadas. |
| Archivos | Solo PDF/JPG/PNG; validar MIME real. Preset firmado. |
| Rate limiting | Login, registro, y endpoint de IA (costoso). |
| Errores | Login fallido → mensaje genérico. Sin stack traces en prod. |
| Secretos | En env vars, nunca commiteados. `.env` en `.gitignore`. |
| BD/backups | Postgres sobre TLS si remoto, usuario con privilegios mínimos, **backups regulares** (`pg_dump` por cron, retención fuera de la instancia). |
| CORS | Solo en fallback: origen explícito + `credentials:true`. Nunca `*` con credenciales. |
| Dependencias | `pip-audit` / `npm audit` antes de deploys importantes. |
| Logs | No registrar contraseñas, tokens ni URLs firmadas. |

## Variables de entorno (backend)

```
DATABASE_URL=
SECRET_KEY=
CLOUDINARY_URL=
VISION_PROVIDER=claude          # claude | openai | ...
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
ACCESS_TOKEN_TTL_MIN=           # ej. 30
REFRESH_TOKEN_TTL_DAYS=         # ej. 30
FRONTEND_ORIGIN=                # CORS en fallback de orígenes separados
COOKIE_DOMAIN=
```

## Estrategia de testing (resumen)

- Backend: **pytest** + FastAPI TestClient/httpx. **Postgres descartable** (Docker/testcontainers), evitar SQLite. Servicios externos (Cloudinary, visión) **siempre mockeados**.
- Frontend: **Vitest** + React Testing Library + **MSW**.
- Estructura **AAA**, tests independientes, cobertura pragmática (priorizar saldo/estado/aislamiento). CI opcional (GitHub Actions).
- Detalle en `docs/05-convenciones-testing.md`.

### Patrón de test pollution fix (c-16, c-17)

**Problema resuelto (c-17, archivado 2026-06-29):** 101 fallas de tests en suite completa que pasaban aislados — la firma canónica de inter-file test pollution.

**Root cause:** `tests/test_deps.py::TestLazyEngine::test_deps_module_does_not_construct_engine_at_import` (línea 232) hace `del sys.modules["app.core.deps"]` y reimporta, creando un módulo nuevo con un `get_db` nuevo. Los routers de `app.main` (registrados al import inicial) conservan la referencia al `get_db` viejo. Los fixtures de los 6 archivos pollutos hacían `from app.core.deps import get_db` para setear `app.dependency_overrides[get_db] = override_get_db`; tras el `del sys.modules`, ese import devuelve el `get_db` nuevo, así que el override se setea con la **key equivocada** y el `Depends(get_db)` del router nunca lo encuentra. Los tests caen al lazy engine de `app.core.deps` viejo, que apunta a un DSN de testcontainer muerto.

**Fix aplicado en el consumer (D-23):** los 6 archivos pollutos (`test_factura_integration.py`, `test_pago_integration.py`, `test_proveedor_integration.py`, `test_perfil_integration.py`, `test_ia_vision_integration.py`, `test_ia_vision_no_persistence.py`) importan `get_db` desde el **módulo de router** correspondiente (`from app.routers.facturas import get_db` etc.), que mantiene la referencia vieja en su namespace. La fuente (`test_deps.py`) es c-16 protected y no se toca.

**Regresión bloqueante (RN-TEST-01, F-TEST-01):** `facturas-proveedores-api/tests/test_pollution_fix.py` — 13 tests organizados en:
- 1 invariante de module-identity (`TestRouterModuleIdentityInvariant::test_routers_keep_old_get_db_after_deps_reload`)
- 6 fixture contracts (AST inspection sobre los 6 archivos pollutos)
- 6 isolation regressions (parametrized, cada archivo corre en suite sin fallar)

**Resultado del sync:** la suite completa pasa de `101 failed, 575 passed` (baseline pre-c-17) a `0 failed, 701 passed`. Los 22 tests protegidos de c-16 (`test_alembic_migration_0003.py` 6/6, `test_config.py` 7/7, `test_deps.py` 9/9) siguen pasando.

### Estado del lint del frontend (deferido)

> ⚠️ **`npm run lint` en `facturas-proveedores-web/` está actualmente roto** por incompatibilidad entre ESLint v10 (versión instalada) y la config plana de v9 (legada de c-13). NO es regresión reciente. Documentado como D-24 (deferido, fuera de alcance para cualquier change posterior). Un fix requiere bumpear la config a formato flat de v10 o downgradear ESLint a v9.x.
