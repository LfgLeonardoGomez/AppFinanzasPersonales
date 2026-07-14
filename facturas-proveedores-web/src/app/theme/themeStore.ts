/**
 * Theme UI store (C-05, D6).
 *
 * Holds the current TemaPreferido at runtime and reflects it onto
 * document.documentElement.classList. The `dark` class is what
 * Tailwind v4's `dark:` variant keys off.
 *
 * Persistence: the durable source is the BACKEND profile
 * (PATCH /api/me with tema_preferido). localStorage is deliberately
 * not used — cross-device consistency is a hard project rule.
 */
import { create } from 'zustand'
import type { TemaPreferido } from '@shared/api/api'

const DARK_CLASS = 'dark'

function applyClass(tema: TemaPreferido): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (tema === 'OSCURO') {
    root.classList.add(DARK_CLASS)
  } else {
    root.classList.remove(DARK_CLASS)
  }
}

interface ThemeState {
  tema: TemaPreferido
  /**
   * Update the runtime theme. Applies the dark class to the documentElement.
   * Callers are responsible for separately persisting via PATCH /api/me.
   */
  setTema: (tema: TemaPreferido) => void
}

export const useThemeStore = create<ThemeState>()((set) => ({
  tema: 'CLARO',
  setTema: (tema: TemaPreferido) => {
    applyClass(tema)
    set({ tema })
  },
}))

/**
 * Seed the theme store from an authenticated user's profile.
 * Called by the theme init effect (src/app/theme/useThemeInit.ts)
 * when the /api/me query resolves.
 */
export function seedThemeFromProfile(tema: TemaPreferido | undefined | null): void {
  const next: TemaPreferido = tema === 'OSCURO' ? 'OSCURO' : 'CLARO'
  useThemeStore.getState().setTema(next)
}
