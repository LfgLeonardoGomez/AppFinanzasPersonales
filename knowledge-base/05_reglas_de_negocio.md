# 05 · Reglas de Negocio

> Fuente: `docs/00-vision-general.md` §4, `docs/01-mvp-especificacion-funcional.md`, `docs/02-modelo-datos.md`.
> Cada regla tiene un código `RN-XX` para referencia desde specs, tasks y tests.

## Dominio: Proveedores

| Código | Regla |
|---|---|
| **RN-PROV-01** | El `nombre` del proveedor **no es único**: puede haber dos parecidos. |
| **RN-PROV-02** | Si se carga `cuit`, validar formato `XX-XXXXXXXX-X`. |
| **RN-PROV-03** | Eliminar es **soft delete** (`deleted_at`); la UI lo muestra como eliminación normal. |
| **RN-PROV-04** | Si el proveedor tiene facturas o pagos asociados, eliminar requiere **confirmación explícita** (modal). No se bloquea, solo se confirma. |
| **RN-PROV-05** | El listado es paginado y ordenable por nombre o por **saldo actual** (agregado calculado, no columna). |

## Dominio: Facturas

| Código | Regla |
|---|---|
| **RN-FAC-01** | `monto_total` > 0, en ARS. Es la **fuente de verdad** del monto. |
| **RN-FAC-02** | `fecha_emision` obligatoria y **no futura** (zona UTC-3). |
| **RN-FAC-03** | `numero` **no es único**. |
| **RN-FAC-04** | Los `items` son opcionales e informativos. Si su suma ≠ `monto_total`, se muestra **advertencia** pero se permite guardar igual. |
| **RN-FAC-05** | Editar: todos los campos editables en cualquier momento. |
| **RN-FAC-06** | Eliminar: soft delete. Como los pagos no se vinculan a facturas, borrar una factura **no afecta ningún pago**; solo cambia saldo y estados derivados del proveedor. |
| **RN-FAC-07** | `archivo_url`: **un solo** archivo (PDF/jpg/png) en Cloudinary. |
| **RN-FAC-08** | `origen` (`MANUAL`/`IA`) se setea en el POST de creación: el service persiste `datos.origen or MANUAL`. D-18 (Path B): C-15 envía `'IA'` desde el cliente tras confirmar el modal de IA. `origen` es **inmutable post-create** (`FacturaUpdate`/`PagoUpdate` no lo exponen). |
| **RN-FAC-09** | El filtro de listado **por estado** se aplica **después** de calcular el estado en el service layer (no es columna, no se filtra con `WHERE estado=...`). |

## Dominio: Pagos

| Código | Regla |
|---|---|
| **RN-PAG-01** | Un pago se asocia **a un proveedor, nunca a una factura puntual**. No existe `factura_id`. Reforzado en backend por `PagoCreate.model_config = ConfigDict(extra="forbid")` — rechaza cualquier `factura_id`/`usuario_id`/`id`/`proveedor_id` que el cliente envíe por error o con intención de smuggling. |
| **RN-PAG-02** | `monto` > 0, en ARS. |
| **RN-PAG-03** | `fecha` obligatoria, no futura (UTC-3). Es **informativa**: no afecta la asignación FIFO. |
| **RN-PAG-04** | `metodo` obligatorio (enum acotado). |
| **RN-PAG-05** | Editar/eliminar: libre (soft delete). Cualquier cambio recalcula automáticamente saldo y estados, porque nada de eso se persiste. |
| **RN-PAG-06** | `origen` se persiste tal cual el cliente lo envía en el POST de creación, con fallback a `MANUAL` cuando se omite. D-18 (Path B): C-15 envía `'IA'` desde el cliente tras confirmar el modal de IA. |

## Dominio: Autenticación y sesión

