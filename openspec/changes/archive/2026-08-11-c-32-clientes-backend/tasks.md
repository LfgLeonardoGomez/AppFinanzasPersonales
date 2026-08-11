## 1. Red de seguridad

- [x] 1.1 Correr la suite completa y registrar el baseline (esperado: 952 passed). Un fallo previo se reporta como preexistente y NO se arregla acá.

## 2. Normalización (función pura, sin base)

- [x] 2.1 Test: "Juan Pérez", "juan perez" y "JUAN PEREZ" producen el mismo valor.
- [x] 2.2 Test: "  Juan   Pérez  " produce lo mismo que "Juan Pérez" (trim + colapso de espacios internos).
- [x] 2.3 Test (la mitad que protege contra fusiones): "Juan Perez" ≠ "Juan Peres" (sin fonética) y "Juan Pérez" ≠ "Pérez Juan" (sin reordenar). Estos casos clavan D2.
- [x] 2.4 Test: caracteres no latinos y la ñ sobreviven sin romperse (la ñ NO se convierte en n… verificar la decisión y dejarla explícita en el test).
- [x] 2.5 Implementar `app/core/normalizacion.py` con el orden de D1: strip → lower → NFKD sin diacríticos → colapso de espacios.

## 3. Modelo y migración 0008

- [x] 3.1 Test: `Cliente` se persiste con `negocio_id`, `nombre`, `nombre_normalizado`, opcionales en null, `creado_por_usuario_id` nullable y `deleted_at`.
- [x] 3.2 Test: `nombre` conserva mayúsculas y acentos tal cual se tipearon (D6).
- [x] 3.3 Crear `app/models/cliente.py` y registrarlo en `app/models/__init__.py`.
- [x] 3.4 Test de migración `0008`: crea la tabla, el índice **parcial** único `(negocio_id, nombre_normalizado) WHERE deleted_at IS NULL` y el índice por `negocio_id`; `downgrade` limpio; ciclo upgrade→downgrade→upgrade. Revisión fijada (`revision="0008"`, `down_revision="0007"`), nunca `head` (D-21).
- [x] 3.5 Test de migración: **el índice es parcial** — verificar que un cliente con `deleted_at` poblado NO bloquea el alta de otro con el mismo nombre normalizado (D3). Es la mitad del contrato que un índice único común no da.
- [x] 3.6 Escribir `alembic/versions/20240008_0008_cliente.py`.

## 4. Repository

- [x] 4.1 Test: `get_by_nombre_normalizado` encuentra al activo y **ignora a los eliminados**.
- [x] 4.2 Test: `buscar` ordena la coincidencia exacta normalizada antes que las de "contiene".
- [x] 4.3 Test: `buscar` y el listado no cruzan negocios.
- [x] 4.4 Implementar `app/repositories/cliente_repository.py`.

## 5. Service

- [x] 5.1 Test: `crear` deriva `nombre_normalizado` y **ignora** un `nombre_normalizado` que venga en los datos.
- [x] 5.2 Test: `crear` con nombre equivalente levanta 409 e incluye id y nombre del existente (D5).
- [x] 5.3 Test: dos negocios pueden tener el mismo nombre sin conflicto.
- [x] 5.4 Test: `actualizar` recalcula la normalización, y renombrar hacia una colisión levanta 409 sin modificar nada.
- [x] 5.5 Test: `eliminar` es soft delete y **libera el nombre** — se puede crear otro cliente con el mismo nombre después.
- [x] 5.6 Test: cliente de otro negocio → 404 en get, actualizar y eliminar.
- [x] 5.7 Test (carrera, D4): un `IntegrityError` del índice se traduce a 409, no a 500. Simular insertando directo el duplicado antes del flush.
- [x] 5.8 Implementar `app/services/cliente_service.py`: chequeo previo para el mensaje + captura de `IntegrityError` como respaldo.

## 6. Schemas y router

- [x] 6.1 Test: `ClienteCreate` no acepta `nombre_normalizado`, `negocio_id` ni `id`; `nombre` vacío o solo espacios → 422.
- [x] 6.2 Test de integración: alta mínima solo con nombre → 201; el payload no puede fijar `negocio_id`.
- [x] 6.3 Test de integración: `GET /api/clientes?buscar=` responde con el orden esperado y sin cruzar negocios.
- [x] 6.4 Test de integración: 409 en el alta duplicada trae `cliente_existente` con id y nombre.
- [x] 6.5 Test de integración: sin sesión → 401; usuario `desactivado` → 401.
- [x] 6.6 Test de integración: `/api/clientes` y `/api/clientes/` responden igual, sin 307 (contrato C-27).
- [x] 6.7 Implementar `app/schemas/cliente.py` y `app/routers/clientes.py`; registrar el router en `app/main.py`.

## 7. Cierre

- [x] 7.1 Verificar que el guard de eje (`test_c28_scoping_axis_guard`) siga verde con los módulos nuevos; si señala algo, **renombrar** en vez de ampliar la lista blanca.
- [x] 7.2 Correr la suite completa y comparar contra el baseline de 1.1; reportar cualquier aserción debilitada con su justificación.
- [x] 7.3 Actualizar `knowledge-base/04_modelo_de_datos.md` (§Cliente) y `03_actores_y_roles.md` (rutas) si el resultado se apartó de lo documentado.
- [x] 7.4 Registrar en `09_decisiones_y_supuestos.md`: normalización conservadora y por qué, e índice único **parcial** para que el soft delete libere el nombre.
- [x] 7.5 Marcar C-32 en `CHANGES.md` y dejar anotada la deuda abierta: no hay herramienta para fusionar dos clientes duplicados.
