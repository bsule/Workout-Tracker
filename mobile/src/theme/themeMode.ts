// Persistent theme-mode storage and runtime application.
//
// Note on StyleSheet caching: every screen calls `StyleSheet.create({ ...
// theme.colors.x })` at module load time, which copies the color strings
// into the styles. Once those styles are cached, mutating `theme.colors`
// has no effect on already-rendered components — they'd need to be
// remounted to re-read styles.
//
// To make a theme swap actually visible we lazy-load the navigator at
// the app entry, then call `init(mode)` to mutate `theme.colors` BEFORE
// any screen module is imported. After the user toggles in Settings we
// prompt for an app restart so the bundle re-evaluates with the new
// stored mode.

import AsyncStorage from "@react-native-async-storage/async-storage"
import { darkColors, lightColors } from "./themeColors"
import { theme } from "./theme"

export type ThemeMode = "dark" | "light"

const STORAGE_KEY = "lift.theme.mode"

export async function getStoredMode(): Promise<ThemeMode> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY)
    return v === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

export async function setStoredMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, mode)
}

let _currentMode: ThemeMode = "dark"
export function currentMode(): ThemeMode {
  return _currentMode
}

// Mutate `theme.colors` in place to the chosen palette. Must be called
// before any screen module is imported (which is why App.tsx lazy-loads
// the navigator behind a hydration gate).
export function init(mode: ThemeMode): void {
  _currentMode = mode
  const next = mode === "light" ? lightColors : darkColors
  // Object.assign keeps the same `theme.colors` reference so any module
  // that has already captured it (theme.ts itself) still sees the new
  // values.
  Object.assign(theme.colors, next)
  Object.assign(theme.colors.cat, next.cat)
}
