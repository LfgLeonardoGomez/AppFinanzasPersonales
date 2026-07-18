# Product Vision

Version: 1.0
Estado: Documento oficial de producto
Audiencia: Diseño (Claude Design), Producto e Ingeniería

---

## Qué es esta aplicación

Un asistente inteligente para gestionar proveedores.

No es un ERP. No es un sistema de carga de facturas. No es un panel contable.

Es una herramienta que existe para que una persona dedique **menos tiempo** a
tareas administrativas y más tiempo a su negocio. La inteligencia artificial no
es una característica adicional: es el **mecanismo principal** mediante el cual la
aplicación reduce trabajo.

---

## La pregunta que gobierna cada decisión

Toda decisión de producto, diseño o desarrollo debe responder:

> ¿Esta decisión hace que el usuario trabaje menos?

Si la respuesta es "no", probablemente no sea la decisión correcta.

---

## El problema que resolvemos

Administrar proveedores hoy suele implicar:

- Cargar facturas a mano.
- Completar formularios largos.
- Buscar proveedores una y otra vez.
- Registrar pagos.
- Consultar saldos.
- Saltar entre múltiples pantallas.

Nuestro objetivo es **eliminar la mayor cantidad posible de esos pasos**.

---

## La propuesta de valor

El usuario no debería invertir tiempo cargando datos.

La aplicación interpreta documentos, completa información automáticamente y
presenta únicamente lo que requiere validación humana.

**El usuario revisa. La aplicación trabaja.**

---

## Cómo debe sentirse

| Momento | Sensación que debe producir |
|---------|-----------------------------|
| Al abrir la app | "Todo está donde esperaba." |
| Al usar IA | "La aplicación hizo el trabajo por mí." |
| Al terminar una tarea | "Fue mucho más rápido de lo que imaginaba." |

La app debe sentirse como un **asistente**: moderno, profesional, inteligente,
rápido, limpio, confiable y simple. Nunca burocrática, pesada, técnica,
sobrecargada ni parecida a un ERP tradicional.

---

## Prioridades, en orden

1. Reducir trabajo.
2. Reducir clics.
3. Reducir tiempo.
4. Reducir errores.
5. Reducir carga cognitiva.

Nunca priorizamos estética por encima de la experiencia de uso.

---

## El rol de la IA

- La IA no es un chatbot.
- La IA no es un accesorio escondido en un menú.
- La IA forma parte del flujo principal del producto.

Siempre que exista una tarea repetitiva, se evalúa **primero** una solución con
IA antes que una manual. La carga manual existe como alternativa, nunca como
camino por defecto.

---

## Un solo flujo para cargar, no dos

Cargar una factura o un pago es **una sola experiencia**, sin importar el origen
de los datos:

- Si el usuario aporta una **imagen**, la IA interpreta el documento y prellena
  los campos.
- Si el usuario carga **manualmente**, los mismos campos arrancan vacíos.

En ambos casos el usuario ve **el mismo control**, edita **los mismos campos**,
confirma una vez y los datos se persisten. No existe un modal para la IA y un
formulario separado para lo manual: es el mismo destino editable, y confirmar es
el único paso final. (El detalle de este flujo se especifica en
`IA_EXPERIENCE.md` y `LAYOUT.md`.)

---

## Qué nunca queremos construir

- Dashboards llenos de métricas.
- Pantallas saturadas.
- Formularios eternos.
- Interfaces que parezcan generadas automáticamente.
- Que el usuario sienta que está "cargando datos" en lugar de confirmar
  información que la aplicación ya entendió.

---

## Alcance del rediseño

Este es un **rediseño de UX/UI desde cero**. La interfaz actual se considera una
primera versión funcional. El diseño tiene libertad total para replantear la
experiencia completa —no se trata de "ponerle colores a lo que ya existe—,
siempre que respete las restricciones del apartado siguiente.

### Lo que el rediseño PUEDE cambiar libremente

- La distribución, jerarquía y estética de todas las pantallas.
- El sistema visual completo (color, tipografía, espaciado, componentes).
- Los patrones de navegación e interacción.
- La manera en que se presenta y se accede a cada tarea.

### Lo que el rediseño NO PUEDE romper

La lógica de negocio, los flujos de datos y la arquitectura existente son
inamovibles. El diseño debe adaptarse a ellos, no al revés:

- **El saldo y el estado de una factura se calculan on-demand**, nunca se
  persisten. La UI los muestra como valores derivados.
- **Un pago se asocia a un proveedor, nunca a una factura puntual.** No existe el
  concepto de "pagar una factura"; existe el de "registrar un pago a un
  proveedor".
- **La IA propone; el humano confirma.** La IA nunca inventa, asigna ni persiste
  un proveedor por su cuenta. Todo dato asistido por IA pasa por una revisión
  editable antes de guardarse.
- **Los datos están aislados por usuario.** Un usuario nunca ve ni accede a
  información de otro.
- **Todo es en pesos argentinos (ARS).** Sin multi-moneda, sin IVA, sin
  desglose impositivo.

---

## Regla máxima

Toda decisión debe respetar esta frase:

> El usuario no viene a administrar facturas.
> Viene a sacarse trabajo de encima.
