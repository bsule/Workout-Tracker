"use client"

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react"

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

// The stored theme as an external store: read straight from localStorage, so
// there is no copy in state to sync after mount. The server (and hydration)
// render dark, the default; themeBootstrapScript already set the page class.
const THEME_EVENT = "lift:theme"

function readTheme(): Theme {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

function subscribeTheme(cb: () => void): () => void {
  window.addEventListener(THEME_EVENT, cb)
  window.addEventListener("storage", cb)
  return () => {
    window.removeEventListener(THEME_EVENT, cb)
    window.removeEventListener("storage", cb)
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore<Theme>(subscribeTheme, readTheme, () => "dark")

  // Keep the page class in step, including a change made in another tab.
  useEffect(() => {
    applyClass(theme)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, t)
    } catch {
      // Private mode: the class still changes for this page.
    }
    applyClass(t)
    window.dispatchEvent(new Event(THEME_EVENT))
  }, [])

  const toggle = useCallback(() => {
    setTheme(readTheme() === "dark" ? "light" : "dark")
  }, [setTheme])

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
