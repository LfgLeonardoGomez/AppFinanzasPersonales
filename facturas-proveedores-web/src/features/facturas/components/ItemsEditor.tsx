/**
 * ItemsEditor — dynamic line items for invoice create/edit forms.
 *
 * Manages an array of { descripcion, cantidad, precio_unitario } rows.
 * Computes sum(cantidad * precio_unitario) and shows a non-blocking warning
 * when it differs from monto_total (RN-FAC-04).
 *
 * INVARIANT: the sum warning is advisory only — submit is NEVER blocked.
 * The authoritative mismatch signal is the backend response items_sum_mismatch.
 *
 * Epsilon comparison: differences < 0.01 are ignored to avoid JS float drift.
 */
import type { FacturaItemCreate } from '@shared/api/api'
import { formatMonto } from '@shared/utils/currency'

const EPSILON = 0.01

interface ItemsEditorProps {
  items: FacturaItemCreate[]
  montoTotal: number
  onChange: (items: FacturaItemCreate[]) => void
}

function computeSum(items: FacturaItemCreate[]): number {
  return items.reduce((acc, item) => acc + item.cantidad * item.precio_unitario, 0)
}

function hasMismatch(items: FacturaItemCreate[], montoTotal: number): boolean {
  if (items.length === 0) return false
  const sum = computeSum(items)
  return Math.abs(sum - montoTotal) >= EPSILON
}

export function ItemsEditor({ items, montoTotal, onChange }: ItemsEditorProps) {
  function handleAdd() {
    onChange([...items, { descripcion: '', cantidad: 1, precio_unitario: 0 }])
  }

  function handleRemove(index: number) {
    onChange(items.filter((_, i) => i !== index))
  }

  function handleChange(
    index: number,
    field: keyof FacturaItemCreate,
    value: string,
  ) {
    const updated = items.map((item, i) => {
      if (i !== index) return item
      if (field === 'cantidad' || field === 'precio_unitario') {
        return { ...item, [field]: parseFloat(value) || 0 }
      }
      return { ...item, [field]: value }
    })
    onChange(updated)
  }

  const showWarning = hasMismatch(items, montoTotal)

  return (
    <div>
      <table>
        <thead>
          <tr>
            <th>Descripción</th>
            <th>Cantidad</th>
            <th>Precio unitario</th>
            <th>Subtotal</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td>
                <input
                  type="text"
                  value={item.descripcion}
                  onChange={(e) => handleChange(index, 'descripcion', e.target.value)}
                  placeholder="Descripción del ítem"
                  aria-label={`Descripción del ítem ${index + 1}`}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={item.cantidad}
                  onChange={(e) => handleChange(index, 'cantidad', e.target.value)}
                  aria-label={`Cantidad del ítem ${index + 1}`}
                />
              </td>
              <td>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.precio_unitario}
                  onChange={(e) => handleChange(index, 'precio_unitario', e.target.value)}
                  aria-label={`Precio unitario del ítem ${index + 1}`}
                />
              </td>
              <td>
                {formatMonto(item.cantidad * item.precio_unitario)}
              </td>
              <td>
                <button
                  type="button"
                  onClick={() => handleRemove(index)}
                  aria-label={`Eliminar ítem ${index + 1}`}
                >
                  Eliminar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <button type="button" onClick={handleAdd}>
        Agregar ítem
      </button>

      {showWarning && (
        <p role="alert" aria-live="polite">
          La suma de los ítems ({formatMonto(computeSum(items))}) difiere del monto total. Podés guardar de todas formas.
        </p>
      )}
    </div>
  )
}

export default ItemsEditor
