# Design Review — Diagnóstico

Version: 1.0 · Autor: Claude Design

## Crítica de la UI actual

La app actual (navy `#0a2540` + violeta `#635bff` + crema, Playfair Display +
DM Sans) está bien ejecutada técnicamente pero fue diseñada como **dashboard de
gestión**, no como **asistente**. Es la primera versión funcional que el brief
pide reemplazar.

**Home (`HomePage.tsx`)** — viola directamente la Regla 4 (`UX_PRINCIPLES.md`) y
la sección "qué nunca debe contener" de `HOME.md`:
- Se llama a sí mismo "Panel de control" y usa un bento-grid de accesos rápidos:
  exactamente el patrón de dashboard que el producto prohíbe.
- La carga con IA no tiene presencia protagonista: es una card más
  ("Cargar factura") del mismo tamaño y jerarquía que "Cargar pago", "Ver pagos",
  "Ver facturas", "Mi perfil". No hay ninguna superficie visual que diga "esto
  lo hace la IA por vos" (`BRAND.md`, `IA_EXPERIENCE.md`).
- No hay proveedores frecuentes ni actividad reciente — lo que `HOME.md` pide
  como jerarquía 3 y 4 no existe.
- Serif editorial (Playfair) en encabezados: contradice "tipografía con carácter
  tecnológico, no editorial" (`BRAND.md`).

**Flujo de carga (`FacturaFormPage.tsx` + `PropuestaIAModal`)** — viola la Regla 15
y la sección "un solo flujo" de `IA_EXPERIENCE.md`:
- Existe un `ModeSelector` intermedio ("Cargar con foto" vs. "Cargar manual") que
  el usuario debe resolver antes de llegar a cualquier campo — un paso y una
  decisión que el flujo especificado no contempla. El origen debería ser un
  detalle dentro del mismo modal, no una bifurcación de pantalla completa.
- El modal de IA y el formulario manual son dos superficies visualmente
  distintas (un modal vs. una página con `FacturaForm`), no "el mismo control
  editable" que pide la Regla 15.
- No hay tratamiento visual propio para el estado de la IA trabajando —
  se apoya en botones y textos, no en una presencia reconocible.

**Cuenta corriente / detalle de proveedor** — es el módulo más alineado con el
espíritu del producto: tabla liviana, saldo derivado explícito ("Calculado al
momento..."), acciones relacionadas juntas (factura/pago/editar). Se conserva
como referencia estructural, pero necesita el nuevo sistema visual.

**Sistema visual global** — navy como color dominante (botones primarios, headers,
iconos) con el violeta relegado a acentos ocasionales, exactamente al revés de
`BRAND.md` ("violeta como color principal"). Falta el magenta/rosa como acento
por completo. Radios, sombras y tipografía están bien encaminados y se
conservan como base.

## Plan de migración, priorizado

1. **Home** — reemplazar el bento-grid dashboard por: bienvenida breve + carga
   IA protagonista (superficie propia, no una card entre otras) + proveedores
   frecuentes (cards) + actividad reciente (lista liviana). Sin métricas, sin
   grillas de accesos.
2. **Flujo de carga unificado (factura/pago)** — un solo modal con toggle
   imagen/manual integrado (no un selector de pantalla previo), estado de IA
   procesando con identidad visual propia, campos editables compartidos,
   `SupplierSearch` para sugerencia/cambio/creación de proveedor, una única
   confirmación.
3. **Detalle de proveedor + cuenta corriente** — retipografiar y recolorear
   sobre el nuevo sistema; mantener la estructura (header de acciones + saldo +
   tabla + historial), quitar el serif editorial.
4. **Listados (proveedores, facturas, pagos)** — cards/listas de baja densidad,
   nunca tablas fuera de cuenta corriente.
5. **Auth, perfil** — al final; menor impacto en la percepción del producto.

## Dirección visual definida para el rediseño

- **Tipografía**: sans tecnológica para todo (headings incluidos) — se
  reemplaza Playfair Display. Un solo peso de familia, variando grosor.
- **Color**: violeta como protagonista real (fondos de superficie IA, foco,
  acción primaria), magenta/rosa como acento puntual (badges de estado IA,
  realces). Navy se retira como color de marca; sobrevive solo como neutro de
  texto si hace falta un ink frío.
- **Fondos**: blanco / beige muy claro, sin crema saturado.
- Se detalla en las pantallas que siguen (Home + flujo IA primero, según el
  brief).
