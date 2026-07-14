/**
 * Imperative navigation helper used by the Axios interceptor.
 *
 * The interceptor lives outside the React tree, so it cannot use useNavigate.
 * We expose a setter so router.tsx can inject the navigate function from
 * createBrowserRouter (D-C04-3). Falls back to window.location.assign if
 * the router hasn't been mounted yet.
 */

type NavigateFn = (path: string) => void

let _navigate: NavigateFn | null = null

export function setNavigate(fn: NavigateFn): void {
  _navigate = fn
}

export function navigateToLogin(): void {
  if (_navigate) {
    _navigate('/login')
  } else {
    // Fallback: full page reload to /login (clears all SPA state cleanly)
    window.location.assign('/login')
  }
}
