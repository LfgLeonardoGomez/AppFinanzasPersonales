# CHANGES — Secuencia de Implementación

> Índice canónico de todos los changes del proyecto **AppFinanzasPPersonales**.
> Cada change es atómico: un agente puede implementarlo en una sesión (~4-6 horas).
> **Leer este archivo antes de ejecutar cualquier `/opsx:propose`.**

---

## Cómo usar este documento

1. **Identificar el change** a trabajar por su código `C-NN` y verificar que sus dependencias estén en estado `[x]` completado.
2. **Leer los archivos de KB** listados en la sección "Leer antes" del change antes de proponer o implementar.
3. **Ejecutar** `/opsx:propose C-NN-nombre-del-change` para crear los artefactos del change.
4. Implementar con `/opsx:apply`, verificar y luego archivar con `/opsx:archive`.
5. **Marcar el checkbox `[x]` con la fecha de archive** (`archivado YYYY-MM-DD`) en este archivo en cuanto el change complete `/opsx:archive` — el orquestador lo hace automáticamente como housekeeping.

---

## Árbol de dependencias

```
C-01 foundation-setup
└── C-02 core-models-backend
    ├── C-03 auth-backend
    │   └── C-04 auth-frontend
    │       └── C-05 perfil-usuario
    ├── C-06 proveedores-backend
    │   └── C-07 proveedores-frontend
    │       └── C-08 facturas-backend
    │           └── C-09 facturas-frontend
    │               └── C-10 pagos-backend
    │                   └── C-11 pagos-frontend
    │                       └── C-12 cuenta-corriente-backend
    │                           └── C-13 cuenta-corriente-frontend
    │                               └── C-14 ia-vision-backend
    │                                   ├── C-15 ia-vision-frontend
    │                                   └── C-15a origen-ia-backend   (paralelo a C-15)
    │
    └── (post-MVP housekeeping — paralelo a partir de C-13 ✓)
        ├── C-16 fix-suite                   (después de C-13)
        ├── C-17 fix-test-pollution          (después de C-13)
        └── C-18 housekeeping-fixes          (después de C-13)
```

### Paralelismo por fase

```
GATE 0: (inicio) — sin dependencias previas
  → C-01 foundation-setup             [Agente A]

GATE 1: C-01 ✓ — PRIMER FORK
  → C-02 core-models-backend          [Agente A]

GATE 2: C-02 ✓
  → C-03 auth-backend                 [Agente A]
  → C-06 proveedores-backend          [Agente B]    ← FORK: backend core paralelo

GATE 3: C-03 ✓
  → C-04 auth-frontend                [Agente C]

GATE 4: C-04 ✓ y C-06 ✓
  → C-05 perfil-usuario               [Agente C — si C-04 ✓]
  → C-07 proveedores-frontend         [Agente B — si C-06 ✓]

GATE 5: C-07 ✓ y C-04 ✓             ← FORK: facturas y pagos comparten base
  → C-08 facturas-backend             [Agente A]

GATE 6: C-08 ✓
  → C-09 facturas-frontend            [Agente C]

GATE 7: C-09 ✓
  → C-10 pagos-backend                [Agente A]

GATE 8: C-10 ✓
  → C-11 pagos-frontend               [Agente C]

GATE 9: C-11 ✓
  → C-12 cuenta-corriente-backend     [Agente A]

GATE 10: C-12 ✓
  → C-13 cuenta-corriente-frontend    [Agente C]

GATE 11: C-13 ✓ — IA AL FINAL (sobre flujo manual funcionando)
  → C-14 ia-vision-backend            [Agente A]

GATE 12: C-14 ✓
  → C-15 ia-vision-frontend           [Agente C]
```

### Camino crítico (12 changes — mínimo irreducible)

```
C-01 → C-02 → C-03 → C-04 → C-07 → C-08 → C-09 → C-10 → C-11 → C-12 → C-13 → C-14* → C-15*
```

> `*` C-14 y C-15 (IA de visión) son el cierre del MVP pero técnicamente opcionales para el flujo de carga manual.
> El producto es funcional desde C-13 (cuenta corriente operativa). El camino crítico para producción minimal es de 10 changes (hasta C-13).

### Plan óptimo con 3 agentes

| Paso | Agente A (Backend Core) | Agente B (Backend Aux) | Agente C (Frontend) |
|------|------------------------|----------------------|---------------------|
| 1    | C-01 foundation-setup  | —                    | —                   |
| 2    | C-02 core-models       | —                    | —                   |
| 3    | C-03 auth-backend      | C-06 proveedores-backend | —               |
| 4    | —                      | —                    | C-04 auth-frontend  |
| 5    | C-08 facturas-backend  | —                    | C-05 perfil + C-07 proveedores-frontend |
| 6    | C-10 pagos-backend     | —                    | C-09 facturas-frontend |
| 7    | C-12 cc-backend        | —                    | C-11 pagos-frontend |
| 8    | C-14 ia-vision-backend | —                    | C-13 cc-frontend    |
| 9    | —                      | —                    | C-15 ia-vision-frontend |

---

## FASE 1 — Fundación e Infraestructura

