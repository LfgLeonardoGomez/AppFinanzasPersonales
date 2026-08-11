## Why

Todo el sistema hoy mira una sola dirección: lo que el negocio le debe a sus proveedores. Falta la otra mitad, que es la que el dueño anota en una libreta: **quién le debe a él**.

`Cliente` es el primer ladrillo de eso. No entrega valor visible por sí solo —sin ventas no hay nada que deber— pero define la entidad sobre la que se apoyan C-33 (ventas) y C-35 (cuenta corriente de clientes), y sobre todo fija ahora la regla que más cara sale si se posterga: **cómo se evitan los clientes duplicados**.

Un "Juan Perez" y un "Juan Pérez" en la misma libreta son dos cuentas corrientes distintas, y la deuda de Juan queda partida en dos. Eso no es un detalle de prolijidad: destruye lo único que la funcionalidad tiene que garantizar.

## What Changes

- **Entidad `Cliente`**: `negocio_id`, `nombre`, `nombre_normalizado`, `telefono?`, `notas?`, soft delete. Nace ya scopeada por `negocio_id` (C-28), como corresponde a toda tabla nueva de esta etapa.
- **Normalización derivada en el service layer**: minúsculas, sin acentos, espacios colapsados. **Nunca se acepta desde el payload** — es un dato calculado, no de entrada.
- **Índice único `(negocio_id, nombre_normalizado)`**: dos clientes equivalentes no pueden coexistir en el mismo negocio. La garantía vive en la base, no en la buena voluntad del código.
- **`GET /api/clientes?buscar=`**: autocompletado. Coincidencia exacta normalizada primero, "contiene" después — mismo criterio que RN-VINC usa para proveedores.
- **CRUD completo** aislado por `negocio_id`, con `nombre` como único campo obligatorio en el alta.
- **Migración `0008`** (número reservado de entrada para no chocar con C-31).

**Fuera de alcance**: ventas (C-33), cuenta corriente y cobros (C-35), y todo el frontend (C-34). Este change entrega la entidad y su unicidad, nada más.

## Capabilities

### New Capabilities
- `clientes-backend`: la entidad `Cliente`, su unicidad normalizada por negocio, la búsqueda que alimenta el autocompletado, y el CRUD aislado.

## Impact

**Backend**: `app/models/cliente.py`, `app/repositories/cliente_repository.py`, `app/services/cliente_service.py`, `app/routers/clientes.py`, `app/schemas/cliente.py`, migración `0008`. No toca proveedores, facturas, pagos ni equipo.

**Riesgo — la normalización es una decisión de una sola vez.** El índice único congela qué significa "el mismo cliente". Si mañana se cambia la función de normalización, las filas viejas quedan con un `nombre_normalizado` calculado con la regla anterior y el índice deja de proteger lo que promete. Cambiarla después exige recalcular toda la tabla dentro de una migración. Por eso la regla se fija acá, con tests que la clavan.

**Riesgo — normalizar de más.** Si la normalización fuera demasiado agresiva (por ejemplo, ignorando apellidos o colapsando "Juan Perez" con "Juan Peres"), dos clientes **realmente distintos** quedarían fusionados y el negocio vería la deuda de uno mezclada con la del otro. Es el error simétrico y más peligroso que el duplicado: un duplicado se nota y se corrige, una fusión silenciosa no. La normalización se mantiene deliberadamente conservadora: mayúsculas, acentos y espacios, nada más.

**Riesgo — el choque de unicidad llega al usuario.** Cuando el índice rechaza un alta, el empleado está parado frente al mostrador. La respuesta tiene que decirle **cuál** es el cliente existente para que lo elija, no un error de base de datos.

**Governance: MEDIO.** Es una entidad de negocio nueva; no toca auth ni el aislamiento, que ya están cerrados.
