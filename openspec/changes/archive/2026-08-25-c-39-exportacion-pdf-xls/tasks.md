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

- [x] 1.1 `docker ps` verificado antes de correr nada — contenedor respondiendo (lista vacía pero el daemon respondió).
- [x] 1.2 Backend baseline (antes de cualquier cambio de C-39): **1346 passed, 3 warnings in 722.46s (0:12:02)** — línea copiada de la corrida real.
- [x] 1.3 Frontend baseline: **110 test files passed (110), 884 tests passed (884)**, Duration 249.60s. `PropuestaIAModal.e2e.test.tsx` NO apareció en rojo en esta corrida (no listado entre fallos) — dato, no alarma, consistente con "intermitente".
- [x] 1.4 `test_c28_scoping_axis_guard.py` antes de agregar servicios nuevos: **40 tests collected**.

## 2. Dependencias y arranque

- [x] 2.1 `fpdf2>=2.7.0,<3` y `xlsxwriter>=3.2.0,<4` sumadas a `pyproject.toml` con el comentario del porqué (1 GB, sin binarios de sistema). Importadas en el venv de test: `fpdf2 2.8.8`, `xlsxwriter OK`. (Dev-only, no runtime: `pypdf>=4.0.0,<5` y `openpyxl>=3.1.0,<4` para LEER los archivos generados en los tests — design.md D3 solo descarta openpyxl como *escritor* de producción.)
- [x] 2.2 `tests/test_c39_export_dependencies_smoke.py` — **2 passed**: fpdf2 genera un PDF mínimo válido (`%PDF-` header), xlsxwriter genera un XLSX mínimo válido (`PK` header de ZIP).

## 3. El armador del documento — datos, sin formato

> Todo este grupo es lógica pura sobre la respuesta del service de cuenta corriente. Sin I/O, sin PDF, sin XLSX. Es la parte donde vive la regla que importa (D1/D2), así que se testea aislada de la generación de archivos.

Implementado en `app/services/exportacion_armador.py`, testeado en `tests/test_c39_exportacion_armador.py` — **15 passed**.

- [x] 3.1 `TestEncabezado::test_encabezado_trae_negocio_cuenta_fecha_y_saldo`.
- [x] 3.2 `TestSinHistorial::test_sin_incluir_historial_no_hay_filas`.
- [x] 3.3 `TestConHistorialCompleto` (2 tests, incl. mutación explícita sobre el monto). **Mutación verificada de verdad** en 3.5 (ver abajo); en 3.3 la triangulación queda cubierta por comparación estricta campo a campo contra el historial fuente.
- [x] 3.4 `TestRangoFiltraFilas` (2 tests: bordes incluidos + un día antes/después excluidos).
- [x] 3.5 `TestSaldoAnterior::test_saldo_anterior_es_el_acumulado_de_la_fila_previa_a_desde` + `test_mutacion_tomar_fila_i_en_vez_de_i_menos_1_rompe_el_test`. **Mutación corrida de verdad**: cambié `h["fecha"] < desde` por `<= desde` en el código real, corrí la suite → **3 tests cayeron** (los que dependen de `saldo_anterior`), confirmando que agarran el corrimiento de índice. Revertido y vuelto a verificar en verde.
- [x] 3.6 `TestSaldoAnterior::test_triangulacion_sin_filas_previas_saldo_anterior_es_cero`.
- [x] 3.7 `TestReconciliacionAritmetica::test_saldo_anterior_mas_movimientos_da_el_acumulado_final` — cae también con la mutación de 3.5 (ver arriba), es la prueba de que el documento cierra solo.
- [x] 3.8 `TestSaldoEncabezadoNoCambiaConRango` (2 tests). Nota: no hay mutación posible que "haga fallar" esto de forma interesante — el armador nunca calcula un saldo de rango para el encabezado, así que la propiedad es estructural (D1), no defendida por un caso límite.
- [x] 3.9 `TestDosSaldosCuandoHastaEsPasado` (2 tests: expone los dos saldos rotulados; sin `hasta` pasado no hay segundo saldo).
- [x] 3.10 `TestRangoSinMovimientos::test_produce_encabezado_y_cero_filas_sin_error`.
- [x] 3.11 Implementado. El módulo no importa `app.repositories.*` ni `cuenta_corriente_engine` (verificado también estructuralmente en el test del service, task 6.1).

## 4. Generación de archivos

Implementado en `app/services/exportacion_generadores.py`, testeado en `tests/test_c39_exportacion_generadores.py` — **7 passed**. Verificación por CONTENIDO real: XLSX releído con `openpyxl` (dev-only), PDF releído con `pypdf` (dev-only) — ninguno de los dos se agrega como dependencia de runtime.