### [C-01] `foundation-setup`
- **Estado**: `[x]` archivado 2026-06-19
- **Scope**:
  - Estructura de carpetas: `facturas-proveedores-api/` (FastAPI) y `facturas-proveedores-web/` (React/Vite PWA)
  - Backend: `pyproject.toml` / `requirements.txt` con FastAPI, SQLModel, Pydantic, alembic, passlib[argon2], python-jose, httpx, pytest, testcontainers-postgres
  - Frontend: `package.json` con React 18, TypeScript, Vite, TanStack Query, Zustand, Tailwind CSS v4, Axios, vite-plugin-pwa, openapi-typescript; `tsconfig.json`, `vite.config.ts`
  - `app/main.py` con instancia FastAPI, CORS configurado, health check `GET /health`
  - `app/core/config.py` — carga de env vars via Pydantic BaseSettings: `DATABASE_URL`, `SECRET_KEY`, `CLOUDINARY_URL`, `VISION_PROVIDER`, `ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`, `FRONTEND_ORIGIN`, `COOKIE_DOMAIN`
  - `alembic/` inicializado; `alembic.ini` con `sqlalchemy.url` desde env
  - `docker-compose.yml` con servicios: `db` (postgres:15), `api` (fastapi), `web` (vite dev); `docker-compose.override.yml` para dev
  - `.env.example` con todas las vars; `.gitignore` excluyendo `.env`, `__pycache__`, `node_modules`
  - PWA manifest básico: `manifest.json`, service worker vacío via vite-plugin-pwa
  - Scripts npm: `dev`, `build`, `preview`, `generate-types` (openapi-typescript)
  - Tests: `tests/conftest.py` con fixture de DB PostgreSQL descartable (testcontainers o Docker)
- **Dependencias**: ninguna
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/08_arquitectura_propuesta.md` §Backend — patrón Repository / Service / Router
  - `knowledge-base/08_arquitectura_propuesta.md` §Variables de entorno
  - `knowledge-base/08_arquitectura_propuesta.md` §Estrategia de testing
  - `knowledge-base/09_decisiones_y_supuestos.md`

---

## FASE 2 — Modelos Core del Backend

### [C-02] `core-models-backend`
- **Estado**: `[x]` archivado 2026-06-20
- **Scope**:
  - Decisión Q-01: elegir `id` como UUID (recomendado para aislamiento multi-usuario y portabilidad) — documentar en el change
  - `app/models/base.py`: mixin con `id` (UUID, default uuid4), `created_at`, `updated_at` (auto), `deleted_at` (nullable, soft delete)
  - `app/models/usuario.py`: SQLModel `Usuario` con campos: email (unique), nombre, password_hash, telefono, avatar_url, nombre_negocio, tema_preferido (enum `CLARO`/`OSCURO`, default `CLARO`)
  - `app/models/proveedor.py`: SQLModel `Proveedor` con campos según KB; enum `CategoriProveedor` = `INSUMO`/`SERVICIO`/`OTRO`
  - `app/models/factura.py`: SQLModel `Factura` y `FacturaItem`; enum `OrigenDocumento` = `MANUAL`/`IA`; `monto_total` numeric(12,2); **sin columna `estado`**
  - `app/models/pago.py`: SQLModel `Pago`; enum `MetodoPago` = `EFECTIVO`/`TRANSFERENCIA`/`TARJETA`/`MERCADOPAGO`/`OTRO`; **sin `factura_id`**
  - **Nota (c-18 house-keeping)**: la promesa inicial de `app/core/unit_of_work.py` con `UnitOfWork` context manager fue **decidida no aplicar** durante el MVP. Los services usan `session.flush()` directamente y el `session.commit()` vive en el router. La razón: el patrón UoW añadía una capa de indirección sin resolver un problema concreto en el MVP (todas las mutaciones viven dentro de un único service method → la transacción es local). Se mantiene como decisión abierta en `knowledge-base/10_preguntas_abiertas.md`.
  - `app/repositories/base_repository.py`: genérico con métodos `get`, `list`, `create`, `update`, `soft_delete`
  - Migración Alembic `001_initial_schema.py`: crea tablas `usuario`, `proveedor`, `factura`, `factura_item`, `pago` con FKs e índices por `usuario_id`, `proveedor_id`, `deleted_at`
  - Tests unitarios: creación de instancias, invariantes de tipos y campos nullable
- **Dependencias**: `C-01`
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/04_modelo_de_datos.md` (completo)
  - `knowledge-base/05_reglas_de_negocio.md` §Dominio: Proveedores, §Dominio: Facturas, §Dominio: Pagos
  - `knowledge-base/10_preguntas_abiertas.md` §Q-01 (decisión UUID vs serial)

---

## FASE 3 — Autenticación

