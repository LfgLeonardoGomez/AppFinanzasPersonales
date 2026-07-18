# UX Principles

Version: 1.0
Estado: Documento oficial de producto
Audiencia: Diseño (Claude Design), Producto e Ingeniería

Estos principios son la base de toda decisión de experiencia. Ante un conflicto,
gana el principio de menor número (los primeros pesan más).

---

## 1. Reducir trabajo tiene prioridad

Si una solución reduce el esfuerzo del usuario, se prefiere —incluso si implica
mayor complejidad técnica.

## 2. La IA es el camino recomendado

Todo proceso manual existe únicamente como alternativa. Nunca al revés. La opción
asistida por IA es la primera que ve el usuario y la más visible.

## 3. Una pantalla, un objetivo

Cada pantalla tiene una única responsabilidad. No se mezclan objetivos en una
misma vista.

## 4. El Home es un punto de entrada, no un dashboard

El Home orienta y da acceso rápido a las tareas frecuentes. No intenta reemplazar
otros módulos ni concentrar métricas.

## 5. Dos clics o menos

Toda acción frecuente debe poder realizarse en dos clics o menos.

## 6. Evitar cambios de contexto

Siempre que sea posible, usar modales, sheets u overlays antes que navegar a otra
pantalla. El usuario mantiene el contexto de dónde estaba.

## 7. No pedir lo que la app puede obtener sola

El usuario no debe escribir información que la aplicación puede interpretar,
inferir o ya tiene.

## 8. Los formularios largos son un fracaso de diseño

Antes de agregar un campo, preguntarse: ¿La IA puede completarlo? ¿Puede
inferirse? ¿Ya existe ese dato? Un formulario largo es el último recurso, no el
primero.

## 9. La acción principal siempre es evidente

Una sola acción principal por pantalla. Nunca varios botones importantes
compitiendo por la atención.

## 10. Cada componente justifica su existencia

Si eliminar un componente no empeora la experiencia, probablemente no debería
existir.

## 11. El scroll no es una solución de layout

Cada pantalla aprovecha correctamente el alto visible. El scroll existe
únicamente para contenido generado por el usuario —tablas, listas, historiales—,
nunca por mala distribución del espacio.

## 12. Las acciones relacionadas permanecen juntas

Proveedor → factura → pago forman una misma cadena de trabajo. No se separan sin
motivo. Desde un proveedor, cargar una factura o registrar un pago debe estar a
mano.

## 13. Lo importante primero, la decoración después

El contenido con mayor valor para el usuario aparece primero en la jerarquía
visual.

## 14. Feedback inmediato, siempre

Toda acción genera respuesta visible: loading, skeleton, toast, animación o
cambio de estado. El usuario nunca espera sin contexto.

## 15. Manual e IA terminan en la misma experiencia

La carga por IA y la carga manual convergen en **el mismo control editable** y en
la **misma confirmación**. No se mantienen dos experiencias distintas para la
misma tarea:

    Importar factura (IA)  →  campos prellenados  →  revisar  →  confirmar  →  guardar
    Carga manual           →  campos vacíos        →  completar → confirmar  →  guardar

Es el mismo modal, el mismo destino, el mismo botón final.

## 16. La aplicación se anticipa

Cuando es posible, sugerir, autocompletar, recordar o inferir —antes de
preguntar.

## 17. Intuitiva desde el primer uso

El usuario nunca debe sentir que está aprendiendo a usar la aplicación.

## 18. Todo tiene un propósito

Cada clic, cada pantalla y cada módulo tienen un propósito claro. Nada existe "por
las dudas".

## 19. Diseñar tareas, no CRUDs

Se diseña alrededor de lo que el usuario quiere lograr, no de operaciones de base
de datos.

    Incorrecto: "Alta de factura"
    Correcto:   "Importar factura"

## 20. La mejor interfaz es la que desaparece

El usuario no debería pensar en la interfaz. Debería pensar únicamente en
completar su tarea.

---

## Cómo medimos una buena experiencia

Una funcionalidad es exitosa cuando:

- Requiere pocos clics.
- Necesita poca explicación.
- Evita formularios innecesarios.
- Permite terminar la tarea rápido.
- Transmite confianza.
