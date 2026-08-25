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

- [ ] 1.1 Verificar que Docker está levantado (`docker ps`) **antes** de correr nada.
- [ ] 1.2 Correr el suite completo de backend y anotar acá la línea `N passed` **copiada de la corrida**, no de memoria. Cualquier fallo es **preexistente**: reportarlo y NO arreglarlo en este change.
- [ ] 1.3 Anotar el conteo de `tests/test_c28_scoping_axis_guard.py` **antes** de agregar el servicio nuevo, y de nuevo al final. Va a subir. Anotar los dos números para que el cambio sea explicable y no una sorpresa.

## 2. Bucketing de períodos — lógica pura

> Todo este grupo es aritmética de fechas, sin base de datos. Es la pieza compartida por las dos fuentes (design.md D1), así que se testea sola.

- [ ] 2.1 Test: para un rango y una granularidad, la función que enumera períodos devuelve la lista **completa** de períodos que lo abarcan, cada uno con su fecha de inicio y de fin. Triangular con las tres granularidades.
- [ ] 2.2 Test: un rango que arranca a mitad de un período incluye ese período **entero** en la enumeración, con su inicio real. Un mes que empieza el 15 sigue siendo el mes.
- [ ] 2.3 Test: **la semana empieza el lunes** (D4). Verificable por mutación: cambiarlo a domingo hace fallar el test con las fechas de inicio corridas un día.
- [ ] 2.4 Test: un rango de un solo día devuelve exactamente un período en las tres granularidades.
- [ ] 2.5 Test: un rango invertido (`desde` posterior a `hasta`) se rechaza; no devuelve lista vacía en silencio.
- [ ] 2.6 Implementar el enumerador de períodos. **Sin conversión de zona horaria** — las fechas de los movimientos son columnas `date` y convertirlas desplazaría movimientos de bucket (D2 del proposal). Dejarlo escrito en el módulo, porque es exactamente el "arreglo" que alguien va a querer agregar.

## 3. Relleno de períodos vacíos

- [ ] 3.1 Test: dada la enumeración de períodos y un resultado de agregación con **huecos**, el relleno produce la serie completa con `0` en los períodos ausentes.
- [ ] 3.2 Test (triangulación): un hueco **al principio** y otro **al final** del rango también se rellenan, no solo los del medio.
- [ ] 3.3 Test: un rango entero sin ningún dato produce todos los períodos en cero, **no** una lista vacía.
- [ ] 3.4 Test: el orden de la serie es cronológico ascendente, independientemente del orden en que la base devolvió las filas.
- [ ] 3.5 Implementar el relleno. Documentar **por qué vive en el backend y no en el cliente**: el backend es el único que sabe qué períodos debería haber; el cliente solo ve lo que llegó, y una serie con huecos se grafica como una tendencia inventada, sin error visible en ningún lado.

## 4. Agregación de compras

