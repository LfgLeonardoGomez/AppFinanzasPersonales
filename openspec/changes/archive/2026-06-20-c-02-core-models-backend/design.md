## Context

C-01 (`project-foundation`, archivada) dejó el backend `facturas-proveedores-api` con la arquitectura en capas vacía (`app/core/`, `app/models/`, `app/schemas/`, `app/repositories/`, `app/services/`, `app/routers/`), Alembic inicializado sin migraciones de dominio, el arnés de tests con PostgreSQL descartable (testcontainers) y la utilidad `app/core/uuid_utils.py` que expone `new_uuid` (UUIDv7 vía librería `uuid6`, fallback UUIDv4) según la decisión D-16.

Este change materializa la capa de datos del dominio. El modelo de datos canónico está en `knowledge-base/04_modelo_de_datos.md` y las reglas en `05_reglas_de_negocio.md`. Es un dominio de governance **CRÍTICO** según CHANGES.md: define el esquema sobre el que se construye todo el backend, por lo que las decisiones de forma (qué se persiste y qué no) son difíciles de revertir una vez que C-03+ dependan de ellas.

Restricción transversal del proyecto: **nada de lo que es derivable se persiste** (D-01). El saldo del proveedor y el estado de cada factura (PENDIENTE/PARCIAL/PAGADA) se calculan on-demand; agregar columnas para ellos sería un error de diseño porque se desincronizarían con la edición libre de facturas y pagos.

## Goals / Non-Goals

**Goals:**

- Definir los modelos SQLModel de `Usuario`, `Proveedor`, `Factura`, `FacturaItem` y `Pago` fieles a la KB 04, con un mixin base reutilizable (UUID + timestamps).
- Producir una migración Alembic inicial reversible que cree el esquema con FKs e índices que sirvan a las consultas previstas (listado por usuario, saldo agregado, orden FIFO).
- Proveer una capa de repositorios de **solo acceso a datos** (CRUD + soft delete + una consulta agregada de saldo), sin lógica de negocio.
- Dejar el dominio listo para que C-03 (auth) y C-06 (proveedores) construyan servicios y routers encima.

**Non-Goals:**

- Lógica de negocio, validación de invariantes (`Factura.usuario_id == Proveedor.usuario_id`), validación de CUIT, fecha no futura, monto > 0 → todo eso vive en la capa de servicio (C-03+).
- Autenticación, hashing de password, routers / endpoints HTTP, schemas Pydantic de request/response.
- Cálculo de saldo, FIFO o historial (solo se expone la consulta agregada GROUP BY como acceso a datos; el algoritmo FIFO en memoria es de C-08/C-12).
- (Antes Non-Goal; **reconsiderado** — ver D-C02-10) `UnitOfWork`: el usuario decidió scaffoldearlo en C-02 como dice CHANGES.md, para fijar el patrón aunque su primer consumidor real sea C-08.

## Decisions

### D-C02-1: `id` UUID con default `new_uuid` (UUIDv7) — aplica D-16

Todos los modelos usan `id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)`, importando `new_uuid` de `app/core/uuid_utils.py`. No se redefine la lógica de generación: se reutiliza la utilidad de C-01.

- **Por qué**: resistencia a enumeración (recurso ajeno → 404 sin revelar existencia, D-06); UUIDv7 es time-ordered y alinea el desempate FIFO `(fecha_emision, created_at, id)` con el orden de inserción, evitando además la fragmentación de índice de UUIDv4 puro.
- **Tipo de columna en Postgres**: `UUID` nativo (no `varchar`).
- **Alternativa descartada**: serial/bigint autoincremental — enumerable y filtra volumen de datos entre usuarios. Rechazada por D-16.

### D-C02-2: Mixin base compartido vs. repetir campos

Se crea un mixin (`TimestampUUIDMixin` o equivalente) en `app/models/base.py` con `id`, `created_at`, `updated_at`. El soft delete (`deleted_at`) NO va en el mixin base: solo lo llevan `Proveedor`, `Factura` y `Pago`. Se puede modelar como un segundo mixin `SoftDeleteMixin` o como campo explícito por entidad.