| Código | Regla |
|---|---|
| **RN-AUTH-01** | Access token = **JWT stateless** (HS256, `sub` = `usuario_id`, `type=access`, `exp`, `iat`). Validación sin tocar la DB. |
| **RN-AUTH-02** | Refresh token = valor **opaco** de alta entropía. En la tabla `refresh_token` se persiste **solo su hash SHA-256** (`token_hash`, único e indexado), nunca el valor crudo. |
| **RN-AUTH-03** | Refresh válido ⟺ `revoked_at IS NULL AND expires_at > now()`. |
| **RN-AUTH-04** | **Rotación obligatoria**: cada `POST /api/auth/refresh` exitoso emite un par nuevo y revoca (`revoked_at = now()`) el refresh usado. Un refresh ya rotado NO vuelve a ser válido. |
| **RN-AUTH-05** | Logout (`POST /api/auth/logout`) revoca el refresh de la sesión y borra las cookies (`max_age=0`). El refresh revocado NO puede renovar. |
| **RN-AUTH-06** | Rate limiting en `POST /api/auth/login` y `POST /api/auth/registro`: **5 intentos por 60 segundos por IP**, ventana deslizante. El 6° responde 429. |
| **RN-AUTH-07** | Las contraseñas se hashean con **argon2id** vía `passlib`. Mín 8 chars. La contraseña en claro NUNCA se persiste, se loguea ni es recuperable del hash. |
| **RN-AUTH-08** | Aislamiento multi-usuario: `get_current_user` extrae el `usuario_id` del access token; el service layer es la única capa donde se filtra por `usuario_id`. Recurso ajeno → **404** (no 403). |

## Dominio: Cuenta corriente (núcleo del sistema)

### RN-SALDO · Saldo actual del proveedor
```
saldo = SUM(Factura.monto_total)  WHERE proveedor_id=X AND deleted_at IS NULL
      − SUM(Pago.monto)           WHERE proveedor_id=X AND deleted_at IS NULL
```
Convención de signo:
- `saldo > 0` → **deuda** (le debés al proveedor).
- `saldo = 0` → **al día**.
- `saldo < 0` → **saldo a favor** (crédito tuyo).

### RN-FIFO · Estado de cada factura (derivado, no almacenado)
Los pagos NO se asignan a facturas en la base. Para mostrar el estado se asignan **virtualmente, de la factura más vieja a la más nueva**:
```
facturas = activas del proveedor, ordenadas por (fecha_emision ASC, created_at ASC, id ASC)
pool = SUM(monto de pagos activos del proveedor)   # todos, sin importar su fecha
para cada factura en facturas:
    aplicado = min(pool, factura.monto_total)
    pool = pool − aplicado
    aplicado == 0                 → PENDIENTE
    0 < aplicado < monto_total    → PARCIAL
    aplicado >= monto_total       → PAGADA
si al terminar pool > 0           → ese remanente es el saldo a favor
```
Reglas que el implementador **DEBE** respetar:
- **RN-FIFO-01:** El desempate `(created_at, id)` hace el orden **determinista** ante igual `fecha_emision`.
- **RN-FIFO-02:** Los pagos se asignan **por monto total del pool, no por fecha**. La fecha del pago es informativa.
- **RN-FIFO-03:** Es **esperado** que agregar/editar/borrar una factura o pago cambie el estado de **varias** facturas a la vez (el pool se reasigna). Por eso el estado nunca se guarda.

### RN-HIST · Historial cronológico (cuenta corriente)
Lista combinada de facturas (como "debe") y pagos (como "haber") del proveedor, ordenada por fecha, con saldo acumulado por fila:
```
saldo_acumulado(fila) = SUM(facturas hasta esa fila) − SUM(pagos hasta esa fila)
```
Es una vista **distinta** del estado FIFO (RN-FIFO): muestra la evolución de la deuda en el tiempo. Ambas se calculan al renderizar.

## Dominio: Extracción por IA

