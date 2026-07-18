# Review Guidelines

Version: 1.0
Estado: Documento oficial de producto
Audiencia: Diseño (Claude Design), Producto

Cómo evaluar cualquier pantalla o propuesta de diseño antes de aceptarla. Esta es
la compuerta de calidad: si una pantalla no pasa estas verificaciones, se rehace,
no se aprueba.

---

## La pregunta que abre toda revisión

> ¿Esta pantalla hace que el usuario trabaje menos?

Si no, no importa cuán linda sea: no cumple el objetivo del producto.

---

## Checklist de aceptación

Una pantalla está lista cuando puede responder "sí" a todo lo siguiente.

### Propósito
- [ ] Tiene un **único objetivo** claro (`UX_PRINCIPLES.md`, Regla 3).
- [ ] Cada componente presente justifica su existencia (Regla 10).
- [ ] Lo más importante aparece primero en la jerarquía (Regla 13).

### Trabajo del usuario
- [ ] La acción principal es evidente y no compite con otras (Regla 9).
- [ ] La tarea frecuente se resuelve en dos clics o menos (Regla 5).
- [ ] No se pide ningún dato que la app pueda obtener, inferir o ya tenga (Regla 7).
- [ ] Si hay formulario, es lo más corto posible; la IA prellena lo que puede
      (Regla 8).
- [ ] Si es una tarea repetitiva, la IA es el camino visible y recomendado
      (Regla 2).

### Estructura y espacio
- [ ] Respeta el ancho, el espaciado y la navegación canónicos (`LAYOUT.md`).
- [ ] Aprovecha el alto visible; no hay scroll por mala distribución (Regla 11).
- [ ] El scroll, si existe, es solo para contenido del usuario (listas, tablas,
      historiales).

### Marca y sensación
- [ ] Se siente liviana, aireada y ordenada (`BRAND.md`).
- [ ] Modo claro, fondos blancos/beige, paleta contenida, sombras sutiles.
- [ ] La IA tiene presencia visible, nunca escondida.

### Estados y feedback
- [ ] Toda acción da feedback inmediato (loading, skeleton, toast, cambio visual)
      (Regla 14).
- [ ] Están cubiertos los estados: vacío, cargando, error, éxito.

### Movimiento
- [ ] Las animaciones son casi imperceptibles, sin rebotes ni exageración
      (`MOTION.md`).

### Consistencia con el negocio
- [ ] No rompe ninguna restricción de `PRODUCT_VISION.md` ("lo que NO puede
      romper"): saldo/estado derivados, pago→proveedor, IA propone-humano confirma,
      aislamiento por usuario, ARS sin IVA.
- [ ] Manual e IA convergen en el mismo modal y la misma confirmación (Regla 15).

---

## Señales de alarma (rechazar y rehacer)

- Parece un dashboard o un panel de ERP.
- Formularios largos como primera opción.
- Múltiples acciones importantes compitiendo.
- Tablas o métricas fuera de lugar (por ejemplo, en el Home).
- Scroll para tareas simples.
- Demasiados colores a la vez.
- Animaciones que se notan o que hacen esperar.
- El usuario tendría que "aprender" la pantalla (Regla 17).

---

## Criterio final

Ante cualquier duda entre dos opciones, gana la que **hace trabajar menos al
usuario**. La estética nunca se impone sobre la velocidad de uso.