### [C-03] `auth-backend`
- **Estado**: `[x]` archivado 2026-06-21
- **Scope**:
  - Decisión Q-02: JWT puro con TTL corto + rotación de refresh token (documetar en change) vs tokens opacos — decidir antes de implementar
  - Decisión Q-03: estrategia proxy/rewrite o CORS — definir `COOKIE_DOMAIN` y flags de cookie
  - `app/core/security.py`: `hash_password(plain)` → argon2id; `verify_password(plain, hash)`; `create_access_token(sub, exp)`; `create_refresh_token(sub, exp)`; `decode_token(token)` → payload
  - Rate limiting en registro y login: middleware o decorator con ventana deslizante (5 intentos / 60 s por IP)
  - `app/repositories/usuario_repository.py`: `get_by_email(email)`, `create(data)`, `get_by_id(id)`
  - `app/services/usuario_service.py`: `registrar(email, nombre, password)` — valida email único, hashea, persiste; `login(email, password)` — verifica credenciales (mensaje genérico en error); `logout(token_id)` — invalida refresh
  - `app/routers/auth.py`: `POST /api/auth/registro`, `POST /api/auth/login` (setea cookies httpOnly Secure SameSite), `POST /api/auth/logout`, `POST /api/auth/refresh`
  - `app/routers/usuarios.py`: `GET /api/me` — devuelve perfil del usuario autenticado
  - Dependency `get_current_user` — extrae usuario desde cookie/header, valida token, devuelve `Usuario`
  - Tests de integración: registro exitoso, email duplicado, login OK/fail, logout invalida, refresh rota el token, acceso sin sesión → 401
- **Dependencias**: `C-02`
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/03_actores_y_roles.md` §Modelo de autorización
  - `knowledge-base/08_arquitectura_propuesta.md` §Baseline de seguridad
  - `knowledge-base/05_reglas_de_negocio.md` §Decisiones de negocio resueltas
  - `knowledge-base/10_preguntas_abiertas.md` §Q-02, §Q-03, §Q-04

---

## FASE 4 — Frontend de Autenticación y Perfil

### [C-04] `auth-frontend`
- **Estado**: `[x]` archivado 2026-06-21
- **Scope**:
  - `src/features/auth/`: páginas `RegisterPage.tsx`, `LoginPage.tsx`, guard `RequireAuth.tsx`
  - Formulario de registro: email, nombre, contraseña (mín 8 chars) — sin campos adicionales
  - Formulario de login: email + contraseña + checkbox "Recordarme"
  - Mensajes de error: único genérico en login ("Credenciales inválidas"); en registro: email en uso
  - Zustand store `src/features/auth/store/authStore.ts`: estado `user`, `isAuthenticated`; acciones `login`, `logout`
  - TanStack Query mutations: `useRegister`, `useLogin`, `useLogout`
  - Axios interceptor: adjunta credenciales (`withCredentials: true`), maneja 401 → redirect login
  - `src/app/router.tsx`: rutas públicas `/login` y `/registro`; rutas privadas bajo `RequireAuth`
  - Redirect post-login a inicio; post-logout a `/login`
  - PWA: página de login visible offline (shell cacheada)
  - Tests: Vitest + RTL + MSW — registro exitoso, email duplicado, login OK, login inválido, redirect en 401
- **Dependencias**: `C-03`
- **Governance**: CRITICO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` §Épica: Registro y Autenticación
  - `knowledge-base/07_flujos_principales.md` §Flujo 1: Registro y login
  - `knowledge-base/08_arquitectura_propuesta.md` §Frontend — feature-based
  - `knowledge-base/07_flujos_principales.md` §Flujo cross-origin de autenticación

### [C-05] `perfil-usuario`
- **Estado**: `[x]` archivado 2026-06-25
- **Scope**:
  - Backend: `PATCH /api/me` — actualiza teléfono, nombre_negocio, tema_preferido; valida campos opcionales
  - Backend: `POST /api/me/avatar` — recibe URL de Cloudinary (el frontend sube directo al preset firmado), valida URL, actualiza `avatar_url`
  - Backend: `GET /api/cloudinary/preset-firmado` — genera firma para upload preset de Cloudinary (tipo `avatar`); valida `content-type` (PDF/jpg/png, máx 10 MB)
  - `app/services/usuario_service.py`: `actualizar_perfil(usuario_id, datos)`, `actualizar_avatar(usuario_id, url)`
  - Frontend: `src/features/perfil/`: `PerfilPage.tsx` con formulario editable (teléfono, nombre_negocio), switch tema claro/oscuro
  - Toggle de tema conectado a Zustand + `document.documentElement.classList` + persistencia en PATCH; NO usar `localStorage`
  - Upload de avatar: componente que obtiene preset firmado del backend, sube a Cloudinary, llama a `POST /api/me/avatar` con la URL
  - Tests: actualización de perfil persiste en DB, switch de tema visible en recarga, avatar URL validada
