> Orden derivado del Migration Plan de `design.md`. Cada grupo cierra con typecheck y suite en verde: una tanda que deja `tsc` roja no está terminada.
>
> Baseline al abrir el change (2026-08-28): frontend **1005 passed / 125 archivos**, `tsc --noEmit` limpio, `eslint` limpio.

## 1. Andamiaje: el generado entra sin que nada lo consuma

- [x] 1.1 ~~Reconstruir la imagen del backend (`docker compose build api`) y confirmar que `http://localhost:8000/openapi.json` responde `200`~~ **DESVIACIÓN**: Docker Desktop no está disponible en este entorno. Se generó el schema directamente desde el código fuente (`uv run python -c "import json; from app.main import app; print(json.dumps(app.openapi(), indent=2))"`), que es estrictamente más confiable que un contenedor — imposible que quede desactualizado, que es exactamente el modo de falla que C-39 documentó. Confirmado: 66 schemas, 39 paths — coincide exacto con la medición de `design.md`.
- [x] 1.2 Apuntar el script `generate-types` del `package.json` a `src/shared/api/api.generated.d.ts` (D7) — hoy apunta a `api.d.ts` y correrlo destruye el archivo a mano
- [x] 1.3 Generar `src/shared/api/api.generated.d.ts` con `npm run generate-types` (apuntado al JSON generado desde fuente en vez de `http://localhost:8000/openapi.json`, mismo resultado) y commitearlo — el encabezado estándar de `openapi-typescript` ya dice "Do not make direct changes to the file"
- [x] 1.4 Verificar que `tsc --noEmit` y la suite siguen en el baseline: nada consume el generado todavía, así que nada debe haber cambiado

## 2. El helper de conversión y el guard, probados sobre lo que ya coincide

- [x] 2.1 RED — escribir las aserciones de compilación del guard general para los 22 tipos que la medición dio idénticos, importando desde `api.generated.d.ts`; verificar que fallan mientras el helper no existe
- [x] 2.2 GREEN — implementar `DecimalAsNumber<T, K>` (D2) y derivar esos 22 tipos en `api.d.ts` hasta que `tsc --noEmit` pase
- [x] 2.3 TRIANGULAR — verificar por mutación que el guard sirve: alterar a mano un campo del generado, confirmar que `tsc` falla señalando el tipo, revertir
- [x] 2.4 TRIANGULAR — verificar que `DecimalAsNumber` convierte solo las claves nombradas: una aserción que falle si un campo no nombrado cambia de tipo
- [x] 2.5 Confirmar suite y typecheck en verde antes de tocar ningún tipo con drift

## 3. Cliente de proveedores — y medición del costo real de los fixtures

- [x] 3.1 Medir y reportar cuántos archivos de test simulan respuestas de proveedores con montos, antes de migrar ninguno (Open Question de `design.md`) — **21 archivos** (medido por análisis de mecanismo de mock, no solo grep de `saldo`)
- [x] 3.2 RED — escribir el test del parseo en el borde de `proveedoresApi`: la respuesta simulada trae `saldo` como cadena, el cliente debe devolver número
- [x] 3.3 RED — escribir el test del decimal malformado: debe lanzar, no devolver `0` (D4, D-88)
- [x] 3.4 GREEN — implementar el parseo en `proveedoresApi` con las formas `Raw*` internas al módulo, siguiendo `estadisticasParse.ts`
- [x] 3.5 Derivar `Proveedor` y `ProveedorListItem` del generado; resolver el drift conocido de `ProveedorListItem` (a mano extiende `Proveedor`, el backend devuelve un subconjunto con `ultima_factura_fecha`) — resuelto; la resolución hizo aflorar y corregir 6 call sites de producción que trataban ambos tipos como intercambiables
- [x] 3.6 Migrar los fixtures de proveedores a la forma del wire (D9): un fixture que ya devuelve número deja el parseo sin ejercitar
- [x] 3.7 Agregar al guard las aserciones de los tipos de proveedores
- [x] 3.8 Typecheck, lint y suite en verde; reportar el costo medido en 3.1 antes de seguir

