'use client'

import { useEffect } from 'react'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'

// MacrAI tiene exactamente dos temas, claro y oscuro. El color de marca nunca cambia.
// Este provider solo restaura el modo guardado en el perfil del usuario.

function isThemeMode(value: unknown): value is 'light' | 'dark' | 'system' {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function ThemeSync({ children }: { children: React.ReactNode }) {
  const { setTheme } = useTheme()

  useEffect(() => {
    let cancelled = false

    async function hydrateThemeFromProfile() {
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user || cancelled) return

      const { data } = await supabase
        .from('profiles')
        .select('theme_mode')
        .eq('id', user.id)
        .single()

      if (!data || cancelled) return
      if (isThemeMode(data.theme_mode)) setTheme(data.theme_mode)
    }

    void hydrateThemeFromProfile()

    return () => {
      cancelled = true
    }
  }, [setTheme])

  return <>{children}</>
}