- **Dependencias**: `C-04`
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` §Épica: Perfil de usuario
  - `knowledge-base/04_modelo_de_datos.md` §Usuario
  - `knowledge-base/08_arquitectura_propuesta.md` §Subida de archivos (Cloudinary)

---

## FASE 5 — Proveedores

### [C-06] `proveedores-backend`
- **Estado**: `[x]` archivado 2026-06-21
- **Scope**:
  - `app/repositories/proveedor_repository.py`: `list_by_usuario(usuario_id, page, order_by)` — query con `GROUP BY` para saldo calculado (un solo SQL, no N+1); `get(id)`, `create(data)`, `update(id, data)`, `soft_delete(id)`
  - `app/services/proveedor_service.py`: `listar(usuario_id, ...)` — filtra `deleted_at IS NULL` + calcula saldo agregado; `crear(usuario_id, datos)`; `actualizar(usuario_id, proveedor_id, datos)` — valida pertenencia (404 si ajeno); `eliminar(usuario_id, proveedor_id)` — soft delete, retorna `tiene_dependencias=True/False` para que el router decida; `buscar_por_nombre(usuario_id, nombre)` para vinculación RN-VINC
  - Validación CUIT: regex `^\d{2}-\d{8}-\d{1}$` en servicio/schema
  - `app/routers/proveedores.py`: `GET /api/proveedores?page&order_by=nombre|saldo`, `POST /api/proveedores`, `GET /api/proveedores/{id}`, `PATCH /api/proveedores/{id}`, `DELETE /api/proveedores/{id}`; `GET /api/proveedores/buscar?nombre=` (para vinculación VINC)
  - `app/schemas/proveedor.py`: `ProveedorCreate`, `ProveedorUpdate`, `ProveedorResponse` (incluye `saldo: Decimal`), `ProveedorListItem`
  - Migración Alembic: índice compuesto `(usuario_id, nombre)` para búsqueda normalizada (collation o LOWER())
  - Tests: CRUD completo, soft delete preserva FK, listado por saldo correcto con datos mixtos, aislamiento (otro usuario no ve el recurso → 404), CUIT validación
- **Dependencias**: `C-02`
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/05_reglas_de_negocio.md` §Dominio: Proveedores
  - `knowledge-base/04_modelo_de_datos.md` §Proveedor, §Cálculos derivados
  - `knowledge-base/07_flujos_principales.md` §Flujo 6: Listado de proveedores ordenado por saldo
  - `knowledge-base/10_preguntas_abiertas.md` §Performance del listado de proveedores

### [C-07] `proveedores-frontend`
- **Estado**: `[x]` archivado 2026-06-21
- **Scope**:
  - `src/features/proveedores/`: `ProveedoresPage.tsx` (listado paginado), `ProveedorFormPage.tsx` (crear/editar), `ProveedorCard.tsx`
  - Listado con paginación y orden por nombre / saldo (toggle de columna)
  - Saldo con signo de color: deuda (rojo), al día (verde), a favor (azul)
  - Formulario de creación/edición: nombre (requerido), cuit (opcional, validado), teléfono, categoria (select), notas
  - Eliminar con modal de confirmación cuando `tiene_dependencias=true` (respeta RN-PROV-04); soft delete invisible al usuario
  - `src/shared/components/ProveedorAutocomplete.tsx` — componente reutilizable de búsqueda/selección de proveedor (usado en formularios de factura y pago, y flujo IA); implementa RN-VINC: normaliza nombre, muestra sugerencias, "Buscar proveedor", "Crear nuevo proveedor"
  - TanStack Query: `useProveedores(page, orderBy)`, `useProveedor(id)`, `useCreateProveedor`, `useUpdateProveedor`, `useDeleteProveedor`
  - `src/shared/api/proveedores.ts` — funciones Axios tipadas con tipos generados de OpenAPI
  - Tests: listado renderiza con saldo, modal de confirmación aparece cuando hay dependencias, autocomplete filtra por nombre
- **Dependencias**: `C-04`, `C-06`
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` §Épica: Proveedores
  - `knowledge-base/05_reglas_de_negocio.md` §RN-VINC, §Dominio: Proveedores
  - `knowledge-base/07_flujos_principales.md` §Flujo 6: Listado de proveedores ordenado por saldo

---

## FASE 6 — Facturas

### [C-08] `facturas-backend`
- **Estado**: `[x]` archivado 2026-06-21
- **Scope**:
  - `app/repositories/factura_repository.py`: `list_by_usuario(usuario_id, proveedor_id?, page)`, `get(id)`, `create(data, items)` con UnitOfWork, `update(id, data, items)`, `soft_delete(id)`
  - `app/services/factura_service.py`: `listar(usuario_id, proveedor_id?, estado_filtro?, fecha_desde?, fecha_hasta?)` — calcula estado FIFO por proveedor en memoria DESPUÉS de traer las facturas (RN-FAC-09: no filtrar por estado en SQL); `crear(usuario_id, datos)` — valida `Factura.usuario_id == Proveedor.usuario_id`, fecha no futura UTC-3, `monto_total > 0`; `actualizar(...)`, `eliminar(...)`
  - Algoritmo FIFO en service: ordenar facturas del proveedor por `(fecha_emision ASC, created_at ASC, id ASC)`, sumar pool de pagos activos, asignar virtualmente → estado PENDIENTE/PARCIAL/PAGADA (RN-FIFO)
  - `app/routers/facturas.py`: `GET /api/facturas?proveedor_id&page&estado&fecha_desde&fecha_hasta`, `POST /api/facturas`, `GET /api/facturas/{id}`, `PATCH /api/facturas/{id}`, `DELETE /api/facturas/{id}`
  - `app/schemas/factura.py`: `FacturaCreate` (con lista `items` opcional), `FacturaUpdate`, `FacturaResponse` (incluye `estado: EstadoFactura`, `items: list[FacturaItemResponse]`), `FacturaListItem` (con `estado`)
  - `GET /api/cloudinary/preset-firmado?tipo=factura` — extiende el endpoint existente para tipo `factura`
  - Migración Alembic `002_factura_indices.py`: índice `(usuario_id, proveedor_id, deleted_at, fecha_emision)` para queries de estado FIFO
  - Tests: CRUD, estado FIFO correcto con múltiples pagos y facturas, desempate determinista por created_at, filtro por estado post-cálculo (no SQL), aislamiento usuario, advertencia items ≠ monto_total no bloquea guardado
- **Dependencias**: `C-06`
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/05_reglas_de_negocio.md` §Dominio: Facturas, §RN-FIFO, §RN-SALDO
  - `knowledge-base/04_modelo_de_datos.md` §Factura, §FacturaItem, §Cálculos derivados
  - `knowledge-base/07_flujos_principales.md` §Flujo 2: Carga manual de factura
  - `knowledge-base/10_preguntas_abiertas.md` §Filtro por estado en SQL (vigilar N+1 y WHERE estado)

