## Por qué

C-33 entregó el cargo: un fiado es una `Venta` con `forma_pago = CUENTA_CORRIENTE` y un `cliente_id`. Lo que no entregó es la otra mitad de una cuenta corriente — **el pago, y la respuesta a "¿cuánto me debe este cliente?"**. Hoy el negocio puede registrar que Juan se llevó mercadería fiada, y no tiene forma de registrar que Juan volvió y pagó, ni de ver cuánto queda.

Esa respuesta ya existe del otro lado del libro. `Proveedor : Factura : Pago` viene calculando saldo, estado FIFO e historial cronológico en producción desde C-12/C-13. `Cliente : Venta fiada : CobroCliente` es la misma forma, apuntando para el otro lado. Este change cierra el espejo.

## Qué Cambia

- **Entidad `CobroCliente`** (tabla `cobro_cliente`): `negocio_id`, `cliente_id` (requerido), `monto`, `fecha`, `metodo`, `comprobante_url?`, `creado_por_usuario_id`, soft delete. **Sin `venta_id`** (RN-CCC-03) — un pago se asocia al cliente, nunca a una venta puntual, exactamente como RN-PAG-01 rige para proveedores.
- **Enum `MetodoCobro`**: `EFECTIVO` / `TRANSFERENCIA` / `TARJETA` / `OTRO`. Sin `CUENTA_CORRIENTE`: la deuda no se cancela con deuda.
- **CRUD `/api/cobros`**, aislado por `negocio_id`, con un filtro opcional por `cliente_id`.
- **`GET /api/clientes/{cliente_id}/cuenta-corriente`** → `{ cliente_id, saldo, ventas_con_estado, historial }`, compuesto enteramente on-demand.
  - `saldo` = `SUM(fiados activos) − SUM(cobros activos)` (RN-CCC-01), nunca persistido.
  - `ventas_con_estado`: cada fiado vivo con un `estado` derivado por FIFO (RN-CCC-02).
  - `historial`: mezcla cronológica de débitos/créditos con un `saldo_acumulado` corriente por fila (RN-CCC-05).
- **Enum `EstadoVentaFiada`**: `PENDIENTE` / `PARCIAL` / `COBRADA`. Derivado, nunca una columna.
- **Sin saldo negativo (RN-CCC-04)**: un cobro cuyo monto exceda el saldo pendiente del cliente se rechaza en el service layer, tanto al crear **como** al editar.
- **Motor de asignación compartido**: el loop de asignación FIFO y la mezcla cronológica se mudan a un único módulo consumido por ambos lados. El comportamiento observable del motor de proveedores no cambia; ver design.md D1.
- **Saldo por cliente en el listado de clientes** — una query agregada que replica `get_saldo_por_proveedor`, para que C-36 pueda ordenar clientes por saldo sin N+1. Esto extiende el alcance escrito en `CHANGES.md`; está señalado en design.md D6 para aprobación explícita.
- **Migración `0011`** (`down_revision = "0010"`), fijada a una revisión explícita según D-21.

**Fuera de alcance**: frontend (C-36), agregaciones y estadísticas (C-37/C-38), exportación (C-39), extracción por IA de comprobantes, y cualquier cambio al comportamiento de proveedores.

## Capacidades

### Capacidades Nuevas
- `cuenta-corriente-clientes-backend`: la entidad `CobroCliente`, su CRUD aislado, la regla de no-saldo-negativo, la tripla on-demand (saldo, fiados con estado FIFO, historial cronológico) para un cliente, y el único motor de asignación compartido con el que ambos libros calculan.

## Impacto

**Backend, nuevo**: `app/models/cobro_cliente.py`, `app/repositories/cobro_cliente_repository.py`, `app/services/cobro_cliente_service.py`, `app/services/cuenta_corriente_engine.py`, `app/schemas/cobro_cliente.py`, `app/schemas/cuenta_corriente_cliente.py`, `app/routers/cobros.py`, migración `0011`.

**Backend, tocado**: `app/models/enums.py` (dos enums nuevos), `app/models/__init__.py`, `app/main.py` (registro del router), `app/routers/clientes.py` + `app/services/cliente_service.py` (la lectura de la cuenta corriente y el saldo en el listado), y los **cuerpos** de `factura_service._compute_estado_fifo` y `proveedor_service._build_historial`, que pasan a delegar en el motor compartido manteniendo idénticos su firma y sus resultados.

**No tocado**: `Venta` y `VentaService` son entradas de solo lectura acá. Proveedores, facturas, pagos y auth quedan intactos.

**Riesgo — una implementación de la aritmética del dinero, o dos.** Esta es la decisión sobre la que gira todo el change. Dos implementaciones de FIFO que responden "cuánto me debe este cliente" y "cuánto le debo a este proveedor" eventualmente van a discrepar sobre la misma aritmética, y el día que discrepen nadie va a poder decir cuál tiene razón. Una implementación compartida elimina eso, al precio de un refactor dentro de un motor de proveedores que corre en producción hace meses. La mitigación es que la costura es una función pura con 26 tests existentes que no requieren edición — si la extracción cambia algo, esos tests lo dicen.

**Riesgo — la invariante de "sin saldo negativo" se puede romper después del hecho.** RN-CCC-04 se aplica cuando se escribe un cobro. Pero C-33 permite hacer soft-delete de un fiado, y D-54 permite sacar una venta de `CUENTA_CORRIENTE` (lo cual limpia su cliente). Cualquiera de las dos acciones le quita un cargo a un cliente que ya fue acreditado, y puede dejar `SUM(cobros) > SUM(fiados)` — exactamente el estado que RN-CCC-04 dice que no puede existir. La KB enuncia la invariante en términos absolutos; el código entregado no puede sostenerla en términos absolutos. Ver design.md D4: este change reporta el saldo resultante con honestidad en vez de esconderlo, y la pregunta de si `VentaService` debería rechazar una edición así queda planteada, no decidida en silencio.

**Riesgo — un cobro es plata que el negocio dice haber recibido.** Si se calcula mal no se rompe una pantalla; le dice a un cliente que todavía debe plata que ya pagó, o al revés. El read path es el único lugar donde se arma la verdad, así que un error ahí es invisible hasta que alguien discute en el mostrador.

**Gobernanza: ALTO.** Sin auth y sin cambio al eje de aislamiento, pero esto cierra el círculo de la deuda de terceros: de acá en adelante, lo que el sistema dice que un cliente debe es lo que el negocio va a intentar cobrar.
