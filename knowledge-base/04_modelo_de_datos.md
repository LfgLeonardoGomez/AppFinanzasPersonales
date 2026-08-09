# 04 · Modelo de Datos

> Fuente: `docs/02-modelo-datos.md`.

## Convenciones generales

- Toda entidad principal: `id` (UUID o serial, a definir), `created_at`, `updated_at`.
- **Soft delete**: las entidades que lo usan agregan `deleted_at` (nullable, `null` = activo). Las lecturas de negocio filtran por defecto `deleted_at IS NULL`.
- **Aislamiento por negocio (D-27)**: toda entidad de negocio se filtra por el `negocio_id` del usuario autenticado, en el **service layer**. `Proveedor`, `Factura`, `Pago`, `Cliente`, `Venta` y `CobroCliente` llevan `negocio_id` **denormalizado** para que la verificación de pertenencia sea barata y a prueba de fugas. Recurso de otro negocio → **404** (D-06).
  > **Nota de evolución**: hasta C-27 el aislamiento era por `usuario_id`. D-27 lo reemplaza por `negocio_id` para soportar varias personas trabajando sobre el mismo local. El campo `usuario_id` sobrevive donde tiene valor de **autoría** (quién cargó el registro), no de autorización.
- **Montos**: `numeric(12,2)`, en **ARS**. No hay campo de moneda.
- **Fechas**: validadas en zona **America/Argentina/Buenos_Aires (UTC-3)**.

## Diagrama entidad-relación

```
Negocio   1───N Usuario                  (D-28: un usuario pertenece a UN negocio)
Negocio   1───N InvitacionEmpleado
Negocio   1───N Proveedor
Negocio   1───N Factura
Negocio   1───N Pago
Negocio   1───N Cliente
Negocio   1───N Venta
Negocio   1───N CobroCliente
Usuario   1───N RefreshToken
Proveedor 1───N Factura
Proveedor 1───N Pago
Factura   1───N FacturaItem
Cliente   1───N Venta                    (solo las fiadas; cliente_id nullable)
Cliente   1───N CobroCliente

NO existe relación Factura–Pago.
NO existe relación Venta–CobroCliente.   (mismo criterio: FIFO derivado, D-37)
```

> Las dos cuentas corrientes del sistema son **estructuralmente idénticas**:
> `Proveedor : Factura : Pago` ≡ `Cliente : Venta fiada : CobroCliente`.
> Un lado es lo que el negocio debe; el otro, lo que le deben.

## Entidades

### Negocio *(D-27 — entidad de aislamiento)*
| Campo | Tipo | Notas |
|---|---|---|
| id | PK (UUIDv7) | |
| nombre | string(120) | Nombre del local. Cargado en el registro público. |
| created_at / updated_at | timestamp | |

> Se crea **únicamente** por el registro público, en la misma transacción que su primer `Usuario` (D-30). No hay endpoint de "crear negocio" suelto.

### Usuario
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| negocio_id | FK → Negocio, **not null** | D-28. Sin tabla de membresía: un usuario pertenece a un solo negocio. |
| es_admin | bool, default `false` | D-29. Único nivel de privilegio. `true` solo para quien creó el negocio o para un admin promovido explícitamente. Habilita: generar invitaciones y desactivar miembros. |
| desactivado | bool, default `false` | D-32. Revocación de acceso, **no** borrado: los registros del usuario siguen existiendo y atribuidos. El login rechaza `desactivado = true`. **No** es `deleted_at`. |
| email | string, unique | Unique global (no por negocio) — es lo que sostiene D-28. |
| nombre | string | Pedido en el registro |
| password_hash | string | argon2id / bcrypt |
| telefono | string, nullable | Completado en el perfil |
| avatar_url | string, nullable | Cloudinary |
| ~~nombre_negocio~~ | string, nullable | **Obsoleto tras D-27**: el nombre del local vive en `Negocio.nombre`. Se mantiene la columna hasta que la migración lo consolide; no leer para lógica nueva. |
| tema_preferido | enum `CLARO`/`OSCURO` | default `CLARO` |
| created_at / updated_at | timestamp | |