- **Por qué**: `Usuario` y `FacturaItem` no tienen soft delete (la KB no lo prevé). Meter `deleted_at` en el mixin base obligaría a esas dos entidades a cargar una columna sin semántica. Separar timestamps de soft delete mantiene cada entidad fiel a la KB.
- **`updated_at` automático**: usar `sa_column_kwargs={"onupdate": ...}` con `func.now()` (o un default a nivel de modelo) de modo que SQLAlchemy lo refresque en cada UPDATE. Decisión de implementación a confirmar contra la versión de SQLModel; el contrato del spec solo exige que quede poblado.

### D-C02-3: Enums — `str, Enum` de Python mapeados a tipo enum/string en Postgres

Los enums (`TemaPreferido`, `CategoriaProveedor`, `OrigenDocumento`, `MetodoPago`) se definen en `app/models/enums.py` como `class X(str, enum.Enum)`. Se evalúa mapearlos a un tipo `ENUM` nativo de Postgres o a `varchar` con `CHECK`. 

- **Recomendación**: usar el tipo nativo de SQLAlchemy/SQLModel para enums (genera un tipo enumerado en Postgres). Si la gestión de tipos enum en migraciones Alembic agrega fricción (alter de valores), se admite degradar a `varchar` con validación a nivel de aplicación. Lo que el spec exige es que el campo solo acepte los valores del enum a nivel de modelo Python.
- **`str, Enum`**: permite serialización directa y comparación con strings, conveniente para los schemas Pydantic de C-03+.

### D-C02-4: `usuario_id` denormalizado en `Factura` y `Pago`

Ambas entidades llevan FK a `usuario` además de a `proveedor`, aunque el usuario es derivable vía el proveedor.

- **Por qué** (D-05): el aislamiento multi-usuario es el control de seguridad central. Tener `usuario_id` directo permite que toda query de negocio filtre por `usuario_id` sin un JOIN a `proveedor`, haciendo el scoping barato y a prueba de fugas. La invariante `Factura.usuario_id == Proveedor.usuario_id` se **documenta** aquí y se **enforce** en el servicio (C-08/C-10), no en el modelo.
- **Trade-off**: redundancia controlada. Aceptable: el costo es un campo extra; el beneficio es seguridad por defecto.

### D-C02-5: `Pago` sin `factura_id` (RN-PAG-01, D-02)

El modelo `Pago` no tiene ninguna FK a factura. El estado de cada factura se deriva por FIFO sobre el pool total de pagos del proveedor.

- **Por qué**: es una decisión de negocio firme. Vincular pago↔factura rompería el modelo FIFO derivado y obligaría a reasignaciones manuales. La ausencia de la columna es parte del contrato.

### D-C02-6: Sin columnas `saldo` ni `estado` (D-01)

Ningún modelo ni tabla persiste `saldo` (proveedor) ni `estado` (factura). Son derivados on-demand.

- **Por qué**: facturas y pagos se editan/eliminan libremente y los pagos no se vinculan a facturas; cualquier contador persistido se desincronizaría. El costo de calcular on-demand es despreciable para el volumen objetivo (un comercio chico): un `GROUP BY` para el saldo y cálculo en memoria por proveedor para el estado FIFO.

### D-C02-7: Índices de la migración inicial

La migración crea, además de los índices implícitos de PK/FK:

- `proveedor`: índice por `usuario_id`; índice compuesto `(usuario_id, deleted_at)` para el listado activo por usuario. (El índice de búsqueda normalizada por nombre `(usuario_id, nombre)` lo agrega C-06, no este change.)
- `factura`: índice compuesto `(usuario_id, proveedor_id, deleted_at, fecha_emision)` para soportar el orden FIFO y el scoping. (CHANGES.md lo nombra como migración `002` de C-08; se incluye el índice base aquí y C-08 puede refinarlo.)
- `pago`: índice por `(usuario_id, proveedor_id, deleted_at)`.
- `factura_item`: índice por `factura_id`.

