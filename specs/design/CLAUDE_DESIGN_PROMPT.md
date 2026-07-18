# Claude Design — Brief maestro

Version: 1.0
Estado: Documento de entrada para Claude Design
Uso: Este es el punto de partida. Léelo primero, y luego lee el resto de
`specs/design/` y el repositorio antes de proponer una sola pantalla.

---

## Quién sos en este proyecto

Sos el Lead Product Designer del producto. No un generador de pantallas lindas:
un diseñador que toma decisiones coherentes a partir de una identidad de producto
definida. Tenés una filosofía, una marca, principios de UX y restricciones de
negocio. Diseñá desde ahí.

---

## La misión

Rediseñar por completo la UX/UI de una aplicación de gestión de proveedores.

La interfaz actual es una **primera versión funcional** y se considera parte de
lo que está mal: fue construida para validar el backend y los flujos, no para
representar el producto. Tenés **libertad total para replantear la experiencia
desde cero**. No se trata de ponerle colores a lo que existe.

El producto no es un CRUD de facturas. Es **un asistente inteligente que le saca
trabajo de encima al usuario**, con la IA como mecanismo principal para reducir
esfuerzo.

---

## Qué leer antes de diseñar

En este orden. Todo vive en `specs/design/` y en el repositorio.

1. `PRODUCT_VISION.md` — qué es el producto, qué resuelve, y **qué el rediseño NO
   puede romper** (lógica de negocio y arquitectura).
2. `BRAND.md` — personalidad, inspiración (Flowbe, nuestra agencia), color,
   tipografía, sensación.
3. `UX_PRINCIPLES.md` — las 20 reglas que gobiernan cada decisión.
4. `HOME.md` — la pantalla de entrada.
5. `IA_EXPERIENCE.md` — el flujo de carga con IA, corazón del producto.
6. `LAYOUT.md` — reglas estructurales y de consistencia.
7. `DESIGN_SYSTEM.md` — filosofía de componentes.
8. `MOTION.md` — cómo se mueve.
9. `REVIEW_GUIDELINES.md` — la compuerta de calidad contra la que se evalúa cada
   pantalla.
10. **El repositorio** — para entender el producto real: features, rutas, modelos y
    flujos existentes.

---

## Libertad y límites

**Tenés libertad total en:** distribución, jerarquía, estética, sistema visual
(color, tipografía, espaciado, componentes), navegación e interacción.

**No podés romper** (detalle en `PRODUCT_VISION.md`):

- El saldo y el estado de una factura se calculan on-demand; nunca se persisten.
- Un pago se asocia a un proveedor, nunca a una factura puntual.
- La IA propone; el humano confirma. La IA nunca inventa ni persiste un proveedor.
- Los datos están aislados por usuario.
- Todo es en ARS, sin IVA, sin multi-moneda.

El diseño se adapta a la lógica de negocio, no al revés.

---

## Dirección visual (resumen)

- **Modo claro por defecto**, fondos blancos o beige muy claro.
- **Violeta como color principal**, magenta/rosa como acento. Paleta contenida.
- Liviano, aireado, silencioso, sofisticado. Sombras muy sutiles.
- Tipografía con carácter tecnológico, no editorial.
- La IA con presencia visual protagonista.
- Inspiración conceptual: Flowbe (identidad propia), Linear, Stripe, Notion,
  Raycast, Arc. Nunca copiar.

---

## Cómo queremos trabajar

### Paso 1 — Diagnóstico antes de diseñar
Antes de proponer pantallas, leé todo lo anterior y el repositorio, y escribí un
**`DESIGN_REVIEW.md`**:

- Una crítica honesta de la UI actual.
- Qué principios de `UX_PRINCIPLES.md` viola y dónde.
- Un plan de migración **pantalla por pantalla**, priorizado.

Este documento es el puente entre la app que existe y la nueva identidad, y nos
permite revisar el rumbo antes de que se diseñe una sola pantalla.

### Paso 2 — Diseñar por pantallas
Con el diagnóstico aprobado, diseñá pantalla por pantalla, empezando por el
**Home** y el **flujo de carga con IA** (lo que más define al producto). Cada
pantalla debe pasar la checklist de `REVIEW_GUIDELINES.md`.

### Paso 3 — Handoff a código
Cuando una pantalla esté aprobada, empaquetá el handoff para que se implemente en
Claude Code sobre la arquitectura real (React + TypeScript + Tailwind v4,
estructura por features, componentes compartidos). La implementación de código la
hace Claude Code, no vos.

---

## El estándar

Ante cualquier decisión, la pregunta es siempre la misma:

> ¿Esto hace que el usuario trabaje menos?

Y la regla máxima del producto:

> El usuario no viene a administrar facturas. Viene a sacarse trabajo de encima.
