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
| **RN-FAC-10** | **Reintentar el registro de una factura no crea una segunda factura** (C-43, D-68 a D-71). `POST /api/facturas` acepta el header opcional `Idempotency-Key`. Lo que define "los mismos datos" **incluye los items**, comparados como lista ordenada de `(descripcion, cantidad, precio_unitario)`: corregir una línea acuña una clave nueva y se guarda como la corrección que es, en vez de chocar contra el `409`. `items_sum_mismatch` **no** entra en la comparación — es una salida derivada, no una entrada. `factura_item` no lleva clave propia: lo que se desduplica es la intención "registrar una factura con su detalle", no cada línea. |
| **RN-FAC-11** | **La respuesta de una repetición se calcula al responder y puede diferir de la original** (C-43, D-70). El `estado` de la repetición se recalcula sobre el pool FIFO **actual** del proveedor; si entre el intento y el reintento entró un pago, la repetición puede devolver `PARCIAL` donde el original habría devuelto `PENDIENTE`. Es correcto, no un bug: `estado` es derivado y nunca persistido. La garantía de la idempotencia es *"no se creó una segunda fila"*, **no** *"recibís los mismos bytes"*. El cliente muestra ese estado **verbatim** y nunca lo recalcula (RN-FAC-09). |

## Dominio: Pagos

| Código | Regla |
|---|---|
| **RN-PAG-01** | Un pago se asocia **a un proveedor, nunca a una factura puntual**. No existe `factura_id`. Reforzado en backend por `PagoCreate.model_config = ConfigDict(extra="forbid")` — rechaza cualquier `factura_id`/`usuario_id`/`id`/`proveedor_id` que el cliente envíe por error o con intención de smuggling. |
| **RN-PAG-02** | `monto` > 0, en ARS. |
| **RN-PAG-03** | `fecha` obligatoria, no futura (UTC-3). Es **informativa**: no afecta la asignación FIFO. |
| **RN-PAG-04** | `metodo` obligatorio (enum acotado). |
| **RN-PAG-05** | Editar/eliminar: libre (soft delete). Cualquier cambio recalcula automáticamente saldo y estados, porque nada de eso se persiste. |
| **RN-PAG-06** | `origen` se persiste tal cual el cliente lo envía en el POST de creación, con fallback a `MANUAL` cuando se omite. D-18 (Path B): C-15 envía `'IA'` desde el cliente tras confirmar el modal de IA. |
| **RN-PAG-07** | **Reintentar el registro de un pago no crea un segundo pago** (C-43, D-68 a D-71). `POST /api/pagos` acepta un header opcional `Idempotency-Key` (UUID); repetir la misma clave devuelve el pago original con `200` + `Idempotent-Replay: true`, y la misma clave con **datos distintos** da `409`. Sin el header, el endpoint se comporta exactamente como antes. Importa porque un pago duplicado corre el FIFO de todas las facturas de ese proveedor (RN-SALDO, RN-FIFO): no es una fila de más, es el estado de la deuda entera contado mal. La comparación usa `origen` **resuelto** (`datos.origen or MANUAL`), no el crudo, o un payload que omite `origen` daría conflicto contra su propia fila. |

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

## Dominio: Negocio y equipo *(evolución post-MVP — D-27 a D-32)*

