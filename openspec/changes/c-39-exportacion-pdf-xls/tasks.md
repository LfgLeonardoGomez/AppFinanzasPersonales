> **TDD estricto activo.** Toda task que nombra un comportamiento arranca en RED: escribir el test que falla, hacerlo pasar con lo mínimo, triangular con un segundo caso de entradas distintas, y recién ahí refactorizar. Los tests corren contra **Postgres real en contenedor**, nunca SQLite (Regla Dura #12).
>
> Comando de test backend: `cd facturas-proveedores-api && .venv/Scripts/python.exe -m pytest`
> Comando de test frontend: `cd facturas-proveedores-web && npm test`
>
> ⚠️ **El backend necesita Docker levantado.** Sin él `pytest` devuelve **1346 errors** — errores de *setup*, no fallos. Si aparece ese número, el diagnóstico es Docker abajo, no código roto. Verificar con `docker ps` antes de creer que se rompió algo.
>
> **Gobernanza MEDIO.** Implementar en pasos y surfacear las decisiones no obvias.
>
> **NO correr `npm run generate-types`.** `src/shared/api/api.d.ts` está escrito a mano; regenerarlo rompe 262 imports (C-41).
>
> ---
>
> ## Corriendo en paralelo con C-37
>
> C-39 y C-37 están los dos desbloqueados y se pueden trabajar en worktrees aislados. Superficie de conflicto, ya minimizada por design.md D4:
>
> - **`main.py`**: C-39 **no lo toca** (cuelga sus rutas de los routers existentes). Solo C-37 monta router nuevo. Cero conflicto.
> - **`pyproject.toml`**: los dos podrían sumar deps. C-39 suma dos líneas. Único punto de merge real, trivial.
> - **`tests/test_c28_scoping_axis_guard.py`**: es paramétrico sobre los archivos de `services/`. Los dos agregan un servicio, así que **los dos mueven el conteo de tests colectados**. Es esperado, lo dice `CLAUDE.md` — no es que uno rompió al otro.

---

## 1. Red de seguridad

- [ ] 1.1 Verificar que Docker está levantado (`docker ps`) **antes** de correr nada. Sin contenedor no hay Postgres y la suite entera falla en setup, lo que se lee como código roto y no lo es.
- [ ] 1.2 Correr el suite completo de backend y anotar acá la línea `N passed` **copiada de la corrida**, no de memoria. Cualquier fallo es **preexistente**: reportarlo y NO arreglarlo en este change.
- [ ] 1.3 Correr el suite completo de frontend y anotar la línea medida. Anotar también si `PropuestaIAModal.e2e.test.tsx` (countdown del 429) aparece en rojo: quedó marcado como **intermitente** al cerrar C-43, así que su estado acá es dato, no alarma.
- [ ] 1.4 Anotar el conteo de `tests/test_c28_scoping_axis_guard.py` **antes** de agregar el servicio nuevo. Va a subir cuando se agregue. Anotar los dos números para que el cambio sea explicable y no una sorpresa.

## 2. Dependencias y arranque

- [ ] 2.1 Sumar `fpdf2` y `xlsxwriter` a `pyproject.toml` (design.md D3), con un comentario de por qué esas y no `weasyprint`/`reportlab`/`openpyxl`: el VPS tiene **1 GB de RAM** y no admite librerías que arrastren binarios de sistema. Reconstruir la imagen y verificar que ambas importan dentro del contenedor.
- [ ] 2.2 Test: las dos librerías importan y generan un archivo mínimo válido en el entorno de test. Es un smoke test de entorno, no de negocio: si la imagen no las trae, todo lo demás falla por una razón que no tiene nada que ver.

## 3. El armador del documento — datos, sin formato

> Todo este grupo es lógica pura sobre la respuesta del service de cuenta corriente. Sin I/O, sin PDF, sin XLSX. Es la parte donde vive la regla que importa (D1/D2), así que se testea aislada de la generación de archivos.

- [ ] 3.1 Test: el armador toma la respuesta de cuenta corriente **tal como la devuelve el service** y produce un encabezado con nombre del negocio, nombre de la cuenta, fecha de emisión y saldo. No consulta nada por su cuenta.
- [ ] 3.2 Test: sin `incluir_historial`, el resultado no tiene ninguna fila de movimiento.
- [ ] 3.3 Test (triangulación): con `incluir_historial` y sin rango, el resultado tiene **todas** las filas del historial, en el mismo orden y con los mismos `saldo_acumulado` que trajo el service. Verificable por mutación: alterar cualquier monto en el armador hace fallar el test.
- [ ] 3.4 Test: con rango, el resultado contiene **solo** las filas cuya fecha cae dentro, y los bordes (`desde` y `hasta` exactos) **están incluidos**. Triangular con una fila justo un día antes y otra justo un día después.
- [ ] 3.5 **Test del corazón de D2:** con rango, el resultado abre con `saldo_anterior` igual al `saldo_acumulado` de la última fila **anterior** a `desde`. Verificable por mutación: tomar la fila `i` en vez de `i-1` hace fallar el test.
- [ ] 3.6 Test (triangulación de 3.5): si no hay ninguna fila anterior a `desde`, `saldo_anterior` es **cero**, no `None` ni el saldo total.
- [ ] 3.7 **Test de reconciliación aritmética:** `saldo_anterior` + la suma con signo de los movimientos del rango == el `saldo_acumulado` de la última fila del rango. Este es el test que prueba que el documento *cierra solo*; los anteriores prueban que tiene los datos. No es lo mismo.
- [ ] 3.8 Test: el `saldo` del encabezado es el de la cuenta **completa** y NO cambia al aplicar un rango (spec: "un filtro de fechas no mueve el saldo del encabezado"). Verificable por mutación: hacer que el encabezado use el saldo del rango hace fallar el test.
- [ ] 3.9 Test: cuando `hasta` es anterior a hoy, el resultado expone **dos** saldos rotulados con su fecha — el del cierre del rango y el actual (D2).
- [ ] 3.10 Test: un rango sin movimientos produce encabezado + `saldo_anterior` + cero filas, **sin error**. Es un resultado válido, no un caso de falla.
- [ ] 3.11 Implementar el armador. Recibe la respuesta del service ya construida; **no importa ningún repositorio, ningún motor FIFO y ninguna sesión de base**. Esa restricción es la que hace estructuralmente imposible que el export diverja de la pantalla (D1) — dejarla escrita en el módulo.

## 4. Generación de archivos

- [ ] 4.1 Test: el generador XLSX produce un archivo que se puede volver a abrir y cuyas celdas contienen los montos del armador. Un test que solo verifica que hay bytes no prueba nada.
- [ ] 4.2 Test (triangulación): un documento sin historial y uno con historial producen distinta cantidad de filas, y el sin-historial igual trae el encabezado.
- [ ] 4.3 Test: el generador PDF produce un PDF válido y no vacío, y su texto extraíble contiene el nombre de la cuenta y el saldo. Verificar contenido, no tamaño.
- [ ] 4.4 Test: con rango, el PDF y el XLSX **ambos** muestran la fila de saldo anterior. Es requisito del documento, no del formato.
- [ ] 4.5 Implementar los dos generadores. El XLSX usa `constant_memory` (escritura fila por fila, sin retener la hoja) — es la propiedad que importa en 1 GB, no una optimización opcional.
- [ ] 4.6 Test: el nombre de archivo incluye tipo, nombre de cuenta y fecha, y está normalizado. Triangular con un nombre con acentos y espacios: el resultado no los contiene y sigue siendo un nombre válido.

## 5. El tope de tamaño

- [ ] 5.1 Test: una cuenta cuyo historial excede el tope del formato se rechaza con **422**, y el mensaje incluye la cantidad real de movimientos y la sugerencia de acotar el rango. Verificable por mutación: bajar el tope a 1 en el test tiene que producir el 422, no un documento.
- [ ] 5.2 Test: acotar el rango por debajo del tope destraba la exportación de esa misma cuenta.
- [ ] 5.3 Test: al exceder el tope **no se devuelve ningún documento, ni parcial**. Un documento al que le faltan filas sin avisar se ve bien y está mal — es la peor salida posible.
- [ ] 5.4 Test: los topes de PDF y XLSX son **distintos**, porque los dos formatos no consumen igual (D5).
- [ ] 5.5 Implementar el tope. Arrancar conservador y dejar anotado en el código que el valor definitivo se fija **midiendo contra el contenedor real**, no a ojo (design.md Open Questions).

## 6. Service de exportación y autorización

- [ ] 6.1 Test: el service llama al service de cuenta corriente que ya existe y **no** abre queries propias. Verificable estructuralmente, en el espíritu del guard de C-28: el módulo no importa repositorios ni el motor FIFO.
- [ ] 6.2 **Test que importa:** exportar una cuenta y pedir esa misma cuenta por el endpoint de cuenta corriente devuelven **el mismo saldo y los mismos movimientos**. Es el test que hace de la coincidencia una propiedad verificada y no una promesa.
- [ ] 6.3 Test: exportar la cuenta de un cliente de **otro negocio** devuelve **404**, nunca 403 (Regla Dura #3). Triangular con proveedor ajeno.
- [ ] 6.4 Test: una cuenta inexistente devuelve 404, **indistinguible** del caso anterior. Un 403 confirmaría que el recurso existe.
- [ ] 6.5 Test: la verificación de pertenencia corre **antes** de generar nada — un recurso ajeno no llega a producir bytes.
- [ ] 6.6 Implementar `ExportacionCuentaCorrienteService` en `app/services/`. La autorización va acá, **nunca** en el router (Regla Dura #8).

## 7. Rutas

- [ ] 7.1 **Declarar las rutas ANTES de `/{id}`** en `proveedores.py` y `clientes.py`, junto a la ruta de cuenta corriente que ya tiene ese comentario (D4). Es un fallo **silencioso**: declarada después, la ruta no rompe el arranque, simplemente nunca se alcanza y el endpoint devuelve otra cosa.
- [ ] 7.2 Test end-to-end: `GET .../cuenta-corriente/export?formato=pdf` devuelve un PDF con su `Content-Type` y su `Content-Disposition`. Pegarle a la **ruta real**, no verificar que el router la tenga registrada — eso no detecta el orden.
- [ ] 7.3 Test end-to-end: el mismo endpoint con `formato=xlsx` devuelve una planilla.
- [ ] 7.4 Test: un `formato` no soportado responde **422**.
- [ ] 7.5 Test: pasar `desde`/`hasta` con `incluir_historial=false` responde **422**, y NO se ignora en silencio (spec). Un documento sin filas ante un pedido de rango se lee como bug del sistema.
- [ ] 7.6 Test: sin sesión responde **401**, antes que cualquier otra verificación.
- [ ] 7.7 Implementar las dos rutas. Cero lógica de decisión en el router: arma los parámetros, delega, devuelve.
- [ ] 7.8 Verificar que **no se tocó `main.py`** — C-39 no monta router nuevo, y eso es lo que le da superficie de conflicto cero con C-37.

## 8. Frontend — API y disparo de descarga

- [ ] 8.1 Test: la función de export pide el archivo como blob y **no** transforma su contenido. Es transporte, no lógica.
- [ ] 8.2 Test: usa el nombre de archivo que indica el backend, y no uno compuesto en el cliente.
- [ ] 8.3 Test: los parámetros omitidos **no viajan** — sin rango no se mandan `desde`/`hasta` vacíos. Triangular con rango completo.
- [ ] 8.4 Implementar en la capa de API del frontend. Sin `Idempotency-Key`: es una lectura, no una escritura (C-43 protege escrituras; mandar la clave acá sugeriría una garantía que no aplica).

## 9. Frontend — el formulario

- [ ] 9.1 Test: las dos vistas de cuenta corriente muestran la acción de exportar. Triangular con una cuenta de saldo cero: sigue disponible (spec).
- [ ] 9.2 Test: sin historial incluido, los controles de rango **no están disponibles**. Al marcar la inclusión, aparecen vacíos.
- [ ] 9.3 Test: un rango invertido (inicio posterior al fin) se señala y **no se envía**. Ofrecer un control cuyo efecto es un error es peor que no ofrecerlo.
- [ ] 9.4 Test: mientras la exportación está en curso, la interfaz lo indica y la acción **no se puede volver a disparar**. Sin esa señal la persona vuelve a apretar y dispara un trabajo pesado por segunda vez sobre un proceso de 1 GB.
- [ ] 9.5 **Test del caso que más importa:** ante el 422 por exceder el tope, se muestra el **motivo que informó el backend** —con la cantidad de movimientos y la sugerencia de acotar— y NO un error genérico. Ese mensaje está escrito para que la persona pueda actuar; reemplazarlo por "no se pudo exportar" convierte un problema con solución en una pared.
- [ ] 9.6 Test: tras una falla, la acción vuelve a estar disponible con las opciones elegidas **intactas**.
- [ ] 9.7 Implementar el formulario y cablearlo en las dos vistas.

## 10. Cierre y documentación

- [ ] 10.1 Correr los dos suites completos y anotar los números finales medidos. Verificar `npx tsc --noEmit` y `npx eslint src --ext .ts,.tsx --max-warnings 0` limpios.
- [ ] 10.2 Anotar el conteo final de `test_c28_scoping_axis_guard.py` y contrastarlo con el de 1.4. Subió porque se agregó un servicio: **explicable, no sorpresa**.
- [ ] 10.3 Verificar que **no se tocó** `src/shared/api/api.d.ts` y que **no se corrió** `npm run generate-types`.
- [ ] 10.4 Documentar en `knowledge-base/09_decisiones_y_supuestos.md`, continuando desde D-74: por qué el export reutiliza el service en vez de tener queries propias; por qué con rango hace falta el saldo anterior y por qué ese número se **lee** en vez de calcularse; por qué `fpdf2`/`xlsxwriter` y no las alternativas conocidas, con el 1 GB como razón; por qué hay tope de filas en vez de job asíncrono; y por qué las rutas van antes de `/{id}`.
- [ ] 10.5 Sumar a `knowledge-base/05_reglas_de_negocio.md` la regla de que un documento exportado con rango tiene que reconciliar consigo mismo, y que el saldo del encabezado es siempre el de la cuenta completa.
- [ ] 10.6 Actualizar `CLAUDE.md` y `CHANGES.md`. La fecha de archive **solo** cuando el archive real se ejecute (`/opsx:archive`), no antes.