- [ ] 4.1 Test: suma `factura.monto_total` agrupado por período, para el negocio de la sesión.
- [ ] 4.2 **Test de la trampa de dominio (D3):** registrar una factura y **pagarla**; el total de compras del período la incluye **una sola vez** y el pago no lo altera. Verificable por mutación: sumar `pago.monto` a la agregación hace fallar el test.
- [ ] 4.3 Test: una factura dada de baja **no** cuenta. Verificable por mutación: quitar el filtro de soft delete hace fallar el test.
- [ ] 4.4 Test: acotar por `proveedor_id` deja solo las compras de ese proveedor. Triangular con dos proveedores y verificar que el total de cada uno suma el total sin filtro.
- [ ] 4.5 Test: un `proveedor_id` de **otro negocio** responde **404**, nunca 403 (Regla Dura #3).
- [ ] 4.6 Test: los movimientos del **borde** del período cuentan en el período correcto — uno fechado el primer día y otro el último. Es el test que atrapa un desplazamiento de zona horaria si alguien la agrega.
- [ ] 4.7 Implementar la agregación de compras. **Un solo query con `GROUP BY`**; prohibido traer filas y sumar en Python — eso convierte una consulta barata en un problema de memoria sobre 1 GB.

## 5. Agregación de ventas y su desglose

- [ ] 5.1 Test: suma `venta.monto` agrupado por período, para el negocio de la sesión.
- [ ] 5.2 **Test de la trampa que motiva todo el grupo (D3):** registrar una venta en cuenta corriente y **cobrarla completa**; el total de ventas la incluye **una sola vez**, en el período de la venta. Verificable por mutación: incluir `cobro_cliente` en la agregación hace fallar el test. Es el error más fácil de cometer acá y el que menos se nota: el número queda más alto, pero plausible.
- [ ] 5.3 Test: el desglose por `forma_pago` de cada período **suma exactamente el total** de ese período. Triangular con un período que tenga las cinco formas de pago.
- [ ] 5.4 Test: la venta en cuenta corriente aparece en el desglose como una forma de pago más, cobrada o no.
- [ ] 5.5 Test: una venta dada de baja no cuenta, ni en el total ni en el desglose.
- [ ] 5.6 Test: los movimientos del borde del período cuentan en el período correcto (mismo criterio que 4.6).
- [ ] 5.7 Implementar la agregación de ventas con su desglose, en un solo query.

## 6. El tope de períodos

- [ ] 6.1 Test: un rango que produciría más períodos que el tope se rechaza con **422**, informando cuántos períodos produciría y sugiriendo granularidad más gruesa o rango más corto.
- [ ] 6.2 Test: ese mismo rango con granularidad más gruesa funciona normalmente.
- [ ] 6.3 Test: al exceder el tope **no se devuelve ninguna serie, ni recortada**. Una respuesta truncada en silencio se ve bien y está mal.
- [ ] 6.4 Test: el tope se evalúa sobre la **cantidad de períodos**, no sobre la longitud del rango — cinco años por mes pasan, cinco años por día no.
- [ ] 6.5 Implementar el tope. Arrancar conservador y dejar anotado que el valor definitivo se fija **midiendo**, no a ojo (design.md Open Questions).

## 7. Service y contraste

- [ ] 7.1 Test: el `resumen` devuelve compras, ventas y su diferencia para el mismo rango.
- [ ] 7.2 **Test que importa (D6):** las compras y las ventas del `resumen` son **idénticas** a las que devuelven los endpoints individuales para ese rango. Es lo que hace de la coincidencia una propiedad verificada y no una casualidad que hoy se sostiene.
- [ ] 7.3 Test: el `resumen` **no** expone margen, rentabilidad ni ganancia. El sistema no sabe cuánto costó la mercadería vendida; un número con nombre contable que no está calculado como tal se usa para decidir y no debería.
- [ ] 7.4 Test: las tres agregaciones están aisladas por negocio — dos negocios con ventas el mismo día, cada uno ve solo lo suyo. Verificable por mutación: quitar el filtro por `negocio_id` hace fallar el test mostrando el total inflado. **Una filtración acá no se ve**: no aparece un registro ajeno, aparece un número más alto.
- [ ] 7.5 Implementar `EstadisticasService` en `app/services/`, componiendo el `resumen` a partir de las dos agregaciones — **sin query propia** (D6).

## 8. Router

- [ ] 8.1 Test end-to-end: `GET /api/estadisticas/ventas` con rango y granularidad devuelve la serie con su desglose.
- [ ] 8.2 Test end-to-end: `GET /api/estadisticas/compras`, con y sin `proveedor_id`.
- [ ] 8.3 Test end-to-end: `GET /api/estadisticas/resumen`.
- [ ] 8.4 Test: una `granularidad` no soportada responde **422**.
- [ ] 8.5 Test: sin sesión responde **401**, antes que cualquier otra verificación.
- [ ] 8.6 Implementar `app/routers/estadisticas.py` y montarlo en `main.py`. Cero lógica de decisión en el router: arma parámetros, delega, devuelve.

## 9. Performance

- [ ] 9.1 Verificar el plan de ejecución de las dos agregaciones contra un volumen realista de datos. Anotar acá el resultado **medido**.
- [ ] 9.2 Decidir con ese plan —no antes— si hace falta un índice compuesto `(negocio_id, fecha)`. Agregarlo preventivamente es costo de escritura a cambio de una suposición. Si se agrega, va con migración propia y con el plan que lo justifica anotado.

## 10. Cierre y documentación

- [ ] 10.1 Correr el suite completo y anotar el número final medido.
- [ ] 10.2 Anotar el conteo final de `test_c28_scoping_axis_guard.py` y contrastarlo con el de 1.3. Subió porque se agregó un servicio: **explicable, no sorpresa**.
- [ ] 10.3 Verificar que **no se tocó** ni un archivo de `facturas-proveedores-web`.
- [ ] 10.4 Documentar en `knowledge-base/09_decisiones_y_supuestos.md`, continuando la numeración: por qué el "motor único" es el bucketing y no un constructor de queries genérico; por qué un período vacío vale cero y se rellena en el backend; por qué cobros no entra en ventas y pagos no entra en compras; **por qué NO hay conversión de zona horaria acá pese a lo que pedía el roadmap**, y qué rompería agregarla; y por qué el `resumen` no calcula margen.
- [ ] 10.5 Sumar a `knowledge-base/05_reglas_de_negocio.md` las reglas de agregación: qué entra y qué no en cada total, y que el desglose siempre suma el total.
- [ ] 10.6 Actualizar `CLAUDE.md` y `CHANGES.md`. La fecha de archive **solo** cuando el archive real se ejecute (`/opsx:archive`), no antes.