- [x] 4.1 `TestGenerarXlsx::test_produce_archivo_reabrible_con_los_montos_del_armador` — reabre con `openpyxl` y verifica los montos concretos (1000.0, 300.0, 700.0) están en las celdas.
- [x] 4.2 `TestGenerarXlsx::test_triangulacion_sin_historial_vs_con_historial_distinta_cantidad_de_filas`.
- [x] 4.3 `TestGenerarPdf::test_produce_pdf_valido_con_nombre_de_cuenta_y_saldo_en_el_texto` — texto extraído con `pypdf`, verifica nombre de cuenta y saldo presentes.
- [x] 4.4 `TestGenerarXlsx::test_con_rango_incluye_la_fila_de_saldo_anterior` + `TestGenerarPdf::test_con_rango_el_pdf_tambien_muestra_saldo_anterior`.
- [x] 4.5 Implementado. `xlsxwriter.Workbook(..., {"constant_memory": True})`.
- [x] 4.6 `TestConstruirNombreArchivo` (2 tests) — triangulado con `"Ñandú & Cía. S.A."` → sin acentos, sin espacios, `[a-z0-9.\-]+` válido.

## 5. El tope de tamaño

Implementado en `app/services/exportacion_topes.py`, testeado en `tests/test_c39_exportacion_topes.py` — **4 passed**, más `TestTopeIntegrado` en `test_c39_exportacion_service.py`.

- [x] 5.1 `test_excede_el_tope_responde_422_con_cantidad_y_sugerencia` + `test_mutacion_tope_bajado_a_1_produce_422_no_documento` — mutación real vía `monkeypatch.setitem(TOPE_FILAS, "pdf", 1)`, confirmado que 2 filas superan el tope de 1 y disparan 422.
- [x] 5.2 `test_acotar_por_debajo_del_tope_no_levanta_nada`.
- [x] 5.3 Verificado en `TestTopeIntegrado::test_excede_el_tope_da_422_y_no_genera_nada` (service test): `generar_pdf` reemplazado por una función que hace `raise AssertionError` si se la llama — el test pasa, o sea nunca se llamó.
- [x] 5.4 `test_topes_de_pdf_y_xlsx_son_distintos`.
- [x] 5.5 Implementado. **Valor elegido: PDF=500 filas, XLSX=5000 filas.** Criterio (conservador, no medido — ver Open Question de design.md): PDF renderiza fila por fila con `fpdf2` sin streaming, así que su costo por fila es más alto y su techo se fija más bajo (500 filas ≈ ~15 páginas de tabla, un documento todavía manejable). XLSX usa `constant_memory` (no retiene la hoja), así que su huella no crece con el archivo completo — techo 10× más alto. Ninguno de los dos se midió contra el contenedor real de 1 GB; queda anotado en el código (`exportacion_topes.py`) que el valor definitivo requiere esa medición.

## 6. Service de exportación y autorización

Implementado en `app/services/exportacion_cuenta_corriente_service.py`, testeado en `tests/test_c39_exportacion_service.py` — **9 passed**.

- [x] 6.1 `TestNoAbreQueriesPropias::test_no_importa_repositorios_ni_el_motor_fifo` — parsea el AST del módulo (mismo espíritu que `test_c28_scoping_axis_guard.py`) y falla si aparece cualquier import de `app.repositories.*` o de `cuenta_corriente_engine`.
- [x] 6.2 `TestCoincideConLaPantalla` (proveedor + cliente) — exporta a XLSX, relee con `openpyxl` y verifica que el saldo y cada monto/saldo_acumulado del `get_cuenta_corriente` real están presentes en las celdas.
- [x] 6.3 `TestAislamientoPorNegocio::test_proveedor_de_otro_negocio_da_404` + `test_cliente_de_otro_negocio_da_404`.
- [x] 6.4 `TestAislamientoPorNegocio::test_proveedor_inexistente_da_404_indistinguible`.
- [x] 6.5 `TestVerificacionAntesDeGenerar::test_no_llama_a_los_generadores_si_el_recurso_es_ajeno` — `generar_pdf`/`generar_xlsx` parcheados para explotar si se los llama; el 404 sale antes de tocarlos.
- [x] 6.6 Implementado.

## 7. Rutas

Implementado en `app/routers/proveedores.py` y `app/routers/clientes.py`, testeado en `tests/test_c39_exportacion_integration.py` — **11 passed**.

