/**
 * ThemeBootstrap — runs the theme init effect at the root of the app.
 * Mounted once inside QueryClientProvider so it can use useMe() to
 * read the authenticated user's tema_preferido and apply it.
 */
import { useThemeInit } from './useThemeInit'

export function ThemeBootstrap(): null {
  useThemeInit()
  return null
}
