/**
 * Sign→color convention for a supplier's saldo (C-44, D4).
 *
 * Split out from `ProveedoresList.tsx` into its own module: a `.tsx` file
 * that exports both a component and a plain function trips
 * `react-refresh/only-export-components` (`eslint --max-warnings 0` fails
 * the build on it). `ProveedoresList` and `ProveedoresFrecuentes` share
 * this — the two panels live on the same `/proveedores` screen and a
 * supplier's saldo cannot read as debt in one and credit in the other.
 */
export function saldoColorClass(saldo: number): string {
  if (saldo > 0) return 'text-danger'
  if (saldo < 0) return 'text-success'
  return 'text-ink'
}
