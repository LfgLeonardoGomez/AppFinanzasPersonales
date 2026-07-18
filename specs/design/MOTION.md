# Motion

Version: 1.0
Estado: Documento oficial de producto
Audiencia: Diseño (Claude Design), Ingeniería

El movimiento es una de las cosas que más separa un SaaS profesional de uno
amateur. En este producto, la animación **mejora la experiencia sin llamar la
atención**.

> Este documento fija principios y rangos de referencia, no valores cerrados. El
> diseño afina los tiempos exactos. La regla es la sensación, no el número.

---

## Principio central

Toda animación es **casi imperceptible**. Si el usuario "nota la animación", está
mal. El movimiento comunica (algo cambió, algo se abrió, algo respondió), nunca
decora.

---

## Reglas

- **Rápido.** Las transiciones de interacción son cortas (referencia: hover en el
  orden de 80–150 ms). Lo instantáneo se siente instantáneo.
- **Suave.** Curvas de ease naturales (ease-out para entradas). Nada lineal, nada
  mecánico.
- **Sin rebotes.** Nunca efectos elásticos, bounces ni sobre-animación.
- **Sin exageración.** Nada de movimientos largos, llamativos o "efectistas".
- **Con propósito.** Cada animación responde a una acción del usuario o comunica un
  cambio de estado. Si no comunica nada, no va.
- **Respetar preferencias.** Se honra `prefers-reduced-motion`: quien pide menos
  movimiento, recibe menos movimiento.

---

## Patrones por elemento

| Elemento | Movimiento | Sensación |
|----------|-----------|-----------|
| Hover (botones, cards) | Cambio muy leve y rápido (color, elevación mínima) | Responde, no salta |
| Cards | Elevación apenas perceptible al hover | Profundidad sutil |
| Modales / sheets | Fade + scale suave al abrir; reverso al cerrar | Aparece con calma |
| Carga (skeleton) | Shimmer continuo y silencioso | "Está trabajando" |
| Toasts | Entrada y salida suaves, no invasivas | Informa sin interrumpir |
| Estados de IA | Transición clara entre procesando → listo | Genera confianza |

---

## Lo que nunca hacemos

- Rebotes o efectos elásticos.
- Animaciones que retrasan la tarea del usuario.
- Movimiento decorativo sin significado.
- Transiciones largas que hacen esperar.

---

## Regla de oro del movimiento

Si una animación mejora la estética pero hace más lenta la tarea, **se rechaza**
(`UX_PRINCIPLES.md`, Regla 1). La velocidad de uso siempre gana.