> **Invariante crítica (D-32):** un negocio no puede quedarse sin ningún `Usuario` con `es_admin = true AND desactivado = false`. Un admin no puede desactivarse a sí mismo si es el último activo. Un negocio huérfano no puede generar invitaciones ni reactivar a nadie.

### InvitacionEmpleado *(D-31 — tabla `invitacion_empleado`)*
| Campo | Tipo | Notas |
|---|---|---|
| id | PK (UUIDv7) | |
| negocio_id | FK → Negocio | |
| codigo_hash | string, único, indexado | Igual criterio que `RefreshToken` (D-17): se persiste solo el **hash**, nunca el código crudo. El valor legible se muestra UNA vez al admin. |
| creado_por_usuario_id | FK → Usuario | Trazabilidad: qué admin lo generó. |
| expira_en | timestamp | UTC. `now() > expira_en` → inválido. |
| usado_en | timestamp, nullable | `null` = disponible. Se sella al consumirse. |
| created_at / updated_at | timestamp | |

> **Regla de validez:** `código válido ⟺ usado_en IS NULL AND expira_en > now()`. Un solo uso, sin excepción (D-31).

### Proveedor
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| negocio_id | FK → Negocio | D-27. Reemplaza a `usuario_id` como eje de aislamiento. |
| nombre | string(120) | **No** único |
| cuit | string, nullable | Validar formato `XX-XXXXXXXX-X` si presente |
| telefono | string, nullable | |
| categoria | enum `INSUMO`/`SERVICIO`/`OTRO` | default `OTRO` |
| notas | text, nullable | |
| deleted_at | timestamp, nullable | soft delete |
| created_at / updated_at | timestamp | |

> Los **servicios** (luz, gas, internet) se modelan como `Proveedor` con `categoria = SERVICIO`. No hay entidad separada.

### Factura
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| negocio_id | FK → Negocio | D-27. Denormalizado; debe coincidir con el del proveedor. |
| creado_por_usuario_id | FK → Usuario, nullable | Autoría (quién lo cargó), **no** autorización. Sobrevive a la desactivación del usuario (D-32). |
| proveedor_id | FK → Proveedor | |
| numero | string, nullable | **No** único |
| fecha_emision | date | no futura (validación a nivel servicio) |
| fecha_vencimiento | date, nullable | servicios; `null` en el resto |
| monto_total | numeric(12,2) | > 0 |
| archivo_url | string, nullable | un archivo PDF/imagen, en Cloudinary |
| origen | enum `MANUAL`/`IA` | **acepta `null` en create;** el service persiste `datos.origen or MANUAL`. C-15 (IA-frontend) envía `'IA'` desde el cliente en el POST de confirmación del modal (D-18). `FacturaCreate` no usa `extra="forbid"` (default `extra="ignore"`) → el campo es retrocompatiblemente opt-in. |
| deleted_at | timestamp, nullable | soft delete |
| created_at / updated_at | timestamp | |

> `estado` (PENDIENTE/PARCIAL/PAGADA) **NO es columna**: se deriva por FIFO en el service layer.

### FacturaItem
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| factura_id | FK → Factura | |
| descripcion | string | |
| cantidad | numeric | admite decimales |
| precio_unitario | numeric(12,2) | |

> Opcional y de carga **manual**. La IA no completa items en el MVP. Son informativos: si su suma no coincide con `monto_total`, se advierte pero se permite guardar — `monto_total` es la fuente de verdad.

