# Especificación Funcional — MVP

Este documento define el comportamiento exacto del MVP. **Todo lo que no esté descrito acá explícitamente se considera fuera de alcance y no debe asumirse ni inventarse.**

## Actor y aislamiento de datos

- App **multi-usuario con datos aislados por cuenta**. Sin roles, sin compartir datos entre usuarios. Un mismo deploy sirve a varios usuarios; cada uno ve y opera únicamente sus propios proveedores, facturas y pagos.
- El backend filtra **toda** consulta de negocio por el usuario autenticado (ver `04-baseline-seguridad.md`). Nunca se devuelve ni se modifica un recurso de otro usuario.

---

## Módulo: Registro y autenticación

### Registro (mínimo, para que el alta no sea tediosa)
- Campos pedidos en el registro: **email, nombre, contraseña**. Nada más.
- Contraseña almacenada con hash (argon2id preferido, bcrypt aceptable), nunca en texto plano.
- Email único en el sistema.

### Login y sesión
- Login con email + contraseña.
- Checkbox **"Recordarme"**:
  - **Activado** → sesión persistente larga (refresh token en cookie httpOnly, ~30 días).
  - **Desactivado** → cookie de sesión (se borra al cerrar el navegador), access token de vida corta.
- Esquema de tokens: access token corto (httpOnly) + refresh token para renovarlo. TTLs concretos en `04-baseline-seguridad.md`.
- Logout invalida la sesión.
- **Fuera del MVP:** recuperación de contraseña por email (si el usuario pierde el acceso durante el MVP, se resuelve manualmente en base de datos).

---

## Módulo: Perfil de usuario

- En el registro solo se piden email, nombre y contraseña.
- Ya dentro de la app, el usuario puede **completar su perfil**: teléfono, avatar (foto, vía Cloudinary), nombre del negocio, y elegir el tema (claro/oscuro).
- Todos los campos de perfil más allá de email/nombre/contraseña son **opcionales**; su ausencia no bloquea ninguna función.

---

## Módulo: Proveedores (incluye servicios)

Los servicios (luz, gas, internet, etc.) se modelan como un **proveedor con `categoria = SERVICIO`**. No existe una entidad separada para servicios.

### Campos
| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| nombre | string (máx 120) | Sí | **No** es único (puede haber dos parecidos) |
| cuit | string | No | Si se carga, validar formato `XX-XXXXXXXX-X` |
| telefono | string | No | |
| categoria | enum: `INSUMO`, `SERVICIO`, `OTRO` | No | Default `OTRO` |
| notas | texto libre | No | |

### Reglas
- Crear/editar: sin restricciones más allá de las de la tabla.
- Eliminar: internamente **soft delete** (`deleted_at`), pero la UI lo muestra como eliminación normal.
- Si el proveedor tiene facturas o pagos asociados, eliminar requiere **confirmación explícita** (modal). No se bloquea, solo se confirma.
- Listado paginado, ordenable por nombre o por **saldo actual** (el saldo es un agregado calculado, no una columna; ver "Modelo de saldo y estado").

---

## Módulo: Facturas

### Campos
| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| proveedor_id | FK | Sí | |
| numero | string | No | **No** es único |
| fecha_emision | date | Sí | No puede ser futura |
| fecha_vencimiento | date | No | Típica de facturas de servicio; `null` en el resto |
| monto_total | numeric(12,2) | Sí | > 0, en ARS |
| items | lista de FacturaItem | No | Carga manual; ver abajo |
| archivo_url | string (Cloudinary) | No | **Un solo** archivo, formato PDF o imagen (jpg/png) |
| origen | enum: `MANUAL`, `IA` | Sí | Se setea automáticamente según el flujo |

### Reglas
- **Estado** (`PENDIENTE`/`PARCIAL`/`PAGADA`): **no se almacena**, se deriva por FIFO. Ver "Modelo de saldo y estado".
- **Items:** si se agregan, cada item requiere `descripcion`, `cantidad` (admite decimales) y `precio_unitario`. Son informativos. Si su suma no coincide con `monto_total`, se muestra una **advertencia** pero se permite guardar igual — `monto_total` es la fuente de verdad.
- Editar: todos los campos editables en cualquier momento.
- Eliminar: soft delete. Como los pagos **no** están vinculados a facturas, borrar una factura no afecta ningún pago; solo cambia el saldo y los estados derivados del proveedor.
- Listado filtrable por proveedor, estado y rango de fechas. **NOTA para el implementador:** el filtro por estado se aplica **después** de calcular el estado en el service layer (no es columna, no se puede filtrar con un `WHERE estado = ...` en SQL).

### Carga asistida por IA (se implementa al FINAL del MVP, sobre el flujo manual ya funcionando)
1. El usuario sube un archivo. La **extracción por IA corre sobre imágenes**. Si el archivo es PDF, se guarda igual pero los campos se cargan a mano en el MVP (ver nota).
2. Se envía la imagen al extractor de visión configurado, que devuelve una **propuesta** JSON con: **proveedor (texto), número, fecha, monto_total**. Solo cabecera — **los items no se extraen por IA en el MVP**.
3. Se muestra un **formulario precompletado y editable**. Nada se persiste hasta que el usuario presiona "Confirmar".
4. Vinculación del proveedor: ver "Flujo de vinculación de proveedor".
5. Si la IA no puede leer un campo, se deja **vacío** — nunca inventa un valor.
6. Si la extracción falla, se muestra el formulario vacío con un aviso; la carga manual sigue disponible sin bloqueo.

> **Nota PDF:** técnicamente varios modelos de visión leen PDF directamente. Queda como mejora futura activable a través de la abstracción de visión, fuera del MVP.

