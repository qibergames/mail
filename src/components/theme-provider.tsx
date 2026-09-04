import { ScriptOnce } from '@tanstack/react-router'
import { createContext, useContext, useEffect, useState } from 'react'
import { isTheme, resolveTheme } from '@/lib/theme'
import type { Theme } from '@/lib/theme'

const storageKey = 'qibermail-theme'

type ThemeContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function themeScript() {
  return `(function(){try{var t=localStorage.getItem('${storageKey}');if(t!=='light'&&t!=='dark'&&t!=='system')t='system';var d=matchMedia('(prefers-color-scheme: dark)').matches;var r=t==='system'?(d?'dark':'light'):t;document.documentElement.classList.add(r);document.documentElement.style.colorScheme=r}catch(e){}})();`
}

function applyTheme(theme: Theme) {
  const root = document.documentElement
  const resolved = resolveTheme(theme, matchMedia('(prefers-color-scheme: dark)').matches)
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.style.colorScheme = resolved
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('system')

  useEffect(() => {
    const stored = localStorage.getItem(storageKey)
    setThemeState(isTheme(stored) ? stored : 'system')
  }, [])

  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system') return
    const media = matchMedia('(prefers-color-scheme: dark)')
    const update = () => applyTheme('system')
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [theme])

  function setTheme(next: Theme) {
    localStorage.setItem(storageKey, next)
    setThemeState(next)
  }

  return (
    <ThemeContext value={{ theme, setTheme }}>
      <ScriptOnce>{themeScript()}</ScriptOnce>
      {children}
    </ThemeContext>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside ThemeProvider')
  return context
}
