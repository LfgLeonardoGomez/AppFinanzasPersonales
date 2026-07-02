> **Governance: CRÍTICO.** Auth es dominio crítico — `apply` queda GATED a revisión humana del plan antes de escribir cualquier código.
> **TDD estricto activo**: para cada tarea, test RED antes que producción; Postgres descartable (testcontainers), NUNCA SQLite. Cloudinary/visión no aplican acá.

## 1. Hashing y JWT (`app/core/security.py`)

- [x] 1.1 Implementar `hash_password(plain) -> str` y `verify_password(plain, hash) -> bool` con **argon2id** vía `passlib.context.CryptContext(schemes=["argon2"])`
- [x] 1.2 Implementar `create_access_token(sub, exp)` → JWT HS256 firmado con `SECRET_KEY`, claims `sub`/`exp`/`iat`/`type="access"`; `exp` derivado de `ACCESS_TOKEN_TTL_MIN`
- [x] 1.3 Implementar `create_refresh_token()` → valor opaco (`secrets.token_urlsafe(32+)`) + su hash; `decode_token(token)` valida firma+exp+type sin tocar DB
- [x] 1.4 Test: contraseña se persiste hasheada (≠ claro); `verify_password` True/False sin excepción; token válido decodifica `sub`/`type`; firma inválida y token expirado rechazados

## 2. Modelo `RefreshToken` y migración

- [x] 2.1 Crear `app/models/refresh_token.py`: `RefreshToken(TimestampUUIDMixin)` tabla `refresh_token` con `usuario_id` (FK, index), `token_hash` (único, index), `expires_at`, `revoked_at?`; NO usar `SoftDeleteMixin`
- [x] 2.2 Migración Alembic `002_refresh_token` reversible (crea tabla + índices; `downgrade` la elimina)
- [x] 2.3 Test: `alembic upgrade head` crea `refresh_token`; `downgrade` la elimina sin afectar tablas de C-02; solo se guarda hash; token con `revoked_at` poblado no es válido

## 3. Repositorios

- [x] 3.1 Extender `app/repositories/usuario_repository.py` con `create(data)` y `get_by_id(id)` (ya existe `get_by_email`)
- [x] 3.2 Crear `app/repositories/refresh_token_repository.py`: `create(...)`, `get_by_hash(hash)`, `revoke(id)` — solo acceso a datos, sin lógica de negocio
- [x] 3.3 Test: `create`/`get_by_id`/`get_by_email` correctos; `get_by_hash` recupera la fila; `revoke` marca `revoked_at`

## 4. Schemas Pydantic (`app/schemas/auth.py`)

- [x] 4.1 `RegistroRequest` (email validado, nombre, password min_length=8), `LoginRequest`, `UsuarioResponse` (SIN `password_hash`)
- [x] 4.2 Test: email mal formado y password < 8 → 422; `UsuarioResponse` nunca serializa `password_hash`

## 5. Service de autenticación (`app/services/usuario_service.py`)

- [x] 5.1 `registrar(email, nombre, password)`: valida email único (error "email en uso"), hashea, persiste
- [x] 5.2 `login(email, password)`: verifica credenciales con **mensaje genérico**; ejecuta `verify_password` contra hash dummy si el email no existe (anti timing-attack); emite access + refresh (persiste hash)
- [x] 5.3 `logout(refresh_token)`: revoca la fila de refresh
- [x] 5.4 `refresh(refresh_token)`: valida (no revocado, no expirado), emite par nuevo, **revoca el usado** (rotación)
- [x] 5.5 Test: registro OK + email duplicado; login OK; login fail email-inexistente y password-incorrecta dan el MISMO mensaje genérico; logout revoca; refresh rota (el viejo ya no sirve)

## 6. Dependencies (`app/core/deps.py`)

- [x] 6.1 `get_current_user`: lee `access_token` de cookie, `decode_token`, `get_by_id` → `Usuario`; ausencia/inválido/expirado → 401
- [x] 6.2 Dependency de **rate limiting** (5/60 s por IP, ventana deslizante in-memory); IP confiable según entorno (proxy vs `request.client.host`)
- [x] 6.3 Test: `get_current_user` devuelve el `Usuario` correcto por token y nunca el de otro usuario; sin cookie → 401; 6º intento en la ventana → 429; el límite es por IP

## 7. Routers y wiring

- [x] 7.1 `app/routers/auth.py`: `POST /api/auth/registro`, `POST /api/auth/login` (setea cookies `HttpOnly; Secure; SameSite=Lax`), `POST /api/auth/logout`, `POST /api/auth/refresh`
- [x] 7.2 `app/routers/usuarios.py`: `GET /api/me` (protegido con `get_current_user`, sin `password_hash`)
- [x] 7.3 Incluir ambos routers en `app/main.py`; aplicar el flag `Secure` de cookie según entorno (Secure en prod)
- [x] 7.4 Test integración: `/api/me` con sesión válida devuelve perfil sin `password_hash`; sin sesión → 401; flujo completo registro→login→me→refresh→logout

## 8. Verificación final

- [x] 8.1 Suite completa verde sobre Postgres descartable (testcontainers), nunca SQLite
- [x] 8.2 Confirmar: ninguna respuesta expone `password_hash`; refresh solo se guarda hasheado; login nunca distingue email-vs-password; access se valida sin lookup a DB
- [x] 8.3 Confirmar que el cálculo de saldo/estado y la autorización 404-not-403 de negocio NO se implementan acá (son C-06+); este change solo provee el `usuario_id`

## Review Workload Forecast

- **Estimación de líneas cambiadas**: ~350–450 (security.py, modelo+migración, 2 repos, schemas, service, deps, 2 routers, wiring + tests de integración con su boilerplate). Mayormente código nuevo aislado.
- **Decision needed before apply: Yes** — governance CRÍTICO: el plan requiere revisión humana antes de `apply` (no por tamaño, por criticidad del dominio).
- **Chained PRs recommended: No** — el change es cohesivo (una sola unidad de auth); partirlo dejaría slices no funcionales (login sin token, refresh sin modelo). Si en apply el diff supera 400 líneas reales, considerar `size:exception` antes que un split artificial.
- **400-line budget risk: Medium** — cerca del límite por los tests de integración. Mitigación: si excede, registrar `size:exception` (justificada por cohesión del dominio crítico) en vez de chained PRs.