- [x] 7.1 Rutas declaradas junto a `get_cuenta_corriente`, antes del catch-all `/{id}` en ambos routers.
- [x] 7.2 `TestExportProveedor::test_formato_pdf_devuelve_content_type_y_disposition` + `TestRutaDeclaradaAntesDelCatchAll`. **Mutación corrida de verdad, y con un hallazgo que corrige el supuesto del design**: moví físicamente el bloque de la ruta `/{proveedor_id}/cuenta-corriente/export` a DESPUÉS de `get_proveedor` (`/{proveedor_id}`) en el archivo fuente y corrí el test end-to-end de nuevo. **Siguió pasando en 200 con el PDF real.** Razón: Starlette ancla cada patrón de ruta por cantidad de segmentos — `/{proveedor_id}` (1 segmento) nunca matchea `/{proveedor_id}/cuenta-corriente/export` (3 segmentos), sin importar el orden de declaración. El riesgo real de shadowing (como `/buscar` vs `/{id}`) es solo entre rutas con la MISMA cantidad de segmentos donde una es literal y la otra es un parámetro. Revertido el archivo a su orden original. **La ruta se dejó declarada antes de `/{id}` de todos modos** (consistencia con el patrón ya establecido y con D4), pero quede anotado: para ESTE par específico de rutas, el orden no es lo que las protege — el test end-to-end sí sigue siendo la única forma correcta de verificarlo (un `app.routes` no lo hubiera detectado tampoco, por la razón inversa).
- [x] 7.3 `TestExportProveedor::test_formato_xlsx_devuelve_una_planilla` + `TestExportCliente::test_formato_xlsx_devuelve_una_planilla`.
- [x] 7.4 `TestExportProveedor::test_formato_no_soportado_da_422`.
- [x] 7.5 `TestExportProveedor::test_rango_sin_incluir_historial_da_422`.
- [x] 7.6 `TestUnauthenticated` (proveedor + cliente).
- [x] 7.7 Implementado.
- [x] 7.8 Verificado: `git status`/`git diff --stat` sobre `app/main.py` no muestra cambios.

**Fallo real encontrado y arreglado (no preexistente, causado por este change):** la primera corrida del suite completo (task 10.1) dio `1 failed, 1401 passed` — `tests/test_dependency_override_imports.py::test_all_dependency_overrides_import_from_router_modules` (el guard estructural de C-25) falló contra mi propio `tests/test_c39_exportacion_integration.py`. Causa: el fixture `app_with_db` armaba los overrides con un `for dep in (get_db_auth, ...): app.dependency_overrides[dep] = ...` — el guard resuelve por AST el import de cada nombre subscripteado en `dependency_overrides[X]`, y solo entiende `X` como un `ast.Name` importado directamente; una variable de loop no tiene import que resolver, así que la lectura estática la reporta como violación aunque en runtime cada `get_db_*` sí venga de su router correcto. Arreglado reescribiendo el fixture con las 8 líneas de asignación explícitas, igual que todos los demás test files de integración del repo (`test_c35_cuenta_corriente_cliente_integration.py`, etc.) — nunca un loop sobre una tupla. Corrida de nuevo: **18 passed** (`test_dependency_override_imports.py` + `test_c39_exportacion_integration.py`).

## 8. Frontend — API y disparo de descarga

Implementado en `src/features/cuenta-corriente/api/exportacionApi.ts`, testeado en `exportacionApi.test.ts` — **8 passed**.

- [x] 8.1 `test('pide el archivo como blob y no transforma su contenido')` — verifica `responseType: 'blob'` y que el Blob devuelto es el MISMO objeto (`toBe`), no una reconstrucción.
- [x] 8.2 `test('usa el nombre de archivo que indica el backend...')`.
- [x] 8.3 `test('sin rango no manda desde/hasta')` + `test('triangulación: con rango completo, manda desde/hasta e incluir_historial')`.
- [x] 8.4 Implementado. Sin `Idempotency-Key` (es GET, no escritura). Nota no prevista en la task: `extraerDetalleErrorExport` tuvo que usar `FileReader` en vez de `Blob.text()` — el `Blob` del entorno de test (Vitest/jsdom) no implementa `.text()` ni `.arrayBuffer()` (verificado empíricamente), y `FileReader.readAsText` sí funciona en ambos (test y navegador real), así que quedó como el único camino de lectura, no dos.

## 9. Frontend — el formulario

