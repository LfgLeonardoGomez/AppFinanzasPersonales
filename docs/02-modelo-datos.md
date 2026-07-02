# Modelo de Datos — MVP

## Convenciones generales

- Toda entidad principal tiene `id` (UUID o serial, a definir en implementación), `created_at`, `updated_at`.
- Soft delete: las entidades que lo usan agregan `deleted_at` (nullable, `null` = activo). Las lecturas de negocio filtran por defecto `deleted_at IS NULL`.
- **Aislamiento multi-usuario:** toda entidad de negocio se filtra además por el usuario autenticado. Para que la verificación de pertenencia sea barata y a prueba de fugas, `Factura` y `Pago` llevan también `usuario_id` (denormalizado), además de su `proveedor_id`.
- Montos: `numeric(12,2)`, en **pesos argentinos (ARS)**. No hay campo de moneda.
- Fechas: validadas con zona horaria **America/Argentina/Buenos_Aires (UTC-3)**.

---

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
| tema_preferido | enum: `CLARO`, `OSCURO` | default `CLARO` |
| created_at / updated_at | timestamp | |

### Proveedor
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| usuario_id | FK → Usuario | |
| nombre | string(120) | **No** único |
| cuit | string, nullable | Validar formato si presente |
| telefono | string, nullable | |
| categoria | enum: `INSUMO`, `SERVICIO`, `OTRO` | default `OTRO` |
| notas | text, nullable | |
| deleted_at | timestamp, nullable | soft delete |
| created_at / updated_at | timestamp | |

### Factura
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| usuario_id | FK → Usuario | denormalizado para scoping; debe coincidir con el del proveedor |
| proveedor_id | FK → Proveedor | |
| numero | string, nullable | **No** único |
| fecha_emision | date | no futura (validación a nivel servicio) |
| fecha_vencimiento | date, nullable | servicios; `null` en el resto |
| monto_total | numeric(12,2) | > 0 |
| archivo_url | string, nullable | un archivo PDF o imagen, en Cloudinary |
| origen | enum: `MANUAL`, `IA` | |
| deleted_at | timestamp, nullable | soft delete |
| created_at / updated_at | timestamp | |

> `estado` (PENDIENTE/PARCIAL/PAGADA) **no es una columna**: se deriva por FIFO en el service layer.

### FacturaItem
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| factura_id | FK → Factura | |
| descripcion | string | |
| cantidad | numeric | admite decimales |
| precio_unitario | numeric(12,2) | |

Opcional y de carga **manual**; la IA no completa items en el MVP.

### Pago
| Campo | Tipo | Notas |
|---|---|---|
| id | PK | |
| usuario_id | FK → Usuario | denormalizado para scoping; debe coincidir con el del proveedor |
| proveedor_id | FK → Proveedor | **obligatorio** |
| monto | numeric(12,2) | > 0 |
| fecha | date | no futura. Informativa (no afecta la asignación FIFO) |
| metodo | enum: `EFECTIVO`, `TRANSFERENCIA`, `TARJETA`, `MERCADOPAGO`, `OTRO` | |
| comprobante_url | string, nullable | un archivo PDF o imagen, en Cloudinary |
| origen | enum: `MANUAL`, `IA` | |
| deleted_at | timestamp, nullable | soft delete |
| created_at / updated_at | timestamp | |

> **El Pago no tiene `factura_id`.** Se asocia únicamente al proveedor.

---

## Relaciones

```
Usuario   1───N Proveedor
Usuario   1───N Factura
Usuario   1───N Pago
Proveedor 1───N Factura
Proveedor 1───N Pago
Factura   1───N FacturaItem
```
**No existe relación Factura–Pago.**

### Invariantes (validadas en el service layer)
- `Factura.usuario_id == Proveedor(de esa factura).usuario_id`
- `Pago.usuario_id == Proveedor(de ese pago).usuario_id`

---

## Cálculos derivados (no persistidos)

### 1. Saldo actual del proveedor (un número)
```
saldo = SUM(Factura.monto_total) WHERE proveedor_id = X AND deleted_at IS NULL
      − SUM(Pago.monto)          WHERE proveedor_id = X AND deleted_at IS NULL
```
- `saldo > 0` → deuda (le debés al proveedor)
- `saldo = 0` → al día
- `saldo < 0` → saldo a favor (crédito tuyo)

### 2. Estado de cada factura (FIFO)
```
facturas = activas del proveedor, ordenadas por (fecha_emision ASC, created_at ASC, id ASC)
pool = SUM(Pago.monto activos del proveedor)     # todos, sin importar su fecha
para cada factura:
    aplicado = min(pool, factura.monto_total)
    pool -= aplicado
    aplicado == 0                  → PENDIENTE
    0 < aplicado < monto_total     → PARCIAL
    aplicado >= monto_total        → PAGADA
si al terminar pool > 0            → ese remanente = saldo a favor
```
- Desempate `(created_at, id)` → orden determinista ante misma fecha.
- Los pagos se asignan por **monto total del pool, no por fecha**.
- El estado es totalmente dinámico: cambia cuando cambian facturas o pagos del proveedor. Nunca se guarda.

### 3. Historial cronológico (vista de cuenta corriente)
Facturas (debe) y pagos (haber) del proveedor, ordenados por fecha, con saldo acumulado por fila:
```
saldo_acumulado(fila) = SUM(facturas hasta la fila) − SUM(pagos hasta la fila)
```
Vista distinta del estado FIFO; ambas se calculan al renderizar.

---

## Por qué no se persisten saldo ni estado

Decisión explícita: como las facturas y pagos se editan/eliminan libremente, y los pagos no se vinculan a facturas, cualquier contador persistido se desincronizaría. Todo se calcula on-demand. El volumen de un comercio chico hace que el costo sea despreciable: el estado FIFO se calcula en memoria por proveedor, y el saldo del listado de proveedores se obtiene con una query agregada agrupada por proveedor (un solo `GROUP BY`, no una query por fila).