| Código | Regla |
|---|---|
| **RN-NEG-01** | El **`Negocio` es la unidad de aislamiento**. Toda consulta de negocio se filtra por el `negocio_id` del usuario autenticado, en el **service layer** (nunca en router ni repository). Recurso de otro negocio → **404**, no 403 (D-06 intacto). |
| **RN-NEG-02** | Un `Usuario` pertenece a **un solo** `Negocio` (`negocio_id` not null, sin tabla de membresía). Quien opere dos locales usa dos cuentas: `email` es unique global (D-28). |
| **RN-NEG-03** | El **registro público** crea `Usuario` + `Negocio` en una **única transacción**, con `es_admin = true`. Si falla cualquiera de los dos, no se persiste ninguno. No existe endpoint suelto de "crear negocio" (D-30). |
| **RN-NEG-04** | El **alta de empleado NO la hace el admin**: el empleado se registra solo, con un código de invitación, eligiendo su propia contraseña. Hereda el `negocio_id` del código y nace con `es_admin = false` (D-30). El admin nunca manipula credenciales ajenas. |
| **RN-NEG-05** | Las invitaciones son de **un solo uso y con vencimiento**: `código válido ⟺ usado_en IS NULL AND expira_en > now()`. Se persiste solo el hash; el código legible se muestra **una vez** al admin y no se puede volver a ver (D-31). Un código inválido, vencido o ya usado devuelve un error **genérico** que no revela si el negocio existe. |
| **RN-NEG-06** | El único privilegio diferenciado es `es_admin` (D-29). Habilita exactamente: generar invitaciones, listar miembros y desactivar/reactivar miembros. **Todo lo demás** —proveedores, facturas, pagos, clientes, ventas, cobros— lo opera cualquier miembro activo del negocio. |
| **RN-NEG-07** | Desactivar un usuario **revoca su acceso, no borra sus datos** (D-32): `desactivado = true`, el login lo rechaza y sus refresh tokens activos se revocan. Los registros que cargó siguen existiendo y atribuidos vía `creado_por_usuario_id`. |
| **RN-NEG-08** | **Un negocio nunca puede quedar sin admin activo.** Un admin no puede desactivarse a sí mismo si es el último con `es_admin = true AND desactivado = false`. El intento se rechaza con un error explícito. Un negocio huérfano no puede generar invitaciones ni reactivar a nadie, y no hay salida sin intervención manual en la base. |
| **RN-NEG-09** | El `negocio_id` del request se resuelve desde el `Usuario` hidratado por `get_current_user`, **NO** desde un claim del token. El access token conserva su forma de C-03: `sub` (= `usuario_id`), `iat`, `exp`, `type`. **Corregida en C-28** — la redacción original pedía transportar `negocio_id` en el token "para que el service layer no consulte la base en cada request", y esa premisa es falsa: `deps.py` ya hace un `SELECT` del `Usuario` en cada request por diseño (D-C03-6), así que el `negocio_id` sale gratis de esa misma fila. Además, resolverlo contra la base en cada request es lo que hace que RN-NEG-07 funcione: un usuario desactivado pierde el acceso en su request siguiente, en vez de sobrevivir hasta que expire su token. |

## Dominio: Clientes *(D-36)*

| Código | Regla |
|---|---|
| **RN-CLI-01** | Un `Cliente` requiere **solo un nombre**. Todo lo demás es opcional y editable después. El alta ocurre **inline en el formulario de venta**, sin modal ni navegación. |
| **RN-CLI-02** | Antes de crear, se **autocompleta**: el nombre tipeado se normaliza (minúsculas, sin acentos, trim) y se buscan clientes activos del negocio — primero coincidencia exacta normalizada, luego "contiene". Las coincidencias se ofrecen como sugerencias. Mismo criterio que RN-VINC para proveedores. |
| **RN-CLI-03** | **Índice único `(negocio_id, nombre_normalizado)`.** Dos clientes con nombre equivalente no pueden coexistir en el mismo negocio: partirían la deuda en dos cuentas y el sistema perdería su única razón de ser. Si el usuario insiste con un nombre ya existente, se le ofrece el cliente existente, no se crea uno nuevo. |
| **RN-CLI-04** | `nombre_normalizado` se **deriva en el service layer** a partir de `nombre`. Nunca se acepta desde el payload del cliente. |

## Dominio: Ventas *(D-33 a D-35)*

