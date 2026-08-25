## Why

El sistema registra cada compra y cada venta, pero no sabe contestar la pregunta más simple que un negocio se hace: **"¿cuánto vendí este mes?"**, **"¿cuánto le compré a este proveedor?"**, **"¿estoy ganando o perdiendo?"**. Los datos están todos; lo que falta es agregarlos.

D-55 dejó esto explícitamente para acá. Cuando C-33 entregó ventas era tentador agregar un `GET /api/ventas/resumen` porque la pantalla lo iba a querer, y se decidió no adelantar una suma ad-hoc: garantizaba dos implementaciones del mismo concepto y que algún día dieran números distintos. Este change paga esa deuda con **un solo motor**, no con tres endpoints que suman por su cuenta.

## What Changes

- **Tres endpoints de estadísticas**, todos de solo lectura y por agregación SQL:
  - `GET /api/estadisticas/compras?proveedor_id&desde&hasta&granularidad` — total comprado por período, opcionalmente acotado a un proveedor.
  - `GET /api/estadisticas/ventas?desde&hasta&granularidad` — total vendido por período, **con desglose por forma de pago**.
  - `GET /api/estadisticas/resumen?desde&hasta` — compras contra ventas en el mismo período.
- **Granularidad** `dia` | `semana` | `mes`, con la semana empezando el **lunes** (norma ISO, y lo que Postgres hace de fábrica).
- **Los períodos sin movimiento devuelven cero, no se omiten.** Un período ausente en una serie temporal hace que el gráfico de la pantalla junte dos fechas no consecutivas con una línea recta, y eso no es un hueco: es una tendencia inventada.
- **Todo se calcula on-demand por agregación** (RN-VTA-05, D-01). Ninguna columna nueva, ninguna tabla de totales, ningún cacheo.
- **Un query por endpoint**, sin N+1.
- **CORRECCIÓN AL SCOPE ORIGINAL** — el roadmap pedía tests de "zona horaria UTC-3 en los cortes de período". **Ese problema no existe**: `venta.fecha` y `factura.fecha_emision` son columnas `date`, no `datetime`. Una fecha no tiene zona horaria, así que agrupar por día/semana/mes es aritmética de fechas pura. Peor: **agregar una conversión de zona horaria acá introduciría un desplazamiento** que movería de bucket a los movimientos cercanos a medianoche. UTC-3 sigue importando donde ya importaba —decidir si una fecha es futura— y no acá.

## Capabilities

### New Capabilities
- `estadisticas-backend`: qué totales expone el sistema, cómo se agrupan por período, qué entra y qué **no** entra en cada agregación, y por qué un período vacío vale cero.

### Modified Capabilities

Ninguna. Los endpoints de ventas, facturas, pagos y cobros no cambian su contrato: las estadísticas **leen** las mismas filas y no alteran ninguna respuesta existente.

## Impact

- **Backend** (`facturas-proveedores-api`):
  - Un router nuevo (`estadisticas.py`) montado en `main.py`, y un servicio nuevo.
  - **Sin dependencias nuevas.** Todo se resuelve con agregación de SQLModel/SQLAlchemy sobre lo que ya existe.
  - Aislamiento por `negocio_id` en el service layer, como todo el resto (Regla Dura #3 y #8).
  - `tests/test_c28_scoping_axis_guard.py` es paramétrico sobre los archivos de `services/`: sumar un servicio **mueve el conteo de tests colectados**. Es esperado, no una falla.
- **Sin migración.** Ninguna tabla cambia. Es todo lectura.
- **Sin frontend.** C-38 es quien dibuja esto; C-37 entrega los números.
- **Trampa de dominio que el diseño tiene que blindar**: un cobro de cuenta corriente **no es una venta** (RN-VTA-04) y una factura de proveedor **no es un pago**. Sumar plata que entra —ventas más cobros— duplica la facturación, porque el fiado ya se contó como venta el día que salió la mercadería. Es el error más fácil de cometer acá y el más difícil de detectar mirando un número.
- **Riesgo**: un rango de años con granularidad diaria produce miles de períodos en una sola respuesta, sobre un VPS de 1 GB. El tratamiento va en `design.md`.
