## Context

`src/shared/api/api.d.ts` es un archivo escrito a mano desde C-03. Su encabezado dice que se generó manualmente "porque el backend no estaba corriendo al momento del apply" y pide regenerarlo cuando estuviera disponible. Nunca se hizo. Hoy exporta 79 tipos que importan 139 archivos (193 imports con nombre).

**Medición del 2026-08-28**, contra el `openapi.json` del backend en ejecución, con un archivo temporal de aserciones `type Eq<A,B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false` verificado por `tsc --noEmit`:

| | |
|---|---|
| Schemas expuestos por el backend | 66 |
| Tipos exportados a mano | 79 |
| Pares comparables verificados | 62 |
| **Con drift** | **40** |
| Idénticos | 22 |
| Schemas del backend que el frontend no usa | 19 |

De ese drift, el subconjunto que importa: **22 campos tipados `number` a mano que el backend serializa como `string`** (Pydantic v2 manda `Decimal` como string, D-88).

**El estado actual no es "tipos incorrectos", es una promesa incumplida.** El repo tiene una convención establecida dos veces —C-13 (`parseCuentaCorriente`) y C-38 (`estadisticasParse.ts`)— según la cual `api.d.ts` describe el **modelo público** del frontend, con los decimales ya convertidos a `number`, y las formas del wire (`Raw*`, decimales como string) viven internas al módulo de parseo. Bajo esa convención, `Proveedor.saldo: number` es el contrato público **correcto**. El problema es que `proveedoresApi`, `facturasApi`, `pagosApi` y `ventasApi` **no parsean nada**: declaran el número y entregan el string del wire.

Que no se vea roto es consecuencia de dos amortiguadores que son parte del problema: `formatCurrency` acepta `string` y hace `Number()` con fallback a `0` en `NaN`, y las pantallas afectadas mayormente formatean en vez de calcular. La aritmética sobre esos campos —sumar, comparar, ordenar— es concatenación o comparación lexicográfica en silencio.

Restricción de entorno: regenerar exige el backend arriba en `http://localhost:8000`. Está dockerizado y hoy responde `200` en `/openapi.json`.

## Goals / Non-Goals

**Goals:**
- Que el backend sea la fuente de verdad de las formas del contrato, y que la deriva futura falle en `tsc` en vez de quedar invisible.
- Que los 22 campos de dinero digan la verdad: `number` en el modelo público **porque alguien los convirtió**, no por declaración.
- Preservar los 79 nombres exportados. Ningún call site debería cambiar su import; el typecheck es la verificación de esa afirmación.
- Dejar visible, a simple vista, qué tipo es contrato del backend y qué tipo es construcción del frontend.

**Non-Goals:**
- No se toca el backend. El contrato es el que hay; este change lo refleja, no lo negocia. Si aflora algo que parece un error del backend, se documenta y se propone aparte.
- No se consumen los 19 schemas del backend hoy sin uso.
- No se rediseñan las pantallas ni se cambia comportamiento visible.
- No se persigue cobertura de tests nueva más allá de la que el cambio exige.

## Decisions

### D1 — Dos archivos: wire generado + público derivado

`api.generated.d.ts` contiene la salida cruda de `openapi-typescript` (`paths`, `components`). `api.d.ts` deja de declarar formas y pasa a derivar de él los 79 nombres públicos.

*Alternativa considerada*: un único archivo generado, con los call sites usando `components['schemas']['ProveedorResponse']` directamente. **Rechazada**: rompe 193 imports con nombre en 139 archivos, y ata cada componente a la nomenclatura del backend (`*Response`, `*ListItem`), que es un detalle de serialización, no vocabulario de dominio. La capa de derivación cuesta un archivo y compra que renombrar un schema del backend sea un cambio de una línea.

### D2 — La conversión de decimales se declara con un helper de tipo, en un solo lugar

La diferencia entre wire y público se expresa con un helper explícito, del tipo `type DecimalAsNumber<T, K extends keyof T>`, aplicado campo por campo con las claves nombradas:

```
export type Proveedor = DecimalAsNumber<components['schemas']['ProveedorResponse'], 'saldo'>
```