### Flujo de vinculación de proveedor (aplica a IA y también a carga manual)
1. Tras la extracción, se toma el **nombre de proveedor detectado** y se hace una **búsqueda automática**: se normaliza (minúsculas, sin acentos, trim) y se busca coincidencia **exacta normalizada** primero, luego coincidencia por **"contiene"**, entre los proveedores activos del usuario.
2. Si hay coincidencias, se muestran como **sugerencias** y el usuario confirma una.
3. Siempre está disponible un control **"Buscar proveedor"** que lista todos los proveedores del usuario (con búsqueda por nombre) e incluye un botón **"Crear nuevo proveedor"**.
4. Si no hay coincidencia, o la sugerencia es incorrecta, el usuario elige el correcto con "Buscar proveedor" o **crea uno nuevo en el momento**.
5. **La IA nunca crea ni asigna un proveedor por su cuenta.** La factura no se guarda hasta que el usuario fija un proveedor y confirma.

---

## Módulo: Pagos

Un pago **se asocia a un proveedor, nunca a una factura puntual**. No existe campo `factura_id`.

### Campos
| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| proveedor_id | FK | Sí | |
| monto | numeric(12,2) | Sí | > 0, en ARS |
| fecha | date | Sí | No puede ser futura. Informativa (no afecta la asignación FIFO) |
| metodo | enum: `EFECTIVO`, `TRANSFERENCIA`, `TARJETA`, `MERCADOPAGO`, `OTRO` | Sí | |
| comprobante_url | string (Cloudinary) | No | Un solo archivo, PDF o imagen |
| origen | enum: `MANUAL`, `IA` | Sí | |

### Reglas
- La cobertura de facturas por los pagos se **calcula** (FIFO), no se almacena.
- Editar/eliminar: libre (soft delete). Cualquier cambio recalcula automáticamente el saldo del proveedor y los estados de sus facturas, porque nada de eso se persiste.
- Carga IA: mismo patrón que facturas (imagen → proveedor/monto/fecha/método cuando sea legible → formulario editable → confirmar). La vinculación de proveedor usa el mismo flujo de arriba.

---

## Modelo de saldo y estado (núcleo del sistema — definido sin ambigüedad)

Existen **tres vistas, todas calculadas on-demand, ninguna almacenada**.

### 1. Saldo actual del proveedor (un número)
```
saldo = SUM(monto_total de facturas activas del proveedor)
      − SUM(monto de pagos activos del proveedor)
```
Convención de signo:
- `saldo > 0` → **deuda** (le debés al proveedor).
- `saldo = 0` → **al día**.
- `saldo < 0` → **saldo a favor** (crédito tuyo con el proveedor).

### 2. Estado de cada factura (FIFO, derivado)
Los pagos no se asignan a facturas en la base, pero para mostrar el estado se asignan **virtualmente, de la factura más vieja a la más nueva**:
```
facturas = activas del proveedor, ordenadas por (fecha_emision ASC, created_at ASC, id ASC)
pool = SUM(monto de pagos activos del proveedor)   # todos, sin importar su fecha
para cada factura en facturas:
    aplicado = min(pool, factura.monto_total)
    pool = pool − aplicado
    si aplicado == 0:                 estado = PENDIENTE
    si 0 < aplicado < monto_total:    estado = PARCIAL
    si aplicado >= monto_total:       estado = PAGADA
# al terminar, si pool > 0, ese remanente es el saldo a favor del proveedor
```
Notas que el implementador **debe** respetar:
- El desempate `(created_at, id)` hace el orden **determinista** cuando dos facturas comparten `fecha_emision`.
- Los pagos se asignan **solo por monto total del pool, no por fecha**. La fecha del pago es informativa.
- Es **esperado** que agregar/editar/borrar una factura o pago cambie el estado de varias facturas a la vez (el pool se reasigna). Por eso el estado nunca se guarda.
- Ejemplos: una factura de $100.000 con $30.000 disponibles en el pool queda **PARCIAL**; si los pagos superan el total facturado, el sobrante queda como **saldo a favor** y no cubre ninguna factura adicional.

### 3. Historial cronológico (cuenta corriente del proveedor)
Lista combinada de facturas (como "debe") y pagos (como "haber") del proveedor, ordenada por fecha, con una columna de **saldo acumulado**:
```
saldo_acumulado(fila) = SUM(facturas hasta esa fila) − SUM(pagos hasta esa fila)
```
Es una vista **distinta** del estado FIFO: sirve para ver cómo evolucionó la deuda en el tiempo. Ambas son válidas y se calculan al renderizar.

---

## Módulo: Búsqueda / filtro

- Filtro por proveedor (autocomplete por nombre).
- Filtro de facturas por estado (aplicado tras el cálculo) y por rango de fechas.

---

## Módulo: Pantalla de inicio (MVP)

- **Limpia**, sin gráficos ni dashboard. Muestra: un **saludo** (nombre del usuario) + **accesos rápidos**: "Cargar factura", "Cargar pago", "Ver proveedores".
- La personalización del inicio (imagen de fondo, widgets elegibles) es **FUTURO**, no parte del MVP.

---

## Módulo: Preferencias de UI

- Tema claro/oscuro, persistido en el perfil del usuario (en backend, no en localStorage), para que sea consistente entre celular y PC.

---

## Explícitamente fuera del MVP

Clientes/cuentas por cobrar, dashboard o inicio personalizable, gráficos, notificaciones de vencimiento, multi-usuario con roles o datos compartidos, cualquier integración con MercadoPago, app nativa, recuperación de contraseña por email, discriminación de IVA, extracción por IA de items, extracción por IA sobre PDF.