### [C-09] `facturas-frontend`
- **Estado**: `[x]` archivado 2026-06-25
- **Scope**:
  - `src/features/facturas/`: `FacturasPage.tsx` (listado filtrable), `FacturaFormPage.tsx` (crear/editar), `FacturaCard.tsx`
  - Listado con filtros: por proveedor (usa `ProveedorAutocomplete`), estado (PENDIENTE/PARCIAL/PAGADA), rango de fechas; filtro de estado recibe el campo computado del response (no filtro SQL)
  - Badge de estado con color: PENDIENTE (naranja), PARCIAL (amarillo), PAGADA (verde)
  - Formulario: proveedor (requerido, usa `ProveedorAutocomplete`), fecha_emisión (no futura), monto_total (>0), número (opcional), fecha_vencimiento (opcional), items dinámicos (agregar/quitar filas), upload de archivo PDF/jpg/png
  - Advertencia en UI si suma de items ≠ monto_total (no bloqueante, permite guardar)
  - Upload de archivo: obtiene preset firmado del backend (tipo=factura), sube a Cloudinary, almacena URL
  - TanStack Query: `useFacturas(filters)`, `useFactura(id)`, `useCreateFactura`, `useUpdateFactura`, `useDeleteFactura`
  - Acceso rápido desde la pantalla de inicio: botón "Cargar factura"
  - Tests: listado con badges de estado, advertencia items, upload flujo completo (MSW), filtros aplican
- **Dependencias**: `C-07`, `C-08`
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` §Épica: Facturas
  - `knowledge-base/07_flujos_principales.md` §Flujo 2: Carga manual de factura
  - `knowledge-base/05_reglas_de_negocio.md` §Dominio: Facturas (RN-FAC-04, RN-FAC-09)
  - `knowledge-base/08_arquitectura_propuesta.md` §Subida de archivos (Cloudinary)

---

## FASE 7 — Pagos

### [C-10] `pagos-backend`
- **Estado**: `[x]` archivado 2026-06-27
- **Scope**:
  - `app/repositories/pago_repository.py`: `list_by_usuario(usuario_id, proveedor_id?, page)`, `get(id)`, `create(data)`, `update(id, data)`, `soft_delete(id)`
  - `app/services/pago_service.py`: `crear(usuario_id, datos)` — valida `Pago.usuario_id == Proveedor.usuario_id`, `monto > 0`, fecha no futura UTC-3, **sin `factura_id`** (RN-PAG-01); `actualizar(...)`, `eliminar(...)` — el saldo y estado FIFO se recalculan on-demand en la próxima consulta (no hay acción adicional)
  - `app/routers/pagos.py`: `GET /api/pagos?proveedor_id&page`, `POST /api/pagos`, `GET /api/pagos/{id}`, `PATCH /api/pagos/{id}`, `DELETE /api/pagos/{id}`
  - `app/schemas/pago.py`: `PagoCreate`, `PagoUpdate`, `PagoResponse`, `PagoListItem`
  - `GET /api/cloudinary/preset-firmado?tipo=comprobante` — extiende para tipo `comprobante`
  - Tests: CRUD, intento de incluir `factura_id` rechazado por schema, monto=0 rechazado, fecha futura rechazada, aislamiento usuario, soft delete no afecta estados FIFO (calculados on-demand)
- **Dependencias**: `C-06`
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/05_reglas_de_negocio.md` §Dominio: Pagos
  - `knowledge-base/04_modelo_de_datos.md` §Pago
  - `knowledge-base/07_flujos_principales.md` §Flujo 3: Carga manual de pago
  - `knowledge-base/05_reglas_de_negocio.md` §RN-SALDO (impacto de agregar pago)

### [C-11] `pagos-frontend`
- **Estado**: `[x]` archivado 2026-06-27
- **Scope**:
  - `src/features/pagos/`: `PagosPage.tsx` (listado filtrable por proveedor), `PagoFormPage.tsx` (crear/editar), `PagoCard.tsx`
  - Formulario: proveedor (requerido, `ProveedorAutocomplete`), monto (>0), fecha (no futura), método (select: EFECTIVO/TRANSFERENCIA/TARJETA/MERCADOPAGO/OTRO), upload de comprobante (PDF/jpg/png)
  - Nota explícita en UI: "El pago se asocia al proveedor, no a una factura específica" — refuerza RN-PAG-01
  - Método de pago con iconos/badges visuales
  - Upload comprobante: mismo patrón que archivos en facturas (preset firmado tipo=comprobante)
  - TanStack Query: `usePagos(proveedor_id)`, `usePago(id)`, `useCreatePago`, `useUpdatePago`, `useDeletePago`
  - Acceso rápido desde inicio: botón "Cargar pago"
  - Tests: formulario sin campo factura, upload comprobante, método obligatorio validado
