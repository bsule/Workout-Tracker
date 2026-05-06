"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"

type Theme = "dark" | "light"

const STORAGE_KEY = "lift.theme"

interface ThemeState {
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}

const ThemeContext = createContext<ThemeState | null>(null)

function applyClass(theme: Theme) {
  const html = document.documentElement
  html.classList.toggle("dark", theme === "dark")
  html.classList.toggle("light", theme === "light")
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark")

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null
    const initial: Theme = stored === "light" ? "light" : "dark"
    setThemeState(initial)
    applyClass(initial)
  }, [])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    window.localStorage.setItem(STORAGE_KEY, t)
    applyClass(t)
  }, [])

  const toggle = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark")
  }, [theme, setTheme])

  return (
    <ThemeContext value={{ theme, setTheme, toggle }}>{children}</ThemeContext>
  )
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}

/**
 * Inline script to apply the persisted theme before React hydrates,
 * so users who picked light don't see a dark flash. Always defaults to dark.
 * Never reads OS prefers-color-scheme.
 */
export const themeBootstrapScript = `
(function(){
  try {
    var t = localStorage.getItem('${STORAGE_KEY}');
    var c = document.documentElement.classList;
    if (t === 'light') { c.remove('dark'); c.add('light'); }
    else { c.remove('light'); c.add('dark'); }
  } catch (e) {}
})();
`
