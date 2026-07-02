## Context

C-02 (`core-data-models`, archivada) dejó el modelo `Usuario` con `email` (único), `password_hash` y los campos de perfil, los repositorios de acceso a datos, el mixin `TimestampUUIDMixin` (id UUIDv7 vía `new_uuid` + timestamps) y `SoftDeleteMixin`. La config (`app/core/config.py`) ya expone `SECRET_KEY` (mín 32 chars), `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`, `FRONTEND_ORIGIN` y `COOKIE_DOMAIN`. `passlib[argon2]` y `python-jose` ya son dependencias (C-01). El `UsuarioRepository` ya tiene `get_by_email`; el `password_hash` se guarda en `Usuario` pero el hashing es responsabilidad de este change (anotado en C-02).

Este change construye la autenticación: es la frontera de seguridad del sistema. Toda la app es **multi-usuario con datos aislados por `usuario_id`** (KB 03) y ese aislamiento solo funciona si hay una identidad autenticada confiable. Governance **CRÍTICO**: un fallo compromete todas las cuentas. El despliegue objetivo es un VPS Oracle Free Tier de **1 GB RAM**, lo que restringe fuertemente el diseño de verificación de sesión (no se puede pagar un lookup a DB por cada request).

El modelo de autorización NO es RLS de Postgres: el proyecto filtra por `usuario_id` en el **service layer** y devuelve **404 (no 403)** ante recursos ajenos (KB 03, regla dura #3). `get_current_user` es la única fuente del `usuario_id` autenticado.

## Goals / Non-Goals

**Goals:**

- Hashing de contraseñas con **argon2id** (passlib), nunca plaintext ni reversible.
- Sesión basada en cookie `httpOnly`: access token **JWT stateless** (TTL corto) + refresh **opaco rotado y revocable** server-side.
- Endpoints `/api/auth/registro`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/refresh` y `/api/me`.
- Dependency `get_current_user` que valida el access token sin tocar la DB y devuelve el `Usuario`.
- Rate limiting de registro y login (5/60 s por IP).
- Migración Alembic de la tabla `refresh_token`.
- Mensaje de error **genérico** en login; validación completa con **Pydantic** en backend.

**Non-Goals:**

- Frontend de auth (C-04), perfil editable / avatar (C-05), recuperación de password por email (fuera del MVP).
- Roles / permisos / RBAC (no hay en el MVP — solo aislamiento horizontal).
- Validación de invariantes de negocio de facturas/pagos (C-08+).
- Almacén de rate limiting distribuido (Redis): el MVP corre en una sola instancia; in-memory alcanza.

## Decisions

### D-C03-1: Access token JWT stateless + refresh opaco rotado (resuelve Q-02)

El **access token** es un JWT firmado con `SECRET_KEY` (HS256), con claims mínimos: `sub` (=`usuario_id`), `exp`, `iat`, y `type="access"`. Se verifica **sin consultar la DB** (`decode_token` valida firma y expiración). El **refresh token** es **opaco** (string aleatorio de alta entropía, `secrets.token_urlsafe(32+)`), se persiste **hasheado** en la tabla `refresh_token` y se **rota en cada `/refresh`**: la fila vieja se marca `revoked_at` y se emite una nueva. Logout borra/revoca la fila → el refresh deja de renovar.

- **Por qué**: la verificación stateless del access es obligatoria para el VPS de 1 GB — pagar un SELECT por request no escala ni en CPU ni en conexiones. La rotación del refresh da **revocación real de sesión** (logout efectivo) sin renunciar al stateless del access.
- **Trade-off aceptado**: un access token sigue siendo válido hasta su `exp` aunque se haya hecho logout. Mitigación: **TTL corto** (30 min, D-C03-4). Para revocación inmediata del access habría que volver stateful (rechazado por costo).
- **Alternativa descartada**: tokens de acceso opacos con lookup a DB → revocación inmediata pero un round-trip a Postgres por request. Rechazada por el límite de RAM/conexiones del VPS.
- **Hash del refresh**: se guarda `sha256(token)` (o el hash de passlib) — **nunca el valor crudo**. Una fuga de la tabla no permite renovar sesiones. El lookup en `/refresh` es por hash.

### D-C03-2: Modelo `RefreshToken` (tabla nueva, no estaba en C-02)

```
RefreshToken(TimestampUUIDMixin, table=True)
  __tablename__ = "refresh_token"
  usuario_id : uuid.UUID  (FK → usuario, nullable=False, index=True)
  token_hash : str        (nullable=False, index=True, unique)
  expires_at : datetime   (nullable=False)
  revoked_at : Optional[datetime] (nullable=True)  # None = activo
```

- **Por qué**: la rotación/revocación necesita estado server-side. C-02 solo tenía `Usuario`; esta tabla es propia de este change.
- **NO usa `SoftDeleteMixin`**: `revoked_at` es semánticamente distinto de `deleted_at` (un token revocado/rotado no es un "borrado lógico de UI", es un estado de ciclo de vida de sesión). Se modela explícito.
- Índice por `token_hash` (lookup en `/refresh`) y por `usuario_id` (revocar todas las sesiones de un usuario en logout-all futuro). Un token es válido si `revoked_at IS NULL AND expires_at > now()`.

### D-C03-3: Cookie de primera parte vía rewrite/proxy (resuelve Q-03)

Estrategia primaria: Vercel hace **rewrite** de `/api/*` al VPS → el browser ve el mismo origen → cookies de **primera parte** con `HttpOnly; Secure; SameSite=Lax; Path=/`. No hay preflight CORS en el camino primario. Se setean dos cookies: `access_token` (TTL 30 min) y `refresh_token` (TTL 30 días, `Path=/api/auth/refresh` para minimizar exposición).

- **Por qué**: `SameSite=Lax` + primera parte es lo más seguro y simple; evita CORS con credenciales y el riesgo de `SameSite=None`.
- **Fallback documentado (no implementado por defecto)**: orígenes separados → `SameSite=None; Secure`, `COOKIE_DOMAIN` explícito, CORS con `allow_origins=[FRONTEND_ORIGIN]` y `allow_credentials=True` (nunca `*`). El validator de `FRONTEND_ORIGIN` en config ya bloquea `*`.
- **Logout** borra ambas cookies (`max_age=0`) **y** revoca la fila de refresh.

### D-C03-4: TTLs concretos (resuelve Q-04)

Access = `ACCESS_TOKEN_TTL_MIN` (30 min). Refresh = `REFRESH_TOKEN_TTL_DAYS` (30 días). Ambos ya existen en config como obligatorios (`gt=0`). El TTL corto del access es la mitigación del trade-off de D-C03-1.

### D-C03-5: Autorización y mensaje genérico en el service layer

`registrar`, `login`, `logout` y la rotación viven en `usuario_service.py`. `login` devuelve **un único mensaje genérico** ("Credenciales inválidas") tanto si el email no existe como si la password no coincide — nunca revela cuál falló (KB 08 §Errores, regla dura). `registrar` **sí** puede revelar "email en uso" (no es un oráculo de credenciales: el email ya es enumerable por el propio registro). El service compara siempre con `verify_password` aun cuando el email no existe (comparación contra un hash dummy) para evitar **timing attacks** que distingan email-inexistente de password-incorrecta.

- **Por qué**: el mensaje genérico evita enumeración de cuentas; la comparación de tiempo constante la hace robusta también en latencia.

### D-C03-6: `get_current_user` stateless desde cookie

Dependency (`Annotated[Usuario, Depends(get_current_user)]`) que: lee `access_token` de la cookie, llama `decode_token` (valida firma + `exp` + `type=="access"`), extrae `sub`, y trae el `Usuario` por `get_by_id`. Si falta/inválido/expirado → **401**. El único SELECT es el `get_by_id` del usuario autenticado (no por sesión); se acepta porque es el dueño de la request, no un costo por verificación de sesión.

- **Por qué**: separa "validar la sesión" (stateless, barato) de "hidratar el usuario" (un get por id). Endpoints que solo necesitan el `usuario_id` podrán usar una variante que devuelve solo el `sub` sin tocar la DB (optimización futura).
- **404 vs 401**: ausencia de sesión válida → **401** (no autenticado). El **404** de aislamiento (recurso ajeno) es responsabilidad de los services de C-06+, que ya reciben el `usuario_id` desde acá.

### D-C03-7: Rate limiting in-memory con ventana deslizante

5 intentos / 60 s por IP en `registro` y `login`, como dependency. Almacén **in-memory** (dict IP→deque de timestamps) porque el MVP corre en una sola instancia.

- **Por qué**: protege contra fuerza bruta y abuso de registro sin agregar Redis (memoria escasa en el VPS).
- **Limitación documentada**: no sobrevive reinicios ni escala horizontal. Si la app pasa a multi-instancia, migrar a Redis detrás de la misma dependency. La IP se toma respetando el proxy (`X-Forwarded-For` confiable solo detrás del rewrite controlado).
- **Tests**: el 6º intento dentro de la ventana → **429**.

## Risks / Trade-offs

- **[Access no revocable hasta `exp`]** → logout no invalida el access en curso. Mitigación: TTL 30 min (D-C03-4); el refresh sí se revoca de inmediato. Aceptado conscientemente por el costo del stateful en 1 GB RAM.
- **[`SECRET_KEY` comprometida = todos los JWT falsificables]** → Mitigación: secreto solo en env (regla dura #10), mín 32 chars (ya validado en config), rotación documentada como runbook. Refresh hasheado limita el blast radius de una fuga de DB (no de la key).
- **[Rate limiting in-memory]** → no distribuido, se pierde al reiniciar. Mitigación: aceptable en MVP single-instance; abstraído tras una dependency para cambiar a Redis sin tocar routers.
- **[`X-Forwarded-For` spoofeable]** → si el rate limit confía en un header de IP manipulable, se evade. Mitigación: confiar en `X-Forwarded-For` **solo** detrás del rewrite/proxy controlado; en local usar `request.client.host`.
- **[Timing attack en login]** → distinguir email-inexistente por latencia. Mitigación: `verify_password` siempre contra un hash (dummy si el email no existe) — D-C03-5.
- **[Cookie sin `Secure` en local]** → en dev por HTTP, `Secure` rompe la cookie. Mitigación: flag de cookie derivado del entorno (Secure en prod, relajado en dev) sin filtrar a producción.

## Migration Plan

1. `app/core/security.py`: hashing argon2id + funciones JWT (`create_access_token`, `create_refresh_token`, `decode_token`).
2. `app/models/refresh_token.py`: modelo `RefreshToken`. Migración Alembic `002_refresh_token` (reversible).
3. `app/repositories/`: extender `usuario_repository` (`create`, `get_by_id`) + nuevo `refresh_token_repository` (`create`, `get_by_hash`, `revoke`).
4. `app/schemas/auth.py`: `RegistroRequest`, `LoginRequest`, `UsuarioResponse` (sin `password_hash`), etc. — validación Pydantic (email, password mín 8).
5. `app/services/usuario_service.py`: `registrar`, `login`, `logout`, `refresh` (rotación).
6. `app/core/deps.py`: `get_current_user`. Dependency de rate limiting.
7. `app/routers/auth.py` + `app/routers/usuarios.py`; incluirlos en `app/main.py`.
8. Tests de integración sobre Postgres descartable (testcontainers, nunca SQLite); Cloudinary/visión no aplican acá.

**Rollback**: `alembic downgrade` elimina `refresh_token`; el código nuevo está aislado (no modifica modelos de C-02), salvo la extensión aditiva del `usuario_repository` y la inclusión de routers en `main.py`, ambas reversibles por revert.

## Open Questions

- **Doble cookie vs cookie única**: ¿`access_token` y `refresh_token` en dos cookies (refresh con `Path` restringido) o un solo token? Recomendación: dos cookies con `Path` del refresh acotado a `/api/auth/refresh` para minimizar exposición. A confirmar en apply.
- **`get_current_user` ligero**: ¿exponer una variante que devuelva solo `usuario_id` (sin `get_by_id`) para endpoints que no necesitan el `Usuario` completo? Difiérase a C-06 cuando exista el primer consumidor que lo justifique.
- **IP detrás del proxy**: confirmar en deploy qué header de IP es confiable tras el rewrite de Vercel→VPS antes de cablear el rate limit a `X-Forwarded-For`.