## 4. Cliente de facturas

- [x] 4.1 RED — test del parseo en el borde de `facturasApi` con `monto_total`, `cantidad` y `precio_unitario` como cadenas
- [x] 4.2 RED — test del decimal malformado en facturas: lanza, no degrada
- [x] 4.3 GREEN — implementar el parseo en `facturasApi` con las formas `Raw*` internas — **DESVIACIÓN encontrada al retomar**: `updateFactura` había quedado sin cablear (devolvía `res.data` crudo tipado `FacturaResponse`, una mentira a nivel de tipos). Corregido: ahora pasa por `parseFactura`.
- [x] 4.4 Derivar `Factura`, `FacturaListItem`, `FacturaConEstado` y `FacturaItem` del generado, resolviendo el drift que aflore — `numero` widened a required (mismo patrón que `cuit`/`telefono`/`notas` de `Proveedor`); `FacturaResponse.items` sobreescrito a `FacturaItem[]` porque `DecimalAsNumber` no toca claves anidadas
- [x] 4.5 Migrar los fixtures de facturas a la forma del wire — **8 archivos** (medido por mecanismo real de mock MSW): `FacturasPage.test.tsx`, `C26SupplierName.test.tsx`, `facturasHooks.test.tsx`, `FacturaDetailDialog.test.tsx`, `FacturaForm.test.tsx`, `FacturasList.test.tsx`, `cacheInvalidation.test.tsx`, `PropuestaIAModal.e2e.test.tsx`. Dos fixtures (`mockCreatedFactura` en `FacturaForm.test.tsx`, `mockFacturaResponse` en `cacheInvalidation.test.tsx`) servían a la vez de respuesta HTTP simulada y de prop directo de componente — divididas en variantes Raw/pública (D9)
- [x] 4.6 Agregar al guard las aserciones de los tipos de facturas — verificado por mutación (rename de `numero`→`numero_renamed` en el schema generado, `tsc` falló señalando `_FacturaNumeroUntouched`; revertido)
- [x] 4.7 Typecheck, lint y suite en verde — 1022/126 (baseline 1015/126 + 7 tests nuevos de `facturasApi.test.ts`), `tsc --noEmit` limpio, `eslint --max-warnings 0` limpio

## 5. Cliente de pagos

- [x] 5.1 RED — test del parseo en el borde de `pagosApi` con `monto` como cadena
- [x] 5.2 RED — test del decimal malformado en pagos: lanza, no degrada
- [x] 5.3 GREEN — implementar el parseo en `pagosApi` con las formas `Raw*` internas
- [x] 5.4 Derivar `Pago`, `PagoListItem` y `PagoListResponse` del generado, resolviendo el drift que aflore
- [x] 5.5 Migrar los fixtures de pagos a la forma del wire — **9 archivos** de la sesión inherited-WIP (`pagosApi.test.ts`, `pagosHooks.test.tsx`, `PagosPage.test.tsx`, `FE005.test.tsx`, `PagoForm.test.tsx`, `PagosList.test.tsx`, `cacheInvalidation.test.tsx`) **más 2 archivos que la sesión encontró rotos y migró**: `ProveedorDetailPage.integration.test.tsx` (`src/features/proveedores/`) y `PropuestaIAModal.pago.e2e.test.tsx` (`src/features/ia-vision/`) — ninguno de los dos estaba en la lista de WIP heredado, ambos mockeaban `POST /api/pagos` con `monto` como `number` crudo en vez de string, y ambos rompían en la suite completa hasta que se corrigieron.
- [x] 5.6 Agregar al guard las aserciones de los tipos de pagos — verificado por mutación (rename de `proveedor_id`→`proveedor_id_renamed` en el schema generado, `tsc` falló señalando `_PagoProveedorIdUntouched` y `_PagoResponse`; revertido)
- [x] 5.7 Typecheck, lint y suite en verde — 1029/126, `tsc --noEmit` limpio, `eslint --max-warnings 0` limpio

