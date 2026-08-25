## Why

Hoy la cuenta corriente de un cliente o de un proveedor **solo existe dentro de la app**. El negocio puede verla en pantalla, pero no puede entregarla: ni mandarle a un cliente el detalle de lo que debe, ni abrir los movimientos en Excel para trabajarlos aparte. La única salida es sacarle una foto a la pantalla o transcribir a mano, que es exactamente donde aparecen los números que no coinciden.

Esto cierra el último tramo del camino crítico de la etapa (C-28 → C-39). El sistema ya calcula el saldo y el historial con saldo acumulado (C-13 para proveedores, C-35 para clientes); lo que falta es dejarlos salir del sistema **sin recalcularlos por otra vía**.

## What Changes

- **Dos endpoints de exportación**, uno por tipo de cuenta, cada uno en dos formatos:
  - `GET /api/clientes/{id}/cuenta-corriente/export?formato=pdf|xlsx`
  - `GET /api/proveedores/{id}/cuenta-corriente/export?formato=pdf|xlsx`
- **El encabezado es lo mínimo y siempre viaja**: nombre del negocio, nombre del cliente/proveedor, fecha de emisión del documento y **saldo actual**. `Negocio` **no** gana campos nuevos — hoy solo tiene `nombre`, y agregarle dirección/CUIT/logo sería tocar la tabla que es el límite de aislamiento del sistema por una mejora cosmética. Papel membretado, si se quiere, es un change propio.
- **El historial es OPCIONAL**, vía `incluir_historial=true`. Sin él, el documento es un comprobante de saldo de una carilla; con él, suma el detalle cronológico de facturas y pagos (o ventas fiadas y cobros) con su saldo acumulado.
- **Rango de fechas opcional** (`desde` / `hasta`) sobre el historial: desde una fecha elegida hasta hoy, o un rango completamente personalizado.
- **Cuando hay rango, el documento abre con un `saldo anterior`** — el saldo al día previo a `desde`. Sin esa fila, el saldo acumulado de la primera fila del rango aparece salido de la nada y **no reconcilia** contra el saldo del encabezado. Un resumen de cuenta que no cierra es peor que no tener resumen: el que lo recibe hace la cuenta, no le da, y deja de creerle al documento entero.
- **XLS**: dump tabular, sin formato decorativo. Está para seguir trabajando los números en Excel, no para mostrar.
- **PDF**: documento presentable de una o más carillas. Está para que el negocio se lo muestre a su cliente.
- **Generación en backend**; el frontend solo dispara la descarga. Aislado por `negocio_id`: una cuenta de otro negocio responde **404**, nunca 403.
- Botón de exportación en las dos vistas de cuenta corriente, con selector de formato, el toggle de historial y el rango.

## Capabilities

### New Capabilities
- `exportacion-cuenta-corriente`: qué contiene un documento exportado de cuenta corriente, en qué formatos, cómo se comporta el historial opcional y su rango, y por qué el documento tiene que reconciliar consigo mismo.
- `exportacion-cuenta-corriente-frontend`: cómo se dispara y se descarga la exportación desde las dos vistas de cuenta corriente.

### Modified Capabilities

Ninguna. Los endpoints existentes de cuenta corriente no cambian su contrato: la exportación **lee** el mismo cálculo on-demand que ya sirven y no altera ninguna respuesta actual.

## Impact

- **Backend** (`facturas-proveedores-api`):
  - Dependencias nuevas: generación de PDF y de XLSX. **Restricción dura del entorno**: el VPS es Oracle Free Tier con **1 GB de RAM**, así que quedan descartadas las librerías que arrastran binarios de sistema (cairo/pango). Se eligen alternativas Python puras y livianas — la decisión concreta y su justificación van en `design.md`.
  - Un servicio de exportación nuevo que **reutiliza** `CuentaCorrienteService` y `CuentaCorrienteClienteService`. **Prohibido recalcular saldo o historial por otra vía**: si el export y la pantalla pueden divergir, algún día divergen, y nadie va a poder decir cuál tiene razón (RN-SALDO, RN-FIFO, D-01).
  - Dos rutas nuevas, con la autorización por `negocio_id` en el **service layer** como todo el resto (Regla Dura #3 y #8).
  - `tests/test_c28_scoping_axis_guard.py` es paramétrico sobre los archivos de `services/`: sumar un servicio **mueve el conteo de tests colectados**. Es esperado, no una falla.
- **Frontend** (`facturas-proveedores-web`): disparo de descarga en las dos vistas de cuenta corriente. Sin cálculo de montos del lado del cliente.
- **Sin migración.** Ninguna tabla cambia; nada del export se persiste.
- **Riesgo principal**: una cuenta con miles de movimientos generando un PDF en un proceso de 1 GB. El límite y su comportamiento se definen en `design.md`.
