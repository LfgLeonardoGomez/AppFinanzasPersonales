# Layout

Version: 1.0
Estado: Documento oficial de producto
Audiencia: Diseño (Claude Design), Ingeniería

Reglas estructurales de distribución. El objetivo de este documento es garantizar
**consistencia**: que no ocurra que dentro de seis meses una pantalla tenga un
ancho, otra otro, un sidebar de un tamaño y otro distinto.

> Nota: este documento fija **reglas y restricciones**, no valores exactos
> (píxeles, anchos). El diseño elige cada valor **una vez** y lo aplica de forma
> idéntica en toda la aplicación. La libertad creativa es del diseño; la
> consistencia es obligatoria.

---

## Consistencia estructural

- **Un único ancho máximo de contenido**, aplicado en todas las pantallas.
- **Una única definición de navegación** (sidebar o equivalente): mismo ancho,
  misma posición, mismo comportamiento en todas partes.
- **Un único sistema de espaciado** (padding, márgenes, separaciones). Las
  pantallas se sienten parte del mismo producto porque respiran igual.
- **Una única grilla / sistema de columnas** para alinear contenido.

Definir cada uno de estos valores una sola vez y no volver a improvisarlos.

---

## Aprovechar el alto visible

Cada pantalla debe usar correctamente el alto disponible sin obligar a hacer
scroll para tareas simples (`UX_PRINCIPLES.md`, Regla 11).

- El scroll existe **solo** para contenido generado por el usuario: listas,
  historiales y tablas.
- El scroll **nunca** debe aparecer por mala distribución del espacio o por
  formularios innecesariamente largos.

---

## Navegación

- Acceso claro y permanente a los módulos principales: Home, Proveedores,
  Facturas, Pagos, Perfil.
- La navegación es discreta: orienta, no compite con el contenido.
- Las acciones relacionadas permanecen juntas (`UX_PRINCIPLES.md`, Regla 12):
  desde un proveedor, cargar una factura o registrar un pago debe estar a mano.

---

## Modales, sheets y overlays

Son el mecanismo preferido para tareas puntuales, para evitar cambios de contexto
(`UX_PRINCIPLES.md`, Regla 6).

- **La carga de facturas y pagos ocurre en un modal**, no en una pantalla
  separada. Es el mismo modal para el origen IA y para el manual
  (`IA_EXPERIENCE.md`).
- Un modal tiene un único objetivo y una única acción principal.
- Al cerrar un modal, el usuario vuelve exactamente a donde estaba.
- Comportamiento consistente de apertura y cierre en toda la app (se especifica el
  movimiento en `MOTION.md`).

---

## Tablas y listas

El único lugar donde el contenido tabular es correcto es donde lo genera el
usuario. El caso central es la **cuenta corriente del proveedor**: el listado de
facturas y pagos con su saldo.

- Esta vista es tabular por naturaleza, pero debe sentirse **liviana**: mucho
  aire, jerarquía clara, sin bordes pesados, sin ruido.
- El saldo se muestra como un valor **derivado** (se calcula, no se guarda) y debe
  ser legible de un vistazo.
- Nunca convertir el resto de la app en tablas: fuera de este tipo de contenido,
  se prefieren cards y listas simples.

---

## Responsive

- El diseño se piensa para escritorio como experiencia principal, pero debe
  degradar con dignidad en pantallas menores (la app es una PWA).
- Las mismas reglas de consistencia (ancho, espaciado, navegación) tienen su
  equivalente definido para mobile, elegido una sola vez y aplicado en todas
  partes.

---

## Regla de oro del layout

Ante la duda entre agregar un elemento o quitar espacio: **quitar el elemento**.
El layout sirve al contenido esencial, no al revés (`UX_PRINCIPLES.md`, Reglas 10
y 13).