Implementado en `src/features/cuenta-corriente/components/ExportarCuentaCorriente.tsx` (compartido entre las dos vistas — recibe `exportFn` inyectado, no sabe si exporta un proveedor o un cliente), testeado en `ExportarCuentaCorriente.test.tsx` (**7 passed**) + tests agregados en `CuentaCorrientePage.test.tsx` y `CuentaCorrienteCliente.test.tsx` para 9.1 (**27 passed** entre los dos archivos, incluidas las 4 nuevas). Cableado: `CuentaCorrientePage.tsx` (rama vacía Y rama con datos) y `CuentaCorrienteCliente.tsx`.

- [x] 9.1 `CuentaCorrientePage.test.tsx`: "offers the export action" (con datos) + "still available on a saldo-cero account" (triangulación, `emptyTriple`). `CuentaCorrienteCliente.test.tsx`: mismo par con `account({saldo: 1000})` / `account({saldo: 0})`.
- [x] 9.2 `test('sin historial incluido, los controles de rango no están disponibles')` + `test('al marcar incluir historial, los controles de rango aparecen vacíos')`.
- [x] 9.3 `test('con desde posterior a hasta, señala el error y no llama a exportFn')` + triangulación con rango correcto que sí llama.
- [x] 9.4 `test('indica que está en curso y no se puede disparar de nuevo')` — promesa controlada manualmente (`resolver`), verifica `role="status"` y ambos botones (`Exportar` y `Descargar`) deshabilitados mientras está pendiente.
- [x] 9.5 `test('muestra el motivo informado por el backend, no un error genérico')` — error 422 simulado con Blob (igual forma que el backend real), verifica que el texto del `role="alert"` contiene "900 movimientos" y "acot...".
- [x] 9.6 `test('reactiva el disparador y conserva las opciones elegidas')`.
- [x] 9.7 Implementado.

## 10. Cierre y documentación

- [x] 10.1 Backend final: **1402 passed, 3 warnings in 552.24s (0:09:12)** (incluye el fix del guard C-25, ver nota en task 7.8). Frontend final: **112 test files passed (112), 903 tests passed (903)**, Duration 215.41s. `npx tsc --noEmit` — limpio, sin salida (tras corregir 4 errores de `exactOptionalPropertyTypes` y de indexado posiblemente-undefined en los tests nuevos). `npx eslint src --ext .ts,.tsx --max-warnings 0` — limpio, sin salida.
- [x] 10.2 `test_c28_scoping_axis_guard.py`: **40 → 48 tests collected** (+8). Explicado por 4 archivos nuevos en `app/services/` (`exportacion_armador.py`, `exportacion_generadores.py`, `exportacion_topes.py`, `exportacion_cuenta_corriente_service.py`) × 2 tests parametrizados cada uno (`test_no_usuario_id_as_scoping_filter` + `test_authorship_is_never_a_filter`). Ninguno usa `usuario_id` como filtro — todos scopean por `negocio_id`.
- [x] 10.3 Verificado: `git status`/`git diff --stat` sobre `src/shared/api/api.d.ts` no muestra cambios. `npm run generate-types` no se corrió en ningún momento del change.
- [x] 10.4 Documentado en `knowledge-base/09_decisiones_y_supuestos.md`: **D-80 a D-84** (coordinado con el agente de C-37, que ya había tomado D-75 a D-79 — arranqué en D-80 por indicación explícita). D-80 = D1 (reutiliza el service), D-81 = D2 (saldo anterior se lee), D-82 = D3 (fpdf2/xlsxwriter), D-83 = D5 (tope de filas), D-84 = D4 (orden de rutas, incluido el hallazgo de la mutación real).
- [x] 10.5 Sumado a `knowledge-base/05_reglas_de_negocio.md`: nueva sección **"Dominio: Exportación de cuenta corriente (C-39)"** con **RN-EXP-01 a RN-EXP-06** (prefijo propio, coordinado con el agente de C-37 que usa RN-EST-XX). RN-EXP-02 (saldo del encabezado = cuenta completa) y RN-EXP-03 (reconciliación con rango) son las dos que pide la task explícitamente; se agregaron además RN-EXP-01 (no recalcular), RN-EXP-04 (rango sin historial → 422), RN-EXP-05 (tope de filas) y RN-EXP-06 (aislamiento 404) para que el dominio quede completo.
- [x] 10.6 `CLAUDE.md`: "Próximo a archivar" actualizado con C-39 (apply completo 2026-08-25, pendiente archive) y nota de la etapa D-80..D-84 + el hallazgo de D4. `CHANGES.md`: entrada `[C-39]` actualizada a `[~] apply completo 2026-08-25 — pendiente /opsx:archive`, scope marcado con lo entregado. **Sin fecha de archive** en ningún lado — el archive real no corrió.