- **Dependencias**: `C-09`, `C-10`
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` §Épica: Pagos
  - `knowledge-base/07_flujos_principales.md` §Flujo 3: Carga manual de pago
  - `knowledge-base/05_reglas_de_negocio.md` §Dominio: Pagos (RN-PAG-01, sin factura_id)

---

## FASE 8 — Cuenta Corriente

### [C-12] `cuenta-corriente-backend`
- **Estado**: `[x]` archivado 2026-06-27
- **Scope**:
  - `app/services/proveedor_service.py` (extensión): `get_cuenta_corriente(usuario_id, proveedor_id)` → retorna `{ saldo, facturas_con_estado: list[FacturaConEstado], historial: list[EntradaHistorial] }`
  - Cálculo de saldo: `SUM(facturas activas.monto_total) − SUM(pagos activos.monto)` por proveedor (RN-SALDO); signo: deuda / al día / a favor
  - Estado FIFO de cada factura: algoritmo completo RN-FIFO en memoria (facturas ordenadas por fecha_emision ASC, created_at ASC, id ASC; pool = sum pagos activos; aplicar mínimo iterativamente)
  - Historial cronológico RN-HIST: lista unificada de facturas (debe) y pagos (haber) del proveedor, ordenada por fecha, con saldo acumulado calculado fila a fila
  - `app/routers/proveedores.py` (extensión): `GET /api/proveedores/{id}/cuenta-corriente` — devuelve `CuentaCorrienteResponse`
  - `app/schemas/cuenta_corriente.py`: `CuentaCorrienteResponse`, `FacturaConEstado` (incluye `estado: EstadoFactura`), `EntradaHistorial` (tipo: `FACTURA`/`PAGO`, monto, fecha, saldo_acumulado)
  - Tests: saldo correcto con facturas y pagos variados, FIFO asigna en orden determinista, FIFO con pool parcial (PARCIAL), FIFO con pool excedido (saldo a favor), historial con saldo acumulado fila a fila, aislamiento multi-usuario
- **Dependencias**: `C-10`
- **Governance**: ALTO
- **Leer antes**:
  - `knowledge-base/05_reglas_de_negocio.md` §RN-SALDO, §RN-FIFO (completo con sub-reglas), §RN-HIST
  - `knowledge-base/04_modelo_de_datos.md` §Cálculos derivados
  - `knowledge-base/07_flujos_principales.md` §Flujo 5: Consulta de cuenta corriente

### [C-13] `cuenta-corriente-frontend`
- **Estado**: `[x]` archivado 2026-06-27
- **Scope**:
  - `src/features/cuenta-corriente/`: `CuentaCorrientePage.tsx` (vista completa por proveedor), `SaldoBadge.tsx`, `TablaFacturasConEstado.tsx`, `HistorialCronologico.tsx`
  - Vista de proveedor: encabezado con nombre y saldo (con signo visual: rojo=deuda, verde=al día, azul=a favor)
  - Lista de facturas con estado calculado (PENDIENTE/PARCIAL/PAGADA) con badge de color
  - Historial cronológico: tabla debe/haber con saldo acumulado por fila; distingue visualmente facturas (debe) de pagos (haber)
  - Filtros básicos en listado de facturas (por estado, por rango de fechas) — usa campos del response, no filtro SQL
  - `src/features/proveedores/ProveedorDetailPage.tsx`: página que integra saldo + listado facturas + historial + acciones (cargar factura/pago para ese proveedor)
  - TanStack Query: `useCuentaCorriente(proveedorId)` — invalida automáticamente al crear/editar/eliminar facturas o pagos del mismo proveedor
  - Tests: saldo con signo visual correcto, facturas con estado, historial con saldo acumulado, invalidación de cache tras mutación
- **Dependencias**: `C-11`, `C-12`
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` §Épica: Cuenta corriente
  - `knowledge-base/07_flujos_principales.md` §Flujo 5: Consulta de cuenta corriente
  - `knowledge-base/05_reglas_de_negocio.md` §RN-SALDO, §RN-FIFO, §RN-HIST

---

## FASE 9 — IA de Visión (se implementa al final, sobre flujo manual funcionando)

> **Importante**: estos changes se implementan DESPUÉS de que el flujo manual completo esté funcionando y verificado (C-13 archivado). La IA se agrega encima de la infraestructura existente, sin modificar el flujo manual.

