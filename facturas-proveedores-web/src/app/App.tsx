/**
 * App root component.
 *
 * C-04: mounts the RouterProvider with the app router.
 * The router includes:
 *  - Public routes: /login, /registro
 *  - Private routes (bootstrap guard): /, and future features (C-07+)
 *
 * The QueryClientProvider and the Axios session-clear callback are wired
 * in main.tsx (the true entry point) to keep this component simple.
 */
import { RouterProvider } from 'react-router-dom'
import { router } from './router'

export default function App() {
  return <RouterProvider router={router} />
}