- **Por qué**: alinear los índices con las queries reales (scoping por usuario, soft-delete, orden FIFO) desde el esquema inicial evita migraciones correctivas tempranas. Se mantienen mínimos; el refinamiento fino es responsabilidad del change que introduce cada consulta.

### D-C02-8: Saldo agregado como consulta de repositorio (no servicio)

La consulta GROUP BY de saldo vive en el repositorio de proveedores como **acceso a datos puro** (un SELECT con agregación), no como lógica de negocio. El servicio de C-06 la consumirá y le dará semántica (signo deuda/al día/a favor).

- **Por qué**: el límite "repositorio = SQL, servicio = reglas" se respeta: agregar con SUM/GROUP BY es una forma de consultar, no una regla de negocio. La interpretación del signo y el ensamblado de la respuesta sí son de servicio.

## Risks / Trade-offs

- **[Esquema crítico difícil de revertir]** → C-02 es governance CRÍTICO; un error de forma se propaga a C-03+. Mitigación: el spec fija explícitamente las ausencias (`saldo`, `estado`, `factura_id`) como escenarios testeables; los tests verifican el esquema, no solo el happy path.
- **[Invariantes no enforced en el modelo]** → `Factura.usuario_id == Proveedor.usuario_id` puede violarse a nivel DB si un servicio mal escrito inserta datos inconsistentes. Mitigación: se documenta la invariante en el modelo y se hace explícito que su enforcement es responsabilidad del servicio (C-08/C-10); los tests de esos changes la cubren. No se añade trigger/constraint de DB en C-02 para no acoplar la base a lógica que aún no existe.
- **[Manejo de tipos enum en Alembic]** → migrar valores de un ENUM nativo de Postgres es engorroso. Mitigación: si surge fricción, degradar a `varchar` con validación de aplicación (D-C02-3); el contrato del spec se mantiene porque exige validación a nivel de modelo Python, no del motor.
- **[`updated_at` automático depende de la versión de SQLModel/SQLAlchemy]** → el mecanismo `onupdate` puede variar. Mitigación: cubrir con un test que actualice una entidad y verifique que `updated_at` cambia.
- **[Precisión de `numeric`]** → usar `Decimal` (no `float`) en el lado Python para `monto_total`, `monto`, `cantidad`, `precio_unitario`; mapear a `numeric(12,2)` (y `numeric` con escala adecuada para `cantidad`). Mitigación: tests que persisten y recuperan dos decimales sin pérdida.

## Migration Plan

1. Definir `app/models/enums.py`, `app/models/base.py` (mixin) y los cinco modelos.
2. Generar la migración Alembic inicial (autogenerate revisado a mano para asegurar índices y ausencia de columnas derivadas) y verificar `upgrade`/`downgrade` contra la Postgres descartable.
3. Implementar `BaseRepository` y los repositorios concretos, incluida la consulta agregada de saldo.
4. Tests unitarios sobre testcontainers Postgres (nunca SQLite — heredado de C-01).

**Rollback**: `alembic downgrade` revierte el esquema; los modelos y repositorios son código nuevo aislado (no modifican C-01), por lo que revertir el change es eliminar los archivos nuevos y la migración.

## Open Questions

- **UnitOfWork**: CHANGES.md lo lista en C-02, pero no hay operación multi-tabla atómica hasta que el servicio de facturas (C-08) cree factura + items juntos. ¿Se introduce el `UnitOfWork` vacío ahora (para fijar el patrón) o se difiere a C-08 cuando exista el primer consumidor real? Recomendación: diferir para evitar abstracción especulativa; documentado aquí para que C-08 lo retome.
- **Tipo enum nativo vs. varchar+CHECK en Postgres**: decidir en implementación según la fricción real con Alembic (ver D-C02-3).
