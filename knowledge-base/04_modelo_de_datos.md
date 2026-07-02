# 04 · Modelo de Datos

> Fuente: `docs/02-modelo-datos.md`.

## Convenciones generales

- Toda entidad principal: `id` (UUID o serial, a definir), `created_at`, `updated_at`.
- **Soft delete**: las entidades que lo usan agregan `deleted_at` (nullable, `null` = activo). Las lecturas de negocio filtran por defecto `deleted_at IS NULL`.
- **Aislamiento multi-usuario**: toda entidad de negocio se filtra por el usuario autenticado. `Factura` y `Pago` llevan `usuario_id` **denormalizado** (además de `proveedor_id`) para que la verificación de pertenencia sea barata y a prueba de fugas.
- **Montos**: `numeric(12,2)`, en **ARS**. No hay campo de moneda.
- **Fechas**: validadas en zona **America/Argentina/Buenos_Aires (UTC-3)**.

## Diagrama entidad-relación

```
Usuario   1───N Proveedor
Usuario   1───N Factura
Usuario   1───N Pago
Usuario   1───N RefreshToken
Proveedor 1───N Factura
Proveedor 1───N Pago
Factura   1───N FacturaItem

NO existe relación Factura–Pago.
```

## Entidades

### Usuario
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| email | string, unique | |
| nombre | string | Pedido en el registro |
| password_hash | string | argon2id / bcrypt |
| telefono | string, nullable | Completado en el perfil |
| avatar_url | string, nullable | Cloudinary |
| nombre_negocio | string, nullable | Completado en el perfil |
| tema_preferido | enum `CLARO`/`OSCURO` | default `CLARO` |
| created_at / updated_at | timestamp | |

### Proveedor
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| usuario_id | FK → Usuario | |
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
| usuario_id | FK → Usuario | denormalizado; debe coincidir con el del proveedor |
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
| usuario_id | FK → Usuario | denormalizado; debe coincidir con el del proveedor |
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

## Invariantes (service layer)

- `Factura.usuario_id == Proveedor(de esa factura).usuario_id`
- `Pago.usuario_id == Proveedor(de ese pago).usuario_id`
- `RefreshToken` solo se lee/escribe por su `usuario_id`; revocación es por sesión individual, no por usuario completo (a futuro: `revoke_all` borra todos los tokens activos de un `usuario_id`).

## Cálculos derivados (no persistidos)

> Detalle algorítmico completo en `05_reglas_de_negocio.md` (RN-SALDO, RN-FIFO, RN-HIST).

1. **Saldo del proveedor** = `SUM(facturas activas.monto_total) − SUM(pagos activos.monto)`.
2. **Estado de factura** (PENDIENTE/PARCIAL/PAGADA) por asignación FIFO de un pool de pagos.
3. **Historial cronológico** con saldo acumulado por fila.

**Por qué no se persisten:** como facturas y pagos se editan/eliminan libremente y los pagos no se vinculan a facturas, cualquier contador persistido se desincronizaría. El costo de calcular on-demand es despreciable para el volumen de un comercio chico (un `GROUP BY` para el listado; cálculo en memoria por proveedor para el estado FIFO).