### [C-14] `ia-vision-backend`
- **Estado**: `[x]` archivado 2026-06-27
- **Scope**:
  - `app/services/ia_extraccion_service.py`: interfaz `VisionExtractor` con `extraer_factura(imagen_bytes) -> PropuestaFactura` y `extraer_pago(imagen_bytes) -> PropuestaPago`
  - `PropuestaFactura`: pydantic con `proveedor_nombre: str | None`, `numero: str | None`, `fecha_emision: date | None`, `monto_total: Decimal | None` — campo ausente → `None`, **nunca inventado** (RN-IA-03)
  - `PropuestaPago`: pydantic con `proveedor_nombre: str | None`, `monto: Decimal | None`, `fecha: date | None`, `metodo: MetodoPago | None`
  - `ClaudeVisionExtractor` (implementación): llama a Anthropic API (vision), prompt compartido con schema JSON estricto, parsea y valida respuesta Pydantic; campo no legible → `None`
  - `OpenAIVisionExtractor`: misma interfaz, adaptador para OpenAI vision
  - Factory `get_vision_extractor()` → instancia según `VISION_PROVIDER` env var
  - Rate limiting en endpoints de IA (más estricto: 10 req/hora por usuario)
  - `app/routers/facturas.py` extensión: `POST /api/facturas/extraer-ia` — recibe imagen (multipart), llama al extractor, devuelve `PropuestaFactura`; **nunca persiste** (RN-IA-04)
  - `app/routers/pagos.py` extensión: `POST /api/pagos/extraer-ia` — recibe imagen, devuelve `PropuestaPago`
  - Si extracción falla → devuelve `PropuestaFactura` con todos los campos `None` + flag `error: true` + mensaje (RN-IA-05)
  - Tests: extractor mockeado, campo faltante → None, fallo extractor → respuesta graceful, rate limit, no persistencia tras llamada a IA
