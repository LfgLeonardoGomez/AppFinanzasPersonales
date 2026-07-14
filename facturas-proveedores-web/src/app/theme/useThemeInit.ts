/**
 * useThemeInit — reads the authenticated user's tema_preferido and
 * applies it to the documentElement. Mounted once at app startup.
 *
 * This is the "survives reload" path (D6 — theme comes from the
 * backend profile, NEVER from localStorage).
 */
import { useEffect } from 'react'
import { useMe } from '@features/auth/api/authHooks'
import { seedThemeFromProfile } from './themeStore'

export function useThemeInit(): void {
  const { data, status } = useMe()

  useEffect(() => {
    if (status === 'success' && data) {
      seedThemeFromProfile(data.tema_preferido ?? 'CLARO')
    }
  }, [status, data])
}