| Código | Regla |
|---|---|
| **RN-VTA-01** | Una fila de `Venta` = **una operación de venta**. `monto > 0`, `fecha` no futura (UTC-3), `forma_pago` obligatoria. |
| **RN-VTA-02** | **El fiado no es una entidad aparte**: es una `Venta` con `forma_pago = CUENTA_CORRIENTE` y `cliente_id` cargado. La misma fila es la venta del día y el cargo en la cuenta corriente del cliente (D-33). Está **prohibido** registrar el fiado por duplicado como cargo separado. |
| **RN-VTA-03** | **Invariante bidireccional**: `cliente_id` es obligatorio **si y solo si** `forma_pago = CUENTA_CORRIENTE`. Venta fiada sin cliente → rechazada. Venta no fiada con cliente → rechazada. Validado con Pydantic + service layer. |
| **RN-VTA-04** | **Un cobro de cuenta corriente NO es una venta** y no escribe en `venta` (D-34). La venta se registra cuando sale la mercadería; el cobro, cuando entra la plata. Contar el cobro como venta duplicaría la facturación y rompería el contraste compras-vs-ventas. |
| **RN-VTA-05** | Los totales por período (día / semana / mes) y su desglose por `forma_pago` son **agregaciones calculadas on-demand**, nunca columnas persistidas. Coherente con D-01. |
| **RN-VTA-06** | La granularidad de carga es libre: el esquema admite tanto una fila por operación como una fila agregada al cierre del día. Es decisión de UX, no de modelo (D-35). |
| **RN-VTA-07** | **Reintentar el registro de una venta no crea una segunda operación** (C-42, D-62 a D-65). `POST /api/ventas` acepta un header opcional `Idempotency-Key` (UUID); repetir la misma clave devuelve la venta original en vez de duplicarla. Existe porque una venta fiada duplicada **es** un cargo duplicado en la cuenta corriente del cliente (RN-VTA-02) — un doble-tap en "Guardar" sobre datos móviles inestables no puede convertirse en una deuda que no corresponde. |

## Dominio: Cuenta corriente de clientes *(D-37)*

> **Reutiliza el motor de proveedores sin modificarlo.** La correspondencia es exacta:
> `Proveedor → Cliente`, `Factura → Venta con forma_pago = CUENTA_CORRIENTE`, `Pago → CobroCliente`.

| Código | Regla |
|---|---|
| **RN-CCC-01** | **Saldo del cliente** = `SUM(ventas fiadas activas.monto) − SUM(cobros activos.monto)`. Calculado on-demand, **nunca persistido** (D-01). Aplica RN-SALDO con las entidades espejadas. |
| **RN-CCC-02** | **Estado de cada venta fiada** (PENDIENTE / PARCIAL / COBRADA) por asignación **FIFO** de un pool de cobros, con el mismo algoritmo y el mismo desempate determinista `(fecha ASC, created_at ASC, id ASC)` de RN-FIFO. |
| **RN-CCC-03** | Un `CobroCliente` **no lleva `venta_id`**: se asocia solo al cliente, igual que RN-PAG-01. La imputación a ventas concretas es derivada, nunca almacenada. |
| **RN-CCC-04** | **No se admite saldo negativo (a favor del cliente).** Un cobro no puede superar el saldo pendiente: `SUM(cobros activos) ≤ SUM(ventas fiadas activas)`. Validado en el **service layer** antes de persistir. Es la única diferencia sustantiva con la cuenta corriente de proveedores, donde el saldo a favor sí es un estado válido. **⚠️ Esta regla NO aplica a una repetición** (C-43, D-69): ver RN-CCC-05. |
| **RN-CCC-05** | **Reintentar un cobro no crea un segundo cobro, y no se rechaza por saldo insuficiente** (C-43, D-69). `POST /api/cobros` acepta el header opcional `Idempotency-Key`. A diferencia de pagos y facturas, acá la búsqueda por clave corre **antes** de la validación de saldo, y no es un detalle de implementación sino la regla: `_saldo_disponible` resta los cobros ya persistidos, así que una repetición legítima evaluaría el saldo que el cobro **original ya consumió**. Sin esa inversión, **saldar una cuenta entera y reintentar fallaría siempre** con un `422` de RN-CCC-04 — el caso más común de todos. Por eso RN-CCC-04 se evalúa solo cuando la clave es nueva. Regla general que deja: *"validar → insertar → atrapar conflicto" solo es seguro si toda validación previa es stateless respecto del recurso que se crea.* |
| **RN-CCC-05** | **Historial cronológico** debe/haber con saldo acumulado por fila, aplicando RN-HIST sobre ventas fiadas y cobros. |