- **Dependencias**: `C-12`
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/05_reglas_de_negocio.md` §Dominio: Extracción por IA (completo: RN-IA-01 a RN-IA-06, RN-VINC)
  - `knowledge-base/08_arquitectura_propuesta.md` §Abstracción de IA de visión
  - `knowledge-base/07_flujos_principales.md` §Flujo 4: Carga asistida por IA
  - `knowledge-base/10_preguntas_abiertas.md` §PDF vs imagen en IA

### [C-15] `ia-vision-frontend`
- **Estado**: `[x]` archivado 2026-06-29
- **Scope**:
  - `src/features/facturas/FacturaIAPage.tsx`: flujo en 3 pasos — (1) upload imagen, (2) mostrar propuesta editable con proveedor a confirmar, (3) formulario completo editable → confirmar → `POST /api/facturas`
  - `src/features/pagos/PagoIAPage.tsx`: mismo patrón para pagos
  - Paso 1: selector de imagen (solo imágenes, no PDF — RN-IA-01); spinner durante extracción
  - Paso 2: propuesta prellenada con `ProveedorAutocomplete` (sugerencias por nombre detectado, RN-VINC); campos editables; si campo = null → campo vacío en formulario (nunca inventado)
  - Si falla extracción: aviso "No se pudo leer la imagen" + formulario vacío + permite carga manual (RN-IA-05); la carga manual sigue disponible sin bloqueo
  - La IA NUNCA pre-selecciona proveedor automáticamente (RN-IA-06): siempre requiere confirmación del usuario
  - Nada se persiste hasta "Confirmar" — la mutación final usa el mismo endpoint que carga manual (RN-IA-04)
  - Botones de entrada en facturas y pagos: "Cargar con imagen (IA)" junto a "Carga manual"
  - Tests: flujo exitoso (MSW), extracción fallida → formulario vacío, proveedor no pre-asignado, nada persiste hasta confirmar
- **Dependencias**: `C-13`, `C-14`
- **Governance**: MEDIO
- **Leer antes**:
  - `knowledge-base/06_funcionalidades.md` §Épica: Facturas F-FAC-04, §Épica: Pagos F-PAG-03
  - `knowledge-base/07_flujos_principales.md` §Flujo 4: Carga asistida por IA
  - `knowledge-base/05_reglas_de_negocio.md` §Dominio: Extracción por IA, §RN-VINC

---

## Housekeeping post-MVP

> **Importante**: estos changes se implementan DESPUÉS de que el MVP esté archivado (C-13 ✓). Son housekeeping post-entrega: fixes mecánicos, refactors, drift de docs. No introducen funcionalidades nuevas, ni cambios de reglas de negocio, ni migraciones de DB.

### [C-15a] `origen-ia-backend`
- **Estado**: `[x]` archivado 2026-06-27
- **Scope**:
  - `app/schemas/pago.py`: `PagoCreate.origen: Optional[OrigenDocumento] = None` — acepta el origen opcional del payload (c-15 IA flow). Por defecto MANUAL, preserva compatibilidad con c-11.
  - `app/services/pago_service.py`: el `crear` propaga el `origen` recibido en el payload al `Pago.origen` persistido. Si no se provee, el servicio sigue estampando `MANUAL` (backward compat).
  - Sin cambio de router (la ruta POST /api/pagos ya aceptaba el `PagoCreate`; el campo nuevo es backward-compatible porque es Optional).
  - Tests: `PagoCreate(origen='IA')` → `Pago.origen == OrigenDocumento.IA`; sin `origen` → `Pago.origen == OrigenDocumento.MANUAL`.
- **Dependencias**: `C-10` (el modelo Pago ya tiene la columna)
- **Governance**: BAJO
- **Leer antes**:
  - `knowledge-base/05_reglas_de_negocio.md` §RN-PAG-04
  - `openspec/changes/c-15a-origen-ia-backend/specs/pagos-backend/spec.md`

### [C-16] `fix-suite`
- **Estado**: `[x]` archivado 2026-06-28
- **Scope**:
  - Suite de fixes mecánicos post-MVP: correcciones de spec headers, ajuste de un par de invariantes rotas por regresiones en cambios anteriores, y small refactors sin cambio de comportamiento.
  - ~20 archivos tocados; el grueso son tests de regression-guard que fail en el código unfixed y pasan en el fixed code (TDD).
  - Tests: 22 nuevos regression-guard tests en backend + frontend.
- **Dependencias**: `C-13` (corre sobre el MVP completo)
- **Governance**: MEDIO
- **Leer antes**:
  - `openspec/changes/c-16-fix-suite/known-debt.md` (deferred items)
  - `knowledge-base/05_reglas_de_negocio.md` (regression-guard contra las RN-*)

### [C-17] `fix-test-pollution`
- **Estado**: `[x]` archivado 2026-06-29
- **Scope**:
  - Fixes de test pollution entre tests que compartían estado global (settings cache, orden de imports, fixtures module-scoped con side effects).
  - Desactivación del `cache_clear()` hack en `app/core/config.py` — `get_settings()` ahora es un read-through proxy que lee las env vars cada vez.
  - Protected test baseline: 22 tests en `test_alembic_migration_0003.py`, `test_config.py`, `test_deps.py` que deben seguir pasando tras cada housekeeping.
- **Dependencias**: `C-13`
- **Governance**: MEDIO
- **Leer antes**:
  - `openspec/changes/c-17-fix-test-pollution/known-debt.md`
  - `app/core/config.py` (read-through proxy pattern)

### [C-18] `housekeeping-fixes`
- **Estado**: `[ ]` en curso (este change)
- **Scope**:
  - 11 fixes mecánicos post-MVP: 4 críticos (FE-001 SPA navigation, FE-002 PWA icons, FE-003 IA button disabled-while-pending, FE-004 HomePage Link), 2 altos (FE-005 proveedor_nombre en PagoResponse, FE-008 delete confirmation before mutation), 4 medios (FE-006 inline type imports, FE-007 formatSaldo dedup, MED-001 __import__ cleanup, MED-004 deterministic ordering), 1 doc (META-001).
  - Sin cambios de reglas de negocio, sin migraciones de DB, sin nuevos endpoints (FE-005 es additive: nuevo campo opcional en `PagoResponse`).
  - Tests: 6 nuevos tests de regression-guard (2 backend + 4 frontend) + 6 triangulaciones.
- **Dependencias**: `C-13`
- **Governance**: BAJO
- **Leer antes**:
  - `openspec/changes/c-18-housekeeping-fixes/proposal.md`
  - `openspec/changes/c-18-housekeeping-fixes/design.md` (decisiones D-1 a D-5)
  - `openspec/changes/c-18-housekeeping-fixes/known-debt.md` (MED-002/003/005, META-002/003/004 deferred)

---

## Resumen

| Change | Nombre | Governance | Depende de |
|--------|--------|------------|------------|
| C-01 | foundation-setup | BAJO | — |
| C-02 | core-models-backend | CRITICO | C-01 |
| C-03 | auth-backend | CRITICO | C-02 |
| C-04 | auth-frontend | CRITICO | C-03 |
| C-05 | perfil-usuario | MEDIO | C-04 |
| C-06 | proveedores-backend | MEDIO | C-02 |
| C-07 | proveedores-frontend | BAJO | C-04, C-06 |
| C-08 | facturas-backend | ALTO | C-06 |
| C-09 | facturas-frontend | MEDIO | C-07, C-08 |
| C-10 | pagos-backend | ALTO | C-06 |
| C-11 | pagos-frontend | MEDIO | C-09, C-10 |
| C-12 | cuenta-corriente-backend | ALTO | C-10 |
| C-13 | cuenta-corriente-frontend | MEDIO | C-11, C-12 |
| C-14 | ia-vision-backend | MEDIO | C-12 |
| C-15 | ia-vision-frontend | MEDIO | C-13, C-14 |
| C-15a | origen-ia-backend | BAJO | C-10 (housekeeping post-MVP) |
| C-16 | fix-suite | MEDIO | C-13 (housekeeping post-MVP) |
| C-17 | fix-test-pollution | MEDIO | C-13 (housekeeping post-MVP) |
| C-18 | housekeeping-fixes | BAJO | C-13 (housekeeping post-MVP, en curso) |

**Total: 18 changes · 9 fases + housekeeping post-MVP · 12 gates de paralelismo**

**Estado del MVP**: el MVP está completo y archivado (C-13 ✓ 2026-06-27). Los 4 changes de housekeeping post-MVP (C-15a, C-16, C-17, C-18) son fixes mecánicos, refactors y drift de docs; no introducen funcionalidades nuevas.

**Para el siguiente change**: si quedan items del `known-debt.md` de C-18 (MED-002/003/005, META-002/003/004, LOW-*, FE-009+, META-005+), se puede proponer un C-19 housekeeping-fixes-2. Si se va a una funcionalidad nueva, abrir el backlog del orquestador.
