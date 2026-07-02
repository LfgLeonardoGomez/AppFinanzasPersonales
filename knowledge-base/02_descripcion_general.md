# 02 · Descripción General

> Fuente: `docs/00-vision-general.md` §3, `docs/03-arquitectura-tecnica.md`.

## Stack tecnológico

### Backend — `facturas-proveedores-api`
- **FastAPI** (Python) + **PostgreSQL**.
- **SQLModel** (tablas) + **Pydantic** (schemas request/response).
- Patrón **Repository / Service / Router**.
- **UnitOfWork** para operaciones atómicas (consistente con el proyecto FoodStore).

### Frontend — `facturas-proveedores-web`
- **PWA**: React + TypeScript + Vite.
- **TanStack Query** (estado de servidor), **Zustand** (estado de UI local), **Axios**.
- **Tailwind CSS v4**.
- Estructura por **features**.
- Instalable desde el navegador (manifest + service worker vía plugin PWA de Vite).

### Autenticación
- Cookie **httpOnly** (NO localStorage).
- **Access token JWT stateless** (HS256, `sub`=usuario_id, `type=access`).
- **Refresh token opaco** con hash SHA-256 persistido server-side, `revoked_at` + `expires_at`, **rotación obligatoria** en cada `/api/auth/refresh` (D-17, RN-AUTH-01..05).
- Multi-usuario con datos aislados por cuenta.

## Arquitectura general

Dos repositorios **separados** (sin monorepo). El frontend consume la API exclusivamente vía **HTTP/JSON**. Los tipos TypeScript del frontend se generan desde el schema **OpenAPI** que FastAPI expone en `/openapi.json`, usando **`openapi-typescript`** — no se duplican definiciones de tipos a mano.

```
[ PWA React (Vercel) ]  --HTTP/JSON-->  [ FastAPI (VPS Oracle, Docker) ]  -->  [ PostgreSQL ]
                                              |
                                              +--> Cloudinary (archivos)
                                              +--> Modelo de visión (Claude/OpenAI/...)
```

## Integraciones externas

| Integración | Uso | Notas |
|---|---|---|
| **Cloudinary** | Almacenamiento de archivos: facturas (`archivo_url`), comprobantes (`comprobante_url`), avatares (`avatar_url`). | Solo almacena/recupera URLs. **No** hace el análisis IA. Upload preset **firmado** desde el backend. |
| **Modelo de visión IA** | Extracción de cabecera de factura/pago desde imagen → JSON estructurado. | **Abstracción configurable** (`VISION_PROVIDER`): Claude, OpenAI, etc. Permite comparar modelos. |

## Infraestructura y despliegue

| Componente | Dónde |
|---|---|
| Backend (FastAPI + Postgres) | VPS **Oracle Cloud Free Tier** (1GB RAM), vía Docker |
| Frontend (build estático) | **Vercel** o Netlify |
| Imágenes/archivos | **Cloudinary** |

> **Nota de capacidad:** con 1GB de RAM total, FastAPI + Postgres conviven sin problema mientras no se sumen procesos pesados. Esto justifica elegir FastAPI sobre un runtime más pesado para este entorno.

## Persistencia de tipos (back → front)

FastAPI expone OpenAPI automáticamente → `openapi-typescript` genera los tipos del frontend. **Single source of truth** de contratos: el backend.

## Estado de testing (post-c-17, 2026-06-29)

- **Suite backend:** `0 failed, 701 passed` (c-17 archived). Antes: `101 failed, 575 passed` (pre-c-17). Ver `08_arquitectura_propuesta.md` §Patrón de test pollution fix para el detalle del fix y la regresión bloqueante.
- **Tests protegidos c-16** (no deben regresionar): `test_alembic_migration_0003.py` 6/6, `test_config.py` 7/7, `test_deps.py` 9/9.
- **Deuda técnica conocida:** alembic 0004/0005 + `test_refresh_token_model.py` mutan `os.environ["DATABASE_URL"]` sin restaurar. NO son la fuente de pollution (corren antes del `del sys.modules`), pero queda como housekeeping futuro (c-18+).
- **Lint frontend deferido** (D-24): `npm run lint` en `facturas-proveedores-web/` está roto por ESLint v10 vs config v9 — no es regresión reciente.