*Alternativa considerada*: reescribir cada interfaz pública a mano con el campo ya como `number`. **Rechazada**: es exactamente lo que tenemos hoy, y es lo que permitió que 40 tipos derivaran sin que nadie se enterara.

*Alternativa considerada*: un helper "inteligente" que detecte automáticamente qué campos son decimales. **Rechazada**: requeriría adivinar por nombre (`monto`, `total`, `saldo`, `precio_*`) y esa heurística falla en ambas direcciones. Nombrar las claves es verboso a propósito: cada campo de dinero convertido es una decisión visible y revisable, y agregar uno nuevo obliga a tocar esta línea.

### D3 — El parseo va en el borde de cada cliente de API, nunca en un interceptor global

Cada uno de los cuatro clientes suma su función de parseo, con las formas `Raw*` internas al módulo, replicando `estadisticasParse.ts`.

*Alternativa considerada*: un interceptor de Axios que recorra toda respuesta y convierta a `number` cualquier string que parezca numérico. **Rechazada, y no por estilo.** Rompería datos reales: un CUIT es una cadena de dígitos que **debe** seguir siendo string (perdería ceros a la izquierda y excedería la precisión segura de un `number`), y lo mismo vale para cualquier código o identificador numérico que exista hoy o se agregue mañana. Una conversión que adivina por forma del valor es una corrupción silenciosa esperando el dato correcto. El parseo tiene que ser por campo nombrado, y eso vive donde se conoce la forma de la respuesta: el borde.

### D4 — Un decimal malformado lanza; no degrada a `0`

Se sostiene D-88 sin excepción. Un `0` fabricado en un saldo de proveedor o en el monto de un pago es indistinguible de un valor legítimo y se propaga a la aritmética. Lanzar hace que el hook exponga `isError` en vez de mostrar una cifra plausible y falsa.

Consecuencia deliberada: `formatCurrency` pierde su rol de red de contención en estos caminos. **Su tolerancia a `string` no se retira en este change** —sigue habiendo call sites fuera de alcance— pero deja de ser el mecanismo del que depende la corrección.

### D5 — Los tipos sin contraparte quedan a mano, en una sección rotulada

`*Filters`, `*DeleteInput`, `HTTPError`, `PaginatedFacturas`, `PaginatedProveedores`, `ClienteConflictDetail`, `TopeExcedidoDetail` y los `*ListItem` locales no existen como schemas: son parámetros de query, envoltorios de paginación y formas de error construidas por el cliente. Quedan escritos a mano bajo un encabezado que dice que lo son y por qué.

El valor de la sección es el contraste: hoy los 79 tipos se ven iguales y nada distingue el contrato de la invención. Después, cualquiera que agregue un tipo tiene que elegir un lado.

### D6 — Los alias de nombre se mapean explícitamente, uno por uno

Quince tipos difieren solo en el nombre (`Proveedor`→`ProveedorResponse`, `Factura`→`FacturaResponse`, `Cliente`→`ClienteResponse`, `Pago`→`PagoResponse`, `Venta`→`VentaResponse`, `Usuario`→`UsuarioResponse`, `CobroCliente`→`CobroClienteResponse`, `FacturaItem`→`FacturaItemResponse`, `Categoria`→`CategoriaProveedor`, `LoginBody`→`LoginRequest`, `RecuperarBody`/`RegistroBody`/`ResetBody`/`RegistroEmpleadoBody`→`*Request`, `MeResponse`→`UsuarioResponse`).

Esto **corrige el scope escrito en `CHANGES.md`**, que afirma que esos tipos "no tienen contraparte en el backend, son invenciones del frontend y no se pueden generar". Medido: sí tienen contraparte, con otro nombre. Se generan.

### D7 — `generate-types` deja de apuntar a `api.d.ts`

Hoy el script escribe sobre el archivo a mano: correr `npm run generate-types` **destruye** el trabajo. Pasa a escribir en `api.generated.d.ts`. Es un cambio de una línea que elimina una trampa que estuvo armada desde C-03.

