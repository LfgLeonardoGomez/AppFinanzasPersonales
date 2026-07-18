# Design System

Version: 1.0
Estado: Documento oficial de producto
Audiencia: Diseño (Claude Design)

Este documento define la **filosofía** del sistema de componentes, no sus valores.
El diseño inventa la paleta, la tipografía, los tamaños y las sombras exactas —a
partir de este criterio, del repositorio y de los assets de marca de Flowbe. Aquí
se define **cómo deben sentirse y comportarse** los componentes.

---

## Filosofía general

- Mucho espacio.
- Pocas líneas.
- Jerarquía fuerte.
- Mucho blanco (o beige muy claro).
- Bordes suaves.
- Sombras extremadamente sutiles.
- Acciones visibles.

Un componente bien diseñado se siente **liviano**: aporta contenido, no peso
visual.

---

## Reglas transversales

Aplican a todos los componentes:

- **Cada componente justifica su existencia** (`UX_PRINCIPLES.md`, Regla 10). Si se
  puede quitar sin perder valor, se quita.
- **Una sola acción principal por contexto.** El resto son secundarias y se ven
  como secundarias.
- **Consistencia absoluta.** Un mismo tipo de elemento se ve y se comporta igual en
  toda la app. Se define una vez.
- **Estados siempre claros.** Todo elemento interactivo comunica reposo, hover,
  foco, activo, deshabilitado, cargando y error.
- **Accesible por defecto.** Foco visible, contraste suficiente, texto legible,
  targets cómodos.

---

## Archetipos de componente que el producto necesita

Descripción por comportamiento y sensación, no por valores.

### Card
El contenedor base. Mucho aire interno, bordes redondeados, sombra apenas
perceptible. Agrupa información relacionada. Es el ladrillo del Home y de casi
toda la app.

### Botón
Jerarquía obvia: primario (una acción protagonista), secundario (apoyo),
terciario/sutil (acciones menores). El primario es inconfundible. Nunca dos
primarios compitiendo en la misma vista.

### Campo de entrada
Etiqueta clara, estado de error explícito, ícono opcional. Se siente liviano, no
encajonado. El foco es evidente y calmo. La mayoría de las veces llega
**prellenado por la IA**, no vacío.

### Modal / sheet
El lugar donde ocurren las tareas puntuales —sobre todo la carga de facturas y
pagos. Un objetivo, una acción principal, cierre que devuelve al usuario a donde
estaba. Es el corazón del flujo de carga unificado (`IA_EXPERIENCE.md`).

### Indicador de estado (badge)
Comunica el estado de una factura (derivado, calculado on-demand) o el resultado
de una acción. Legible de un vistazo, sin saturar de color.

### Presencia de IA
La IA tiene un tratamiento visual propio y reconocible: cuando aparece, se nota
que "esto lo hace la aplicación por vos". Es protagonista, nunca decorativa.

### Estado vacío
Cuando no hay datos, se guía con calma hacia la primera acción útil (idealmente,
la carga con IA). Nunca una pantalla muerta.

### Estado de carga
Feedback inmediato y silencioso (skeleton/shimmer preferido a spinner). El usuario
nunca espera sin contexto (`UX_PRINCIPLES.md`, Regla 14).

### Feedback transitorio (toast)
Confirmaciones y errores efímeros, discretos, que no interrumpen el flujo.

### Búsqueda de proveedor
Control de selección/creación de proveedor, usado tanto en el flujo de IA como en
el manual. Permite aceptar la sugerencia de la IA, cambiarla o crear un proveedor
en el momento, sin salir del flujo.

---

## Jerarquía visual

- Lo importante primero, siempre (`UX_PRINCIPLES.md`, Regla 13).
- El contenido manda; la decoración no compite con él.
- El color se usa con intención: guía la atención, no la dispersa. Nunca demasiados
  colores en pantalla al mismo tiempo (`BRAND.md`).

---

## Densidad

La aplicación es **de baja densidad**: prefiere el aire a la compactación. No es un
panel de operador que muestra todo a la vez; es un asistente que muestra lo justo.
La única excepción es el contenido tabular del usuario (cuenta corriente), que
puede ser más denso, pero aun así liviano.