### Pago
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| negocio_id | FK → Negocio | D-27. Denormalizado; debe coincidir con el del proveedor. |
| creado_por_usuario_id | FK → Usuario, nullable | Autoría (quién lo cargó), **no** autorización. Sobrevive a la desactivación del usuario (D-32). |
| proveedor_id | FK → Proveedor | **obligatorio** |
| monto | numeric(12,2) | > 0 |
| fecha | date | no futura. Informativa (no afecta FIFO) |
| metodo | enum `EFECTIVO`/`TRANSFERENCIA`/`TARJETA`/`MERCADOPAGO`/`OTRO` | |
| comprobante_url | string, nullable | un archivo PDF/imagen, en Cloudinary |
| origen | enum `MANUAL`/`IA` | **acepta `null` en create;** el service persiste `datos.origen or MANUAL`. C-15 (IA-frontend) envía `'IA'` desde el cliente en el POST de confirmación del modal (D-18). |
| deleted_at | timestamp, nullable | soft delete |
| created_at / updated_at | timestamp | |

> **El Pago NO tiene `factura_id`.** Se asocia únicamente al proveedor. `PagoCreate` mantiene `model_config = ConfigDict(extra="forbid")` para impedir smuggling de `factura_id`/`usuario_id`/`id`/`proveedor_id` (RN-PAG-01).

### RefreshToken *(C-03 — agregado post-MVP, tabla `refresh_token`)*
| Campo | Tipo | Notas |
|---|---|---|
| id | PK (UUIDv7) | hereda del mixin base |
| usuario_id | FK → Usuario | indexado |
| token_hash | string, **único**, indexado | SHA-256 hex del token opaco. **Nunca se guarda el valor crudo.** |
| expires_at | timestamp | UTC. `now() > expires_at` → inválido. |
| revoked_at | timestamp, nullable | `None` = activo. Poblar por logout o por rotación. |
| created_at / updated_at | timestamp | del mixin base |

> **Regla de validez:** `token es válido ⟺ revoked_at IS NULL AND expires_at > now()`. NO usa soft delete: `revoked_at` es ciclo de vida de sesión, no de UI. El value raw se manda UNA sola vez al cliente (cookie) y nunca se persiste. Ver D-17.

### Cliente *(D-36 — tabla `cliente`)*
| Campo | Tipo | Notas |
|---|---|---|
| id | PK (UUIDv7) | |
| negocio_id | FK → Negocio | |
| nombre | string(120) | Único dato obligatorio. Alta inline desde el formulario de venta, sin modal. |
| nombre_normalizado | string(120), indexado | minúsculas, sin acentos, trim. **Índice único `(negocio_id, nombre_normalizado)`** — defensa contra duplicados que partirían la deuda. Se deriva de `nombre` en el service layer, nunca lo manda el cliente. |
| telefono | string, nullable | Opcional, se completa después si hace falta. |
| notas | text, nullable | |
| deleted_at | timestamp, nullable | soft delete (D-04) |
| created_at / updated_at | timestamp | |

> Deliberadamente mínimo: pedir más datos en el momento de la venta rompe el flujo del mostrador. Todo lo demás es opcional y editable después.

### Venta *(D-33 — tabla `venta`)*
| Campo | Tipo | Notas |
|---|---|---|
| id | PK (UUIDv7) | |
| negocio_id | FK → Negocio | |
| cliente_id | FK → Cliente, **nullable** | Obligatorio **si y solo si** `forma_pago = CUENTA_CORRIENTE`. Ver invariantes. |
| fecha | date | no futura (UTC-3) |
| monto | numeric(12,2) | > 0 |
| forma_pago | enum `EFECTIVO`/`TRANSFERENCIA`/`TARJETA`/`CUENTA_CORRIENTE`/`OTRO` | `CUENTA_CORRIENTE` = fiado. |
| notas | text, nullable | |
| creado_por_usuario_id | FK → Usuario, nullable | Autoría. |
| deleted_at | timestamp, nullable | soft delete (D-04) |
| created_at / updated_at | timestamp | |

> **Una fila = una operación de venta.** El fiado NO tiene tabla propia: es una `Venta` con `forma_pago = CUENTA_CORRIENTE` y `cliente_id` cargado (D-33). Esa misma fila es, al mismo tiempo, la venta del día y el cargo en la cuenta corriente del cliente — se carga una vez y no puede desincronizarse.
>
> La granularidad de carga (venta por venta vs. un total al cierre) es decisión de UX, no de modelo (D-35).