### D8 — El guard de compile-time se generaliza y absorbe al de estadísticas

Con el generado en su lugar, `api.estadisticas.test-d.ts` pierde su razón de ser: existía, según su propio encabezado, para "avisar cuando C-41 finalmente genere los tipos". Se retira y su función la cubre un guard general que asegura que cada tipo público derivado siga correspondiéndose con su schema, y que las claves convertidas a `number` sean exactamente las declaradas.

No se retira antes de que el guard general esté verde: primero existe el reemplazo, después se saca el andamio.

### D9 — Los fixtures de test migran junto con el cliente que los usa

Los tests que simulan respuestas HTTP hoy devuelven montos como `number`, porque eso es lo que el tipo decía. Con el parseo en el borde, un fixture debe entregar lo que el backend entrega —un string— para que el test ejercite la conversión en vez de saltearla.

Migrar los fixtures por cliente, junto con su parseo, y no en un barrido aparte: un fixture que sigue devolviendo `number` mientras el parseo ya existe es un test que pasa sin probar nada.

## Risks / Trade-offs

**[El drift real es más grande que los 22 campos de dinero]** → 40 tipos difieren, y el resto del drift es nullabilidad, opcionalidad y formas de lista más chicas de lo declarado (`ProveedorListItem` a mano extiende `Proveedor`, pero el backend devuelve un subconjunto con `ultima_factura_fecha`). Aflora como error de `tsc`, así que no se puede diferir ni ignorar. Mitigación: atacar por cliente de API, en tandas verificables, y no atar los 79 tipos de una sola vez. Cada tanda deja el typecheck verde.

**[El costo real puede estar en los fixtures, no en los tipos]** → 139 archivos importan de `api.d.ts` y buena parte son tests con datos simulados. El trabajo de D9 puede superar al de los tipos. Mitigación: medirlo en la primera tanda y reportarlo antes de seguir; si desborda, es información para partir el change, no para bajar el estándar.

**[Aflora algo que parece un error del backend]** → Es probable, y es el objetivo del change. Mitigación: el frontend se adapta al contrato real y el hallazgo se documenta; ningún arreglo de backend entra acá (Non-Goal).

**[La regeneración depende del backend corriendo]** → `npm run generate-types` falla si `localhost:8000` no responde, y el generado queda viejo sin que nada avise. Mitigación: el generado se commitea, así el repo compila sin backend; el guard de compile-time detecta la divergencia recién cuando alguien regenera. Es una limitación aceptada, no resuelta.

**[Reconstruir la imagen antes de regenerar]** → Si el contenedor quedó viejo, el `openapi.json` que sirve es el del código anterior y el generado nace desactualizado sin error visible. Mitigación: `docker compose build api` antes de regenerar, por la regla que ya dejó escrita C-39 en `CLAUDE.md`.

## Migration Plan

1. Generar `api.generated.d.ts` y commitearlo; apuntar `generate-types` a él (D7). Nada consume el generado todavía: el typecheck sigue verde.
2. Construir el helper `DecimalAsNumber` y el guard general de compile-time, sobre los 22 tipos que hoy ya coinciden exacto. Verde antes de tocar nada con drift.
3. Migrar cliente por cliente —proveedores, facturas, pagos, ventas—, cada uno con su parseo en el borde (D3), sus fixtures (D9) y su tanda de tipos derivados. Typecheck y suite verdes al cerrar cada uno.
4. Migrar el resto de los tipos derivados y los alias de nombre (D6).
5. Rotular la sección de tipos a mano (D5) y retirar `api.estadisticas.test-d.ts` (D8).

Rollback: cada paso es un commit independiente y el paso 1 no cambia comportamiento. Revertir un paso deja el anterior compilando.

## Open Questions

- El volumen real de fixtures a migrar (D9) no está medido. Se mide en el paso 3 con el primer cliente y se reporta antes de continuar.
- Los 19 schemas del backend sin consumir no se revisaron uno por uno. Podría haber ahí una respuesta que el frontend está tipando a mano en vez de usar la del contrato; queda para la ejecución del paso 4.
