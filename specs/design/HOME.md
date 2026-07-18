# Home

Version: 1.0
Estado: Documento oficial de producto
Audiencia: Diseño (Claude Design)

Especificación de la pantalla de inicio. Esto no es un boceto: describe qué es el
Home, qué debe contener y qué nunca debe contener.

---

## Objetivo

Ser el **punto de entrada** de la aplicación.

El Home orienta al usuario y le da acceso inmediato a lo que hace la mayor parte
del tiempo: cargar información y llegar a sus proveedores. No reemplaza ningún
módulo ni concentra datos que viven en otras pantallas.

Regla que lo gobierna: **el Home es un punto de entrada, no un dashboard**
(`UX_PRINCIPLES.md`, Regla 4).

---

## Lo primero que ve el usuario: la carga con IA

El elemento protagonista del Home es la **carga asistida por IA**. Es lo más
visible, lo más accesible y lo que la aplicación recomienda como camino por
defecto.

Desde el Home, en un gesto, el usuario debe poder **importar una factura o
registrar un pago** aportando una imagen. La IA hace el resto.

Esto no es un botón más: es la expresión visual de la propuesta de valor del
producto ("la aplicación trabaja, el usuario revisa").

---

## Qué debe contener

En orden de jerarquía:

1. **Bienvenida** — breve, humana, orientadora. No decorativa.
2. **Carga con IA** — la acción protagonista (importar factura / registrar pago
   desde imagen). Presencia visual fuerte.
3. **Proveedores principales / frecuentes** — acceso directo a los proveedores
   con los que el usuario más trabaja. Cards, no tabla.
4. **Actividad reciente** — un vistazo liviano a lo último que pasó (últimas
   cargas o movimientos), como cards o lista simple, para dar continuidad.

Y no mucho más. El Home termina donde termina lo esencial.

---

## Qué nunca debe contener

- Gráficos.
- KPIs o métricas.
- Widgets financieros.
- Tablas.
- Saldos totales o reportes (eso vive en la cuenta corriente de cada proveedor).
- Scroll innecesario por mala distribución del espacio.

Si el Home empieza a parecer un panel de control, se perdió el objetivo.

---

## Sensaciones que debe producir

- Simple.
- Limpio.
- Ordenado.
- Minimalista.
- Inteligente.

El Home es la carta de presentación del producto: si transmite estas sensaciones,
el resto de la aplicación las hereda (`BRAND.md`).

---

## Relación con el resto de la app

- Desde "proveedores principales" se llega a la **cuenta corriente** de un
  proveedor (donde sí vive el detalle: facturas, pagos, saldo calculado).
- Desde "carga con IA" se abre el **flujo único de carga** (`IA_EXPERIENCE.md`).
- El Home nunca duplica información ni funciones que ya viven en esos módulos: solo
  abre la puerta a ellos.