### CobroCliente *(D-34 — tabla `cobro_cliente`)*
| Campo | Tipo | Notas |
|---|---|---|
| id | PK (UUIDv7) | |
| negocio_id | FK → Negocio | |
| cliente_id | FK → Cliente | **obligatorio** |
| monto | numeric(12,2) | > 0 y **≤ saldo pendiente del cliente** (D-37: sin saldo negativo) |
| fecha | date | no futura. Informativa (no afecta FIFO) |
| metodo | enum `EFECTIVO`/`TRANSFERENCIA`/`TARJETA`/`OTRO` | Sin `CUENTA_CORRIENTE`: no se cancela deuda con deuda. |
| comprobante_url | string, nullable | Cloudinary |
| creado_por_usuario_id | FK → Usuario, nullable | Autoría. |
| deleted_at | timestamp, nullable | soft delete (D-04) |
| created_at / updated_at | timestamp | |

> **El cobro NO es una venta y NO toca la tabla `venta`** (D-34, devengado vs. percibido). Y, espejando RN-PAG-01, **no lleva `venta_id`**: se asocia solo al cliente y la imputación es FIFO derivada.

## Invariantes (service layer)

- `Factura.negocio_id == Proveedor(de esa factura).negocio_id`
- `Pago.negocio_id == Proveedor(de ese pago).negocio_id`
- `Venta.negocio_id == Cliente(de esa venta).negocio_id` (cuando `cliente_id` no es `null`)
- `CobroCliente.negocio_id == Cliente(de ese cobro).negocio_id`
- **`Venta.cliente_id IS NOT NULL ⟺ Venta.forma_pago = CUENTA_CORRIENTE`** — las dos direcciones. Una venta fiada sin cliente es deuda de nadie; una venta en efectivo con cliente es ruido que alguien va a malinterpretar después.
- **`SUM(cobros activos del cliente) ≤ SUM(ventas fiadas activas del cliente)`** — no se admite saldo a favor (D-37).
- Un `Negocio` siempre conserva al menos un `Usuario` con `es_admin = true AND desactivado = false` (D-32).
- `RefreshToken` solo se lee/escribe por su `usuario_id`; revocación es por sesión individual, no por usuario completo (a futuro: `revoke_all` borra todos los tokens activos de un `usuario_id`).

## Cálculos derivados (no persistidos)

> Detalle algorítmico completo en `05_reglas_de_negocio.md` (RN-SALDO, RN-FIFO, RN-HIST).

1. **Saldo del proveedor** = `SUM(facturas activas.monto_total) − SUM(pagos activos.monto)`.
2. **Estado de factura** (PENDIENTE/PARCIAL/PAGADA) por asignación FIFO de un pool de pagos.
3. **Historial cronológico** con saldo acumulado por fila.
4. **Saldo del cliente** = `SUM(ventas fiadas activas.monto) − SUM(cobros activos.monto)` — nunca negativo (D-37).
5. **Estado de venta fiada** (PENDIENTE/PARCIAL/COBRADA) por el mismo algoritmo FIFO del punto 2.
6. **Totales de venta por período** (día / semana / mes) y su desglose por `forma_pago` — pura agregación sobre `venta`.
7. **Totales de compra por proveedor y por período** — pura agregación sobre `factura`.

> Los puntos 6 y 7 tienen **la misma forma de agregación** (D-35): un solo motor sirve a los dos, y contrastar compras contra ventas no requiere nada adicional.

**Por qué no se persisten:** como facturas y pagos se editan/eliminan libremente y los pagos no se vinculan a facturas, cualquier contador persistido se desincronizaría. El costo de calcular on-demand es despreciable para el volumen de un comercio chico (un `GROUP BY` para el listado; cálculo en memoria por proveedor para el estado FIFO).