| Código | Regla |
|---|---|
| **RN-IA-01** | La extracción corre sobre **imágenes** (JPEG/PNG/WebP) en el MVP. PDF se guarda pero se carga a mano. Validación por **magic bytes**, NO por `Content-Type` del header. Límite: 10 MB. |
| **RN-IA-02** | La IA devuelve una **propuesta** JSON solo de **cabecera**: factura → proveedor/número/fecha/monto_total; pago → proveedor/monto/fecha/método. **Los items NO se extraen por IA.** |
| **RN-IA-03** | Si la IA no puede leer un campo, lo deja **vacío/`null` — nunca inventa**. Si el valor de `metodo` no está en el enum, se normaliza a `None` (no se preserva). |
| **RN-IA-04** | **El endpoint de extracción nunca persiste nada.** `POST /api/facturas/extraer-ia` y `POST /api/pagos/extraer-ia` solo devuelven la propuesta (cabecera) — este invariante de backend es intocable. (C-21, D-26): **dónde** ocurre la confirmación humana cambió — el `PropuestaIAModal` pasa a ser **terminal**: su botón "Confirmar" sube la imagen a Cloudinary, arma el payload y dispara `POST /api/facturas`/`POST /api/pagos` con `origen: 'IA'` directamente desde el modal. El form manual grande (`FacturaForm`/`PagoForm`) **ya no se renderiza** en el flujo IA — esto **supersede** la redacción anterior de esta regla (C-15: "la persistencia ocurre en el form, no en el modal"). Verificado por test de regresión: en el flujo IA la mutación `useCreateFactura`/`useCreatePago` se dispara **exactamente una vez**, desde el "Confirmar" del modal. |
| **RN-IA-05** | Si la extracción falla, la respuesta es 200 con `error: true` + `error_message` (la UI nunca ve un 500 del extractor). El modal muestra "No se pudo leer la imagen" y permite cargar manualmente. |
| **RN-IA-06** | **La IA (el modelo de visión) nunca crea ni asigna un proveedor por su cuenta** — solo propone `proveedor_nombre` como texto. (C-21, D-26): el **frontend** intenta un auto-match contra los proveedores activos del usuario usando la normalización de RN-VINC (coincidencia exacta normalizada y única); si matchea, **pre-selecciona** el proveedor en el modal pero el control queda editable/reemplazable por el usuario. Si no hay match o es parcial/múltiple, el modal ofrece una acción inline **"Crear «X»"** (nombre editable, vía `useCreateProveedor`) que crea el proveedor sin salir del modal ni navegar. La factura/pago no se crea hasta que hay un `proveedor_id` resuelto (auto-matcheado, elegido o creado inline) y el usuario confirma. |
| **RN-IA-07** | Rate limit por **`usuario_id`** (no por IP) en `POST /api/facturas/extraer-ia` y `POST /api/pagos/extraer-ia`, ventana deslizante. (C-21, D-26): **configurable por env** — `IA_RATE_MAX_REQUESTS` (default **60**) / `IA_RATE_WINDOW_SECONDS` (default **3600**s = 1 hora), leídos en vivo vía el proxy de `settings` (C-16) — reemplaza el límite fijo de 10 requests/hora de C-14. El (max+1)-ésimo request dentro de la ventana responde 429 con header `Retry-After` (segundos hasta que la request más vieja salga de la ventana). El modal muestra countdown y NO auto-retry. |
| **RN-IA-08** | El modal de IA es **bloqueante** sobre el form (D-19): el submit del form queda detrás del overlay. El "Cargar con imagen (IA)" está **oculto en edit mode** — solo aplica a documentos nuevos. |

### RN-VINC · Vinculación de proveedor (aplica a IA y carga manual)
1. Se toma el nombre de proveedor detectado, se **normaliza** (minúsculas, sin acentos, trim) y se busca, entre los proveedores **activos del usuario**: primero coincidencia **exacta normalizada**, luego por **"contiene"**.
2. Las coincidencias se muestran como **sugerencias**; el usuario confirma una.
3. Siempre disponible el control **"Buscar proveedor"** (lista todos, con búsqueda por nombre) + botón **"Crear nuevo proveedor"**.
4. Si no hay coincidencia o la sugerencia es incorrecta, el usuario elige el correcto o **crea uno nuevo en el momento**.

## Dominio: Testing

| Código | Regla |
|---|---|
| **RN-TEST-01** | **Invariante de module-identity para fixtures de integración (c-17).** Los fixtures de los archivos de test de integración deben importar `get_db` desde un módulo de **router** (ej. `from app.routers.facturas import get_db`), NO desde `app.core.deps`. Razón: `test_deps.py::TestLazyEngine` (c-16 protected, 9/9) hace `del sys.modules["app.core.deps"]` y reimporta, creando un módulo nuevo con un `get_db` nuevo; los routers registrados en `app.main` siguen apuntando al `get_db` viejo. Si el fixture importa de `app.core.deps`, setea el override con la key equivocada y los tests fallan en suite (aunque pasen aislados). El contrato está bloqueado por `tests/test_pollution_fix.py` (13 tests: 1 invariante + 6 fixture contracts + 6 isolation regressions). |

## Decisiones de negocio resueltas (no reabrir sin razón)

1. Facturas y pagos se pueden **editar o eliminar libremente**, sin reversa obligatoria.
2. Las facturas registran **solo monto total**, sin IVA. Todo en **ARS**, sin campo de moneda.
3. Un pago se asocia a un proveedor, **nunca** a una factura puntual.
4. El **saldo se calcula dinámicamente** en cada consulta, nunca se persiste.
5. El **estado de factura es derivado** (FIFO), nunca almacenado.
6. App **multi-usuario con datos aislados por cuenta**, sin roles ni datos compartidos en el MVP. Registro abierto y mínimo (email, nombre, contraseña).
