export type Theme = 'light' | 'dark' | 'system'

export function isTheme(value: string | null): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function resolveTheme(theme: Theme, prefersDark: boolean) {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme
}
