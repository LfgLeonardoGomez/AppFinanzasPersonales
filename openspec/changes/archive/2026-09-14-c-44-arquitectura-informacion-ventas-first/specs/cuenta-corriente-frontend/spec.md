## REMOVED Requirements

### Requirement: Home quick-access surfaces the cuenta-corriente view

**Reason**: El requisito describe una `HomePage` inlineada en `src/app/router.tsx` con una grilla de accesos rápidos ("Cargar factura", "Cargar pago", "Ver proveedores", "Ver facturas", "Ver pagos", "Ver cuenta corriente"). Esa pantalla dejó de existir con el rediseño de UX/UI que se entregó fuera de la numeración de changes: la home pasó a ser un componente propio con otra estructura, y el requisito quedó describiendo algo que ya no está. Este change es el que define qué es la pantalla de inicio —una superficie de acción con la venta como protagonista y sin datos de negocio— así que dejar el requisito vigente pondría al conjunto de specs a contradecirse consigo mismo.

**Migration**: El acceso a la cuenta corriente de un proveedor se conserva íntegro por dos caminos ya especificados y ya implementados: la entrada "Proveedores" de la navegación principal, presente en todas las pantallas (capability `home-y-navegacion`), y el enlace "Ver cuenta corriente" de cada fila del listado de proveedores, que lleva a `/proveedores/:id` (requisito "ProveedoresList rows link to the detail page", que no se toca). Ningún usuario pierde un camino hacia la cuenta corriente; lo que se retira es la obligación de que ese camino arranque en la pantalla de inicio.