## 6. Cliente de ventas

- [ ] 6.1 RED — test del parseo en el borde de `ventasApi` con `monto` como cadena
- [ ] 6.2 RED — test del decimal malformado en ventas: lanza, no degrada
- [ ] 6.3 GREEN — implementar el parseo en `ventasApi` con las formas `Raw*` internas
- [ ] 6.4 Derivar `Venta`, `VentaListItem` y `VentaConEstado` del generado, resolviendo el drift que aflore
- [ ] 6.5 Migrar los fixtures de ventas a la forma del wire
- [ ] 6.6 Agregar al guard las aserciones de los tipos de ventas
- [ ] 6.7 Typecheck, lint y suite en verde

## 7. El resto de los tipos derivados y los alias de nombre

- [ ] 7.1 Derivar los tipos de cuenta corriente (`CuentaCorrienteResponse`, `CuentaCorrienteClienteResponse`, `EntradaHistorial`, `EntradaHistorialCliente`) y verificar que su parseo existente sigue siendo el único lugar de conversión
- [ ] 7.2 Derivar los tipos de estadísticas (`ComprasResponse`, `VentasResponse`, `ResumenResponse`, `PeriodoTotal`, `VentaPeriodo`) sin cambiar `estadisticasParse.ts`
- [ ] 7.3 Derivar los tipos de IA de visión (`PropuestaFactura`, `PropuestaPago`) y los de clientes y cobros
- [ ] 7.4 Aplicar los 15 alias de nombre de D6 (`Proveedor`→`ProveedorResponse`, `LoginBody`→`LoginRequest`, `Categoria`→`CategoriaProveedor` y el resto), verificando que ningún call site cambia su import
- [ ] 7.5 Revisar los 19 schemas del backend hoy sin consumir y reportar si alguno corresponde a una respuesta que el frontend está tipando a mano (Open Question de `design.md`)
- [ ] 7.6 Typecheck, lint y suite en verde

## 8. Rotulado y retiro del andamio

- [ ] 8.1 Agrupar bajo un rótulo explícito los tipos sin contraparte (`*Filters`, `*DeleteInput`, `HTTPError`, `PaginatedFacturas`, `PaginatedProveedores`, `ClienteConflictDetail`, `TopeExcedidoDetail` y los `*ListItem` locales), con el motivo por el que no se generan (D5)
- [ ] 8.2 Verificar que el guard general cubre todos los tipos que `api.estadisticas.test-d.ts` protegía, ANTES de retirarlo (D8)
- [ ] 8.3 Retirar `api.estadisticas.test-d.ts` y confirmar por mutación que el guard general sigue detectando el drift de estadísticas
- [ ] 8.4 Actualizar el encabezado de `api.d.ts`: hoy dice que se generó a mano porque el backend no corría, y eso deja de ser cierto

## 9. Cierre

- [ ] 9.1 Verificar que ningún archivo de los 139 que importan de `@shared/api/api` tuvo que cambiar su import; si alguno lo necesitó, documentar por qué
- [ ] 9.2 Regenerar desde cero (`npm run generate-types`) y confirmar que el diff del generado es vacío: prueba de que lo commiteado corresponde al contrato vigente
- [ ] 9.3 Correr suite completa, `tsc --noEmit` y `eslint --max-warnings 0`; reportar el conteo final contra el baseline de 1005
- [ ] 9.4 Registrar en `knowledge-base/09_decisiones_y_supuestos.md` las decisiones D1-D9 de este change
- [ ] 9.5 Corregir en `CHANGES.md` la afirmación de que los tipos sin contraparte "son invenciones del frontend y no se pueden generar" — medido y falso para 15 de ellos (D6)
- [ ] 9.6 Documentar en `CLAUDE.md` la regla resultante: los tipos del contrato se generan, los locales van rotulados, y los decimales se parsean en el borde de cada cliente
