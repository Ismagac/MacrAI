'use client'

import { useEffect } from 'react'
import { initializeAccentTheme } from '@/lib/theme/accent'

export function AccentThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initializeAccentTheme()
  }, [])

  return <>{children}</>
}