## Dominio: Exportación de cuenta corriente *(C-39, design.md)*

> **No es un tercer motor de cálculo.** El exportador de proveedores y el de clientes son el mismo módulo, parametrizado por el service de cuenta corriente que cada uno ya tiene (`ProveedorService.get_cuenta_corriente` / `ClienteService.get_cuenta_corriente`). Ninguna regla de esta sección calcula saldo ni historial por su cuenta — todas leen lo que RN-SALDO/RN-FIFO/RN-HIST (y sus espejos RN-CCC-XX) ya produjeron.

| Código | Regla |
|---|---|
| **RN-EXP-01** | **El documento exportado (PDF o XLSX) SHALL derivar su saldo y sus movimientos de la misma composición on-demand que sirve la vista de cuenta corriente, y SHALL NOT recalcularlos por una vía propia.** Es la condición que hace estructuralmente imposible que un documento entregado a un tercero diga un número distinto al de la pantalla (D-80). |
| **RN-EXP-02** | **El saldo del encabezado es siempre el de la cuenta completa** y **SHALL NOT** verse afectado por ningún filtro de fechas aplicado al historial. Un rango acota qué movimientos se listan, nunca qué saldo se declara como "el saldo". |
| **RN-EXP-03** | **Un documento con historial acotado a un rango SHALL reconciliar consigo mismo.** Abre con una fila de `saldo_anterior` — el `saldo_acumulado` de la última fila del historial completo anterior al inicio del rango (cero si no hay ninguna) — de forma que `saldo_anterior + Σ(movimientos con signo del rango) == saldo_acumulado de la última fila del rango`. Ese número se **lee** de una fila que el historial ya trae (D-81), nunca se suma de cero — sumar violaría RN-EXP-01. |
| **RN-EXP-04** | **Pedir un rango de fechas sin pedir el historial es contradictorio** y **SHALL** rechazarse con **422**, nunca ignorarse en silencio devolviendo un documento sin filas. |
| **RN-EXP-05** | **Tope de filas por formato.** El sistema **SHALL** rechazar con **422** una exportación cuyo historial (post-filtro de fechas) exceda el tope del formato pedido, informando la cantidad real de movimientos y sugiriendo acotar el rango. Al exceder el tope **SHALL NOT** devolverse ningún documento, ni parcial. Los topes de PDF y XLSX son distintos (D-83) porque los formatos no consumen memoria igual. |
| **RN-EXP-06** | **Aislamiento por `negocio_id`, igual que el resto del sistema (D-27).** Exportar una cuenta ajena, borrada o inexistente responde **404**, nunca 403, y la verificación de pertenencia corre antes de generar cualquier byte. |

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
6. ~~App multi-usuario con datos aislados por cuenta, sin roles ni datos compartidos en el MVP.~~ **Actualizado por D-27/D-29:** datos aislados por **negocio**, con varios usuarios compartiendo el mismo local y un único nivel de privilegio (`es_admin`). Registro abierto y mínimo se mantiene; se le suma el registro de empleado por código de invitación (RN-NEG-04).
7. El **fiado no es una entidad aparte** (D-33): es una venta con `forma_pago = CUENTA_CORRIENTE`. Nunca se registra dos veces.
8. **Venta ≠ cobro** (D-34). El cobro de una cuenta corriente no incrementa las ventas del día.
9. La cuenta corriente de clientes **no admite saldo a favor** (D-37), a diferencia de la de proveedores.
