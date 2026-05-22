'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import {
  ACCENT_THEMES,
  type AccentTheme,
  initializeAccentTheme,
  setStoredAccentTheme,
} from '@/lib/theme/accent'

function isThemeMode(value: unknown): value is 'light' | 'dark' | 'system' {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function AccentThemeProvider({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme()

  useEffect(() => {
    initializeAccentTheme()

    let cancelled = false

    async function hydrateAppearanceFromProfile() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || cancelled) return

      const { data } = await supabase
        .from('profiles')
        .select('accent_theme, theme_mode')
        .eq('id', user.id)
        .single()

      if (!data || cancelled) return

      if (
        typeof data.accent_theme === 'string' &&
        (ACCENT_THEMES as readonly string[]).includes(data.accent_theme)
      ) {
        setStoredAccentTheme(data.accent_theme as AccentTheme)
      }

      if (isThemeMode(data.theme_mode)) {
        setTheme(data.theme_mode)
      }
    }

    void hydrateAppearanceFromProfile()

    return () => {
      cancelled = true
    }
  }, [setTheme])

  return <>{children}</>
}
