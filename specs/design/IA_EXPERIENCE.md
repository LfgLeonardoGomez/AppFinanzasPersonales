# IA Experience

Version: 1.0
Estado: Documento oficial de producto
Audiencia: Diseño (Claude Design), Producto e Ingeniería

Este es el documento que diferencia a la aplicación. Describe cómo se siente y se
comporta la carga asistida por IA, y cómo converge con la carga manual en una
sola experiencia.

---

## Principio central

La IA es el **mecanismo principal** para cargar información, no una función
secundaria. Toda tarea de carga (facturas y pagos) se piensa primero como una
tarea asistida por IA, y solo después como una tarea manual.

---

## Un solo flujo, dos orígenes

Cargar una factura o un pago es **una sola experiencia**, servida por **el mismo
modal**, sin importar de dónde vienen los datos:

    ┌─ Origen IMAGEN (recomendado) → la IA interpreta el documento y prellena los campos
    │
    └─ Origen MANUAL               → los mismos campos arrancan vacíos

A partir de ahí, ambos caminos son idénticos: el usuario ve el mismo control,
edita los mismos campos, confirma una vez y los datos se persisten.

No existe un modal para la IA y un formulario separado para la carga manual. Es
el mismo destino editable y la misma confirmación (`UX_PRINCIPLES.md`, Regla 15).

---

## El flujo, paso a paso

1. **Iniciar carga.** El usuario elige qué cargar (factura o pago) y, si tiene
   una imagen, la aporta. La carga con imagen es el camino recomendado y más
   visible.
2. **La IA interpreta.** Al aportar imagen, la aplicación muestra un estado de
   procesamiento claro. La IA extrae únicamente los datos de cabecera y prellena
   los campos.
3. **Revisar y editar.** El usuario ve todos los campos ya completos (o vacíos,
   si fue manual) en un control editable. Puede corregir cualquier valor. Nada se
   guarda todavía.
4. **Proveedor.** La IA **sugiere** el proveedor a partir del documento. El
   usuario puede aceptarlo, cambiarlo o crear uno nuevo en el momento, sin salir
   del flujo. La IA nunca asigna ni crea un proveedor por su cuenta.
5. **Confirmar.** Un único paso final. Al confirmar, los datos se persisten.
6. **Continuidad.** Tras confirmar, el usuario llega a la **cuenta corriente del
   proveedor**, donde ve el impacto de lo que acaba de cargar (saldo recalculado).

---

## Reglas de la experiencia con IA

Estas reglas son inamovibles: reflejan la lógica de negocio del producto.

- **La IA propone, el humano confirma.** Ningún dato asistido por IA se persiste
  sin pasar por la revisión editable del usuario. Esto garantiza confianza.
- **La IA nunca inventa, asigna ni persiste un proveedor por su cuenta.** Lo
  sugiere; el usuario decide.
- **La IA extrae solo la cabecera**, a partir de imágenes. No procesa otros
  formatos ni inventa datos que no están en el documento.
- **Manual e IA convergen.** Nunca se mantienen dos experiencias distintas para la
  misma tarea.

---

## Cómo debe sentirse

- **Mágico pero controlado.** El usuario siente que la aplicación hizo el trabajo,
  pero mantiene el control total: todo es revisable y editable.
- **Rápido.** Del documento a los datos guardados en la menor cantidad de pasos
  posible. Confirmar es el único trabajo real que queda.
- **Confiable.** Los estados (procesando, listo, error) son siempre claros. Si la
  IA no pudo interpretar algo, se comunica sin fricción y el usuario completa a
  mano en el mismo lugar.

---

## Presencia visual de la IA

La IA tiene identidad propia y presencia protagonista (`BRAND.md`). Es lo primero
que el usuario ve cuando va a cargar algo, tanto en el Home como dentro de cada
módulo. Nunca aparece escondida en un menú ni como una opción secundaria frente a
la carga manual.

---

## Alcance

Este flujo aplica por igual a **facturas** y a **pagos**. La experiencia es la
misma; solo cambian los campos propios de cada tipo.
