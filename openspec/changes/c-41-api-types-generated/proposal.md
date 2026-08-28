## Why

`src/shared/api/api.d.ts` está escrito a mano, pese a que su encabezado y el script `generate-types` del `package.json` sugieren que se genera desde OpenAPI. Se lo dejó así desde C-03, cuando el backend todavía no corría, y nunca se reconcilió.

Medido el 2026-08-28 contra el `openapi.json` del backend en ejecución (no estimado): de 62 pares de tipos comparables, **40 difieren** de lo que el backend realmente devuelve. Y adentro de ese drift hay una clase de error que no es cosmética: **22 campos están tipados `number` cuando el backend los serializa como `string`**, porque Pydantic v2 manda los `Decimal` como string — el mismo hecho que C-38 ya documentó en D-88.

Son campos de dinero y cantidades: `Proveedor.saldo`, `Pago.monto`, `FacturaResponse.monto_total`, `FacturaItem.precio_unitario`, `EntradaHistorial.saldo_acumulado`, entre otros. Hoy no se ve roto en pantalla por dos razones que son en sí mismas el problema: solo `cuentaCorrienteApi`, `estadisticasParse` e `iaVisionApi` parsean en el borde, y `formatCurrency` acepta un string y hace `Number()` con **fallback a `0` en `NaN`** — exactamente el cero fabricado que D-88 declaró inaceptable para valores derivados de dinero. Cualquier aritmética sobre esos campos (sumar, comparar, ordenar) es concatenación de strings o comparación lexicográfica en silencio.

El tipo miente sobre el dinero, y el sistema de tipos —que existe para avisar de esto— está diciendo que todo está bien.

## What Changes

- Se incorpora `src/shared/api/api.generated.d.ts`, producido por `openapi-typescript` desde el `openapi.json` del backend. Es un archivo derivado: no se edita a mano.
- `api.d.ts` deja de declarar formas y pasa a **derivar** sus nombres del generado, preservando los 79 nombres que hoy importan 139 archivos del frontend. Ningún call site cambia su import.
- `api.d.ts` conserva su rol actual de **contrato público del frontend**, no de wire: los decimales se siguen exponiendo como `number`, tal como los consume hoy la app y como lo fija `api.estadisticas.test-d.ts`. Lo que cambia es que esa forma pasa a derivarse del schema del backend en vez de transcribirse a mano, con los campos de dinero convertidos explícitamente de `string` a `number` — de modo que la diferencia entre el wire y el modelo público quede declarada en un solo lugar en vez de perdida en 79 interfaces.
- Se corrige el supuesto de `CHANGES.md`: la mayoría de los tipos "sin contraparte en el backend" **sí tienen contraparte, con otro nombre** (`Proveedor`→`ProveedorResponse`, `LoginBody`→`LoginRequest`, `Categoria`→`CategoriaProveedor`, y once más). Se resuelven con alias, no quedan a mano.
- Los tipos que sí son invención del frontend y no existen en el contrato —los `*Filters`, los `*DeleteInput`, `HTTPError`, `PaginatedFacturas`, `PaginatedProveedores`, `ClienteConflictDetail`, `TopeExcedidoDetail`— quedan escritos a mano en una sección **explícitamente rotulada como tal**, para que se distinga a simple vista qué es contrato y qué es construcción local.
- **La promesa se vuelve verdad**: `proveedoresApi`, `facturasApi`, `pagosApi` y `ventasApi` incorporan **parseo de `Decimal`-string a `number` en el borde**, replicando el patrón ya establecido por `parseCuentaCorriente` (C-13) y `estadisticasParse.ts` (C-38). Hoy esos cuatro clientes declaran los montos como `number` y no convierten nada: el tipo público promete un número y entrega un string. Un valor no parseable **lanza**; no degrada a `0` (D-88).
- El script `generate-types` deja de apuntar a `api.d.ts` y pasa a escribir sobre `api.generated.d.ts`. Hoy, correrlo tal cual **destruye** el archivo a mano.
- Se agrega un guard de tipos en tiempo de compilación que falla si un tipo derivado deja de coincidir con su schema, en la línea de lo que `api.estadisticas.test-d.ts` ya hace para estadísticas. Con el generado en su lugar, ese archivo pasa a ser redundante y se retira.

## Capabilities

### New Capabilities
- `api-contract-types`: el contrato de tipos del frontend se deriva del OpenAPI del backend; qué se genera, qué se escribe a mano y por qué; y la obligación de parsear los `Decimal`-string en el borde de cada cliente de API en vez de tipar el dinero como número.

### Modified Capabilities

Ninguna. El cambio no altera requisitos de comportamiento de las capabilities de producto existentes (`proveedores-frontend`, `facturas-frontend`, `pagos-frontend`, `ventas-frontend`): las pantallas siguen mostrando lo mismo. Lo que cambia es de dónde salen los tipos y dónde se convierte el dinero, y eso lo cubre la capability nueva de forma transversal.

## Impact

**Código afectado**
- `facturas-proveedores-web/src/shared/api/api.d.ts` — reescrito como capa de derivación.
- `facturas-proveedores-web/src/shared/api/api.generated.d.ts` — nuevo, derivado, no editable a mano.
- `facturas-proveedores-web/src/features/{proveedores,facturas,pagos,ventas}/api/` — suman parseo en el borde.
- `facturas-proveedores-web/package.json` — cambia el destino de `generate-types`.
- `facturas-proveedores-web/src/shared/api/api.estadisticas.test-d.ts` — se retira; su función la absorbe el guard general.
- 139 archivos importan de `@shared/api/api` (193 imports con nombre). **Ninguno debería necesitar cambios**: preservar los nombres exportados es un requisito del change, y el typecheck es la verificación.

**Riesgo conocido**
- El alcance real del arrastre lo determina el drift de los 40 tipos, no solo el de los 22 campos de dinero. Al atar los tipos a la realidad va a aflorar drift que hoy nadie ve: campos opcionales vs. requeridos, nullabilidad, y formas de lista más chicas de lo que el frontend declara (por ejemplo `ProveedorListItem`, que a mano extiende `Proveedor` pero que el backend devuelve más chico y con `ultima_factura_fecha`). Cada uno de esos aflora como error de `tsc`, y por eso no se puede diferir: o el tipo dice la verdad, o no compila.

**Dependencias**
- Requiere el backend en ejecución para regenerar (`http://localhost:8000/openapi.json`). No agrega dependencias de runtime: `openapi-typescript` ya está en `devDependencies`.

**Fuera de alcance**
- No se toca el backend. El contrato es el que hay; este change lo refleja, no lo negocia.
- No se consumen los 19 schemas del backend que hoy el frontend no usa.
