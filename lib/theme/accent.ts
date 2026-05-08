export const ACCENT_STORAGE_KEY = 'macrai-accent'

export const ACCENT_THEMES = ['green', 'lilac', 'pink', 'sky', 'amber'] as const

export type AccentTheme = (typeof ACCENT_THEMES)[number]

function isAccentTheme(value: string | null): value is AccentTheme {
  return !!value && (ACCENT_THEMES as readonly string[]).includes(value)
}

export function getStoredAccentTheme(): AccentTheme {
  if (typeof window === 'undefined') return 'green'
  const value = window.localStorage.getItem(ACCENT_STORAGE_KEY)
  return isAccentTheme(value) ? value : 'green'
}

export function applyAccentTheme(theme: AccentTheme) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-accent', theme)
}

export function setStoredAccentTheme(theme: AccentTheme) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(ACCENT_STORAGE_KEY, theme)
  }
  applyAccentTheme(theme)
}

export function initializeAccentTheme() {
  const theme = getStoredAccentTheme()
  applyAccentTheme(theme)
  return theme
}
