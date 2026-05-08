import { createContext, useContext, type ReactNode } from "react"
import { theme as defaultTheme, type Theme } from "./theme"

const ThemeContext = createContext<Theme>(defaultTheme)

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <ThemeContext.Provider value={defaultTheme}>{children}</ThemeContext.Provider>
  )
}

export function useTheme(): Theme {
  return useContext(ThemeContext)
}
