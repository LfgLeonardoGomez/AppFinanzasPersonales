## Why

C-02 dejó los modelos de dominio y los repositorios, pero el backend no tiene autenticación: cualquier endpoint sería público y no existe forma de saber qué `usuario_id` opera. El sistema entero depende del aislamiento horizontal por cuenta (`usuario_id`), y ese aislamiento solo es posible si hay una identidad autenticada confiable. Este change aporta el portón de entrada: registro, login, logout, refresh y la dependency `get_current_user` que todo el resto del backend (C-06+) usará como fuente del `usuario_id`. Es governance **CRÍTICO**: un error acá compromete todas las cuentas. Resuelve además Q-02, Q-03 y Q-04.

## What Changes

- `app/core/security.py`: `hash_password` (argon2id vía passlib), `verify_password`, `create_access_token(sub, exp)`, `create_refresh_token()`, `decode_token(token)`. El access token es un **JWT firmado** (HS256 con `SECRET_KEY`), verificación **stateless** (sin lookup a DB por request — crítico para el VPS Oracle de 1 GB). El refresh token es **opaco**, persistido **hasheado** server-side y **rotado en cada `/refresh`** (Q-02).
- **Nuevo modelo `RefreshToken`** (tabla nueva que C-02 no incluía): `id` (UUIDv7), `usuario_id` (FK), `token_hash`, `expires_at`, `created_at`, `revoked_at` (nullable). Se guarda solo el HASH del token, nunca el valor crudo.
- Rate limiting en `registro` y `login`: 5 intentos / 60 s por IP (ventana deslizante) — dependency/middleware.
- `app/repositories/usuario_repository.py`: extender con `create` y `get_by_id` (ya existe `get_by_email`). Nuevo `refresh_token_repository.py` para la tabla nueva.
- `app/services/usuario_service.py`: `registrar` (email único, hash, persiste), `login` (verifica credenciales, **mensaje genérico** — nunca revela si falló email o password), `logout` (invalida refresh), y la lógica de **rotación** de refresh.
- `app/routers/auth.py`: `POST /api/auth/registro`, `POST /api/auth/login` (setea cookies `httpOnly; Secure; SameSite=Lax`), `POST /api/auth/logout`, `POST /api/auth/refresh`.
- `app/routers/usuarios.py`: `GET /api/me` (perfil del usuario autenticado).
- Dependency `get_current_user`: extrae el access token de la cookie, lo valida (stateless), devuelve el `Usuario`.
- Migración Alembic `002` para la tabla `refresh_token`.
- **Despliegue (Q-03)**: rewrite/proxy de Vercel a `/api` → mismo origen aparente → cookie de primera parte `SameSite=Lax`, sin preflight CORS en el camino primario. CORS cross-origin (`SameSite=None; Secure` + `FRONTEND_ORIGIN`/`COOKIE_DOMAIN`) documentado solo como **fallback**.
- **TTLs (Q-04)**: access 30 min (`ACCESS_TOKEN_TTL_MIN`), refresh 30 días (`REFRESH_TOKEN_TTL_DAYS`) — ya scaffoldeados en config.

**Fuera de alcance**: frontend de auth (C-04), recuperación de contraseña por email (fuera del MVP, se resuelve en DB a mano), perfil editable / avatar (C-05), roles o permisos (no hay en el MVP).

## Capabilities

### New Capabilities
- `auth-backend`: autenticación de backend — hashing argon2id, JWT de acceso stateless + refresh opaco rotado y revocable, modelo `RefreshToken`, rate limiting de registro/login, endpoints `/api/auth/*` y `/api/me`, y la dependency `get_current_user` que provee el `usuario_id` autenticado al resto del backend.

### Modified Capabilities
<!-- Ninguna. core-data-models (C-02) está archivada; este change agrega la tabla refresh_token sin alterar sus requisitos. -->

## Impact

- **Repositorio afectado**: `facturas-proveedores-api`.
- **Código nuevo**: `app/core/security.py`, `app/models/refresh_token.py`, `app/repositories/refresh_token_repository.py`, `app/services/usuario_service.py`, `app/routers/auth.py`, `app/routers/usuarios.py`, `app/core/deps.py` (o equivalente para `get_current_user`), una migración `alembic/versions/002_*`, schemas Pydantic de auth, y tests de integración.
- **Código modificado**: `app/repositories/usuario_repository.py` (agrega `create`/`get_by_id`), `app/main.py` (incluye los routers nuevos).
- **Dependencias**: `passlib[argon2]` y `python-jose` ya están declaradas (C-01). Reutiliza `Usuario` (C-02), el mixin `TimestampUUIDMixin`, `new_uuid` y `settings`.
- **Consumidores aguas abajo**: C-04 (auth-frontend) consume estos endpoints; C-06+ usan `get_current_user` para el `usuario_id`.
- **Dependencia previa**: C-02 (archivada). Sin bloqueos.
- **Governance**: CRÍTICO — `apply` queda GATED a revisión humana del plan.
