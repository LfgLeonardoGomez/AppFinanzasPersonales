> **TDD estricto activo.** Toda task que nombra un comportamiento arranca en RED: escribir el test que falla, hacerlo pasar con lo mínimo, triangular con un segundo caso de entradas distintas, y recién ahí refactorizar. Los tests corren contra **Postgres real en contenedor**, nunca SQLite (Regla Dura #12).
>
> Comando de test backend: `cd facturas-proveedores-api && .venv/Scripts/python.exe -m pytest`
>
> ⚠️ **Necesita Docker levantado.** Sin él `pytest` devuelve **1346 errors** — errores de *setup*, no fallos. Si aparece ese número, el diagnóstico es Docker abajo, no código roto. Verificar con `docker ps` antes de creer que se rompió algo.
>
> **Gobernanza MEDIO.** Implementar en pasos y surfacear las decisiones no obvias.
>
> **Backend puro.** Cero archivos de `facturas-proveedores-web`. C-38 dibuja esto.
>
> ---
>
> ## Corriendo en paralelo con C-39
>
> Los dos están desbloqueados y se pueden trabajar en worktrees aislados. Superficie de conflicto, ya minimizada:
>
> - **`main.py`**: **solo C-37 lo toca** (monta router nuevo). C-39 cuelga sus rutas de los routers existentes. Cero conflicto.
> - **`pyproject.toml`**: **C-37 no suma ninguna dependencia**; C-39 suma dos. Cero conflicto.
> - **`tests/test_c28_scoping_axis_guard.py`**: es paramétrico sobre los archivos de `services/`. Los dos agregan un servicio, así que **los dos mueven el conteo de tests colectados**. Es esperado, lo dice `CLAUDE.md` — no es que uno rompió al otro.

---

## 1. Red de seguridad

- [x] 1.1 Verificar que Docker está levantado (`docker ps`) **antes** de correr nada. Verificado (8 GB / 8 CPUs).
- [x] 1.2 Correr el suite completo de backend y anotar acá la línea `N passed` **copiada de la corrida**, no de memoria. Cualquier fallo es **preexistente**: reportarlo y NO arreglarlo en este change.
  - **`1346 passed, 3 warnings in 407.42s (0:06:47)`** — medido con `git stash` aplicado (árbol SIN los archivos de C-37), para que sea un baseline real y no uno con el código nuevo ya adentro. 0 fallos preexistentes.
- [x] 1.3 Anotar el conteo de `tests/test_c28_scoping_axis_guard.py` **antes** de agregar el servicio nuevo, y de nuevo al final. Va a subir. Anotar los dos números para que el cambio sea explicable y no una sorpresa.
  - **Antes: 40 tests colectados** (sin `estadisticas_engine.py`, `estadisticas_service.py` ni `estadisticas_repository.py`). Ver 10.2 para el número final.

## 2. Bucketing de períodos — lógica pura

> Todo este grupo es aritmética de fechas, sin base de datos. Es la pieza compartida por las dos fuentes (design.md D1), así que se testea sola.

- [x] 2.1 Test: para un rango y una granularidad, la función que enumera períodos devuelve la lista **completa** de períodos que lo abarcan, cada uno con su fecha de inicio y de fin. Triangular con las tres granularidades. — `tests/test_c37_estadisticas_engine.py::TestEnumerarPeriodosCubreElRango`
- [x] 2.2 Test: un rango que arranca a mitad de un período incluye ese período **entero** en la enumeración, con su inicio real. Un mes que empieza el 15 sigue siendo el mes. — `TestRangoAMitadDePeriodo`
- [x] 2.3 Test: **la semana empieza el lunes** (D4). Verificable por mutación: cambiarlo a domingo hace fallar el test con las fechas de inicio corridas un día. — `TestSemanaEmpiezaElLunes`. **Mutación verificada de verdad**: se cambió `_inicio_semana` a `fecha - timedelta(days=(fecha.weekday()+1) % 7)` (arranque domingo) y corrieron 4 tests que fallaron (`test_semana_devuelve_un_periodo_por_semana`, `test_semana_que_arranca_un_jueves...`, `test_inicio_de_semana_es_lunes`, `test_mutacion_a_domingo_correria_el_inicio_un_dia`), después se revirtió y los 18 tests del archivo volvieron a pasar.
- [x] 2.4 Test: un rango de un solo día devuelve exactamente un período en las tres granularidades. — `TestRangoDeUnSoloDia` (parametrizado)
- [x] 2.5 Test: un rango invertido (`desde` posterior a `hasta`) se rechaza; no devuelve lista vacía en silencio. — `TestRangoInvertido` (`RangoInvertido`)
- [x] 2.6 Implementar el enumerador de períodos. **Sin conversión de zona horaria** — las fechas de los movimientos son columnas `date` y convertirlas desplazaría movimientos de bucket (D2 del proposal). Dejarlo escrito en el módulo, porque es exactamente el "arreglo" que alguien va a querer agregar. — `app/services/estadisticas_engine.py::enumerar_periodos`, docstring del módulo lo deja explícito.

## 3. Relleno de períodos vacíos

- [x] 3.1 Test: dada la enumeración de períodos y un resultado de agregación con **huecos**, el relleno produce la serie completa con `0` en los períodos ausentes. — `TestRellenoDeHuecos::test_relleno_completa_periodos_ausentes_con_cero`
- [x] 3.2 Test (triangulación): un hueco **al principio** y otro **al final** del rango también se rellenan, no solo los del medio. — `test_hueco_al_principio_y_al_final_tambien_se_rellenan`
- [x] 3.3 Test: un rango entero sin ningún dato produce todos los períodos en cero, **no** una lista vacía. — `test_rango_entero_sin_datos_no_es_lista_vacia`
- [x] 3.4 Test: el orden de la serie es cronológico ascendente, independientemente del orden en que la base devolvió las filas. — `test_orden_cronologico_independiente_del_orden_de_entrada`
- [x] 3.5 Implementar el relleno. Documentar **por qué vive en el backend y no en el cliente**: el backend es el único que sabe qué períodos debería haber; el cliente solo ve lo que llegó, y una serie con huecos se grafica como una tendencia inventada, sin error visible en ningún lado. — `app/services/estadisticas_engine.py::rellenar_periodos`

## 4. Agregación de compras

- [x] 4.1 Test: suma `factura.monto_total` agrupado por período, para el negocio de la sesión. — `tests/test_c37_estadisticas_integration.py::TestAgregacionCompras::test_suma_monto_total_agrupado_por_periodo`
- [x] 4.2 **Test de la trampa de dominio (D3):** registrar una factura y **pagarla**; el total de compras del período la incluye **una sola vez** y el pago no lo altera. Verificable por mutación: sumar `pago.monto` a la agregación hace fallar el test. — `test_factura_pagada_cuenta_una_sola_vez_trampa_de_dominio`. **Mutación verificada de verdad**: se agregó una subquery correlacionada que suma `Pago.monto` al total de `totales_compras`; el test pasó de `300.00` esperado a `600.00` recibido y falló como se esperaba. Revertido y confirmado verde de nuevo.
- [x] 4.3 Test: una factura dada de baja **no** cuenta. Verificable por mutación: quitar el filtro de soft delete hace fallar el test. — `test_factura_eliminada_no_cuenta`. **Mutación verificada**: se comentó `.where(Factura.deleted_at.is_(None))`; el test pasó de `0.00` esperado a `80.00` recibido y falló. Revertido.
- [x] 4.4 Test: acotar por `proveedor_id` deja solo las compras de ese proveedor. Triangular con dos proveedores y verificar que el total de cada uno suma el total sin filtro. — `test_acotar_por_proveedor`
- [x] 4.5 Test: un `proveedor_id` de **otro negocio** responde **404**, nunca 403 (Regla Dura #3). — `test_proveedor_de_otro_negocio_da_404`
- [x] 4.6 Test: los movimientos del **borde** del período cuentan en el período correcto — uno fechado el primer día y otro el último. Es el test que atrapa un desplazamiento de zona horaria si alguien la agrega. — `test_movimientos_de_borde_cuentan_en_periodo_correcto`
- [x] 4.7 Implementar la agregación de compras. **Un solo query con `GROUP BY`**; prohibido traer filas y sumar en Python — eso convierte una consulta barata en un problema de memoria sobre 1 GB. — `app/repositories/estadisticas_repository.py::EstadisticasRepository.totales_compras`

## 5. Agregación de ventas y su desglose

- [x] 5.1 Test: suma `venta.monto` agrupado por período, para el negocio de la sesión. — `TestAgregacionVentas::test_suma_monto_agrupado_por_periodo`
- [x] 5.2 **Test de la trampa que motiva todo el grupo (D3):** registrar una venta en cuenta corriente y **cobrarla completa**; el total de ventas la incluye **una sola vez**, en el período de la venta. Verificable por mutación: incluir `cobro_cliente` en la agregación hace fallar el test. Es el error más fácil de cometer acá y el que menos se nota: el número queda más alto, pero plausible. — `test_fiado_cobrado_cuenta_una_sola_vez_trampa_de_dominio`. **Mutación verificada de verdad**: se agregó una subquery correlacionada sumando `CobroCliente.monto` a `totales_ventas`; el test pasó de `500.00` esperado a `1000.00` recibido y falló como se esperaba. Revertido y confirmado verde.
- [x] 5.3 Test: el desglose por `forma_pago` de cada período **suma exactamente el total** de ese período. Triangular con un período que tenga las cinco formas de pago. — `test_desglose_suma_el_total` (EFECTIVO, TRANSFERENCIA, TARJETA, OTRO, CUENTA_CORRIENTE — las cinco)
- [x] 5.4 Test: la venta en cuenta corriente aparece en el desglose como una forma de pago más, cobrada o no. — `test_cuenta_corriente_aparece_en_desglose`
- [x] 5.5 Test: una venta dada de baja no cuenta, ni en el total ni en el desglose. — `TestVentaEliminadaAislada::test_venta_eliminada_no_cuenta_ni_en_total_ni_en_desglose` (negocio propio, para que el `0.00` sea significativo)
- [x] 5.6 Test: los movimientos del borde del período cuentan en el período correcto (mismo criterio que 4.6). — `TestAgregacionVentas::test_movimientos_de_borde_cuentan_en_periodo_correcto` (con granularidad `semana`, para cubrir también el arranque-lunes del lado SQL)
- [x] 5.7 Implementar la agregación de ventas con su desglose, en un solo query. — `EstadisticasRepository.totales_ventas` (un `GROUP BY (periodo, forma_pago)`; el service arma total y desglose del mismo resultado, sin segunda query)

## 6. El tope de períodos

- [x] 6.1 Test: un rango que produciría más períodos que el tope se rechaza con **422**, informando cuántos períodos produciría y sugiriendo granularidad más gruesa o rango más corto. — `TestTopeDePeriodos::test_rango_largo_granularidad_diaria_se_rechaza_422`
- [x] 6.2 Test: ese mismo rango con granularidad más gruesa funciona normalmente. — `test_mismo_rango_granularidad_gruesa_funciona`
- [x] 6.3 Test: al exceder el tope **no se devuelve ninguna serie, ni recortada**. Una respuesta truncada en silencio se ve bien y está mal. — `test_al_exceder_tope_no_hay_serie_ni_recortada`
- [x] 6.4 Test: el tope se evalúa sobre la **cantidad de períodos**, no sobre la longitud del rango — cinco años por mes pasan, cinco años por día no. — `test_tope_es_sobre_cantidad_no_sobre_longitud_del_rango`
- [x] 6.5 Implementar el tope. Arrancar conservador y dejar anotado que el valor definitivo se fija **midiendo**, no a ojo (design.md Open Questions). — `estadisticas_engine.MAX_PERIODOS = 400`. Sigue siendo un punto de partida conservador (cubre ~13 meses diarios o ~33 años mensuales); el valor definitivo se ajusta con datos de producción reales, no acá.

## 7. Service y contraste

- [x] 7.1 Test: el `resumen` devuelve compras, ventas y su diferencia para el mismo rango. — `TestResumen::test_devuelve_compras_ventas_y_diferencia`
- [x] 7.2 **Test que importa (D6):** las compras y las ventas del `resumen` son **idénticas** a las que devuelven los endpoints individuales para ese rango. Es lo que hace de la coincidencia una propiedad verificada y no una casualidad que hoy se sostiene. — `test_coincide_con_los_totales_individuales`
- [x] 7.3 Test: el `resumen` **no** expone margen, rentabilidad ni ganancia. El sistema no sabe cuánto costó la mercadería vendida; un número con nombre contable que no está calculado como tal se usa para decidir y no debería. — `test_no_expone_margen_ni_rentabilidad` (asegura el set exacto de claves de la respuesta)
- [x] 7.4 Test: las tres agregaciones están aisladas por negocio — dos negocios con ventas el mismo día, cada uno ve solo lo suyo. Verificable por mutación: quitar el filtro por `negocio_id` hace fallar el test mostrando el total inflado. **Una filtración acá no se ve**: no aparece un registro ajeno, aparece un número más alto. — `test_aislamiento_por_negocio`. **Mutación verificada de verdad**: se comentó `.where(Venta.negocio_id == negocio_id)` en `totales_ventas`; el test esperaba `500.00` y recibió `1499.00` (la suma de TODAS las ventas creadas por otros negocios en la misma corrida de tests) — exactamente el síntoma que describe design.md: "no aparece un registro ajeno, aparece un número más alto". Revertido y confirmado verde.
  - Bonus no pedido explícitamente pero verificado: `test_no_tiene_tope_de_periodos_a_diferencia_de_compras_y_ventas` — cierra la decisión no obvia de que `resumen` NO aplica el tope D5 (no tiene `granularidad` ni devuelve períodos).
- [x] 7.5 Implementar `EstadisticasService` en `app/services/`, componiendo el `resumen` a partir de las dos agregaciones — **sin query propia** (D6). — `app/services/estadisticas_service.py::EstadisticasService.resumen`

## 8. Router

- [x] 8.1 Test end-to-end: `GET /api/estadisticas/ventas` con rango y granularidad devuelve la serie con su desglose. — `TestRouterEndToEnd::test_get_ventas_con_rango_y_granularidad`
- [x] 8.2 Test end-to-end: `GET /api/estadisticas/compras`, con y sin `proveedor_id`. — `test_get_compras_con_y_sin_proveedor`
- [x] 8.3 Test end-to-end: `GET /api/estadisticas/resumen`. — `test_get_resumen`
- [x] 8.4 Test: una `granularidad` no soportada responde **422**. — `test_granularidad_no_soportada_da_422` (validación automática de FastAPI sobre el enum `Granularidad`)
- [x] 8.5 Test: sin sesión responde **401**, antes que cualquier otra verificación. — `test_sin_sesion_da_401`
- [x] 8.6 Implementar `app/routers/estadisticas.py` y montarlo en `main.py`. Cero lógica de decisión en el router: arma parámetros, delega, devuelve. — hecho; `main.py` es el único archivo compartido con C-39 y solo se le agregaron 2 líneas (import + `include_router`).

## 9. Performance

- [x] 9.1 Verificar el plan de ejecución de las dos agregaciones contra un volumen realista de datos. Anotar acá el resultado **medido**.
  - **Medido** con un contenedor Postgres efímero, 50.000 facturas + 50.000 ventas en UN solo negocio (peor caso: el índice de `negocio_id` no descarta nada), rango 2020-01-01..2026-01-01, granularidad mensual:
    - `totales_compras`: `Bitmap Index Scan on ix_factura_negocio_id` → `Bitmap Heap Scan` → `GroupAggregate`. **Sin secuencial scan.** `Execution Time: 140.21 ms`.
    - `totales_ventas`: mismo patrón sobre `ix_venta_negocio_id`. **Sin secuencial scan.** `Execution Time: 93.88 ms`.
  - El filtro de rango de fechas corre como `Filter` post-índice (no está indexado por sí solo), pero sobre 50k filas de UN negocio (volumen muy por encima de lo que un comercio chico acumula en años) el tiempo total sigue bajo los 150 ms.
- [x] 9.2 Decidir con ese plan —no antes— si hace falta un índice compuesto `(negocio_id, fecha)`. Agregarlo preventivamente es costo de escritura a cambio de una suposición. Si se agrega, va con migración propia y con el plan que lo justifica anotado.
  - **Decisión: NO se agrega el índice compuesto.** El plan medido en 9.1 no muestra scan completo — el índice existente sobre `negocio_id` ya resuelve la selectividad dominante (un negocio nunca ve las filas de otro), y el filtro de fecha sobre ese subconjunto ya acotado ejecuta en el orden de 100 ms incluso en el caso patológico de 50k filas en un solo negocio. Agregar `(negocio_id, fecha)` hoy sería exactamente el costo de escritura sin problema medido que D7/9.2 piden evitar. Revisitar si datos de producción reales muestran un negocio con volumen bastante mayor y un plan degradado.

## 10. Cierre y documentación

- [x] 10.1 Correr el suite completo y anotar el número final medido.
  - **`1396 passed, 3 warnings in 411.46s (0:06:51)`** — corrida completa con TODO el árbol de C-37 adentro (post-`git stash pop`). Cuadra exacto contra el baseline de 1.2: `1346` (baseline) `+ 50` (`26` tests de `test_c37_estadisticas_integration.py` + `18` de `test_c37_estadisticas_engine.py` + `6` del delta de `test_c28_scoping_axis_guard.py`, ver 10.2) `= 1396`. 0 fallos.
- [x] 10.2 Anotar el conteo final de `test_c28_scoping_axis_guard.py` y contrastarlo con el de 1.3. Subió porque se agregó un servicio: **explicable, no sorpresa**.
  - **Final: 46 tests colectados** (antes: 40). +6 = 3 archivos nuevos en `services/`/`repositories/` (`estadisticas_engine.py`, `estadisticas_service.py`, `estadisticas_repository.py`) × 2 tests parametrizados cada uno (`test_no_usuario_id_as_scoping_filter` + `test_authorship_is_never_a_filter`). Los 46 pasan.
- [x] 10.3 Verificar que **no se tocó** ni un archivo de `facturas-proveedores-web`. — Confirmado con `git status`: cero archivos bajo `facturas-proveedores-web/` en el diff de este change.
- [x] 10.4 Documentar en `knowledge-base/09_decisiones_y_supuestos.md`, continuando la numeración: por qué el "motor único" es el bucketing y no un constructor de queries genérico; por qué un período vacío vale cero y se rellena en el backend; por qué cobros no entra en ventas y pagos no entra en compras; **por qué NO hay conversión de zona horaria acá pese a lo que pedía el roadmap**, y qué rompería agregarla; y por qué el `resumen` no calcula margen. — D-75 a D-79 agregadas.
- [x] 10.5 Sumar a `knowledge-base/05_reglas_de_negocio.md` las reglas de agregación: qué entra y qué no en cada total, y que el desglose siempre suma el total. — sección nueva "Dominio: Estadísticas (C-37)", RN-EST-01 a RN-EST-07.
- [x] 10.6 Actualizar `CLAUDE.md` y `CHANGES.md`. La fecha de archive **solo** cuando el archive real se ejecute (`/opsx:archive`), no antes. — hecho, sin fecha de archive.
