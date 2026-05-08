// Color palettes for dark and light theme modes. Kept in a leaf module
// so theme.ts and themeMode.ts can both import from here without a
// circular dependency.

export const darkColors = {
  background: "#0a0a0a",
  foreground: "#f5f5f5",
  primary: "#0077BC",
  primaryForeground: "#ffffff",
  navAccent: "#ffffff",
  navAccentForeground: "#000000",
  secondary: "#3ee6c0",
  card: "#1f1f1f",
  cardElevated: "#262626",
  border: "rgba(255,255,255,0.15)",
  borderStrong: "rgba(255,255,255,0.30)",
  destructive: "#ef4444",
  muted: "#9a9a9a",
  accent: "#3ee6c0",
  inputBg: "#161616",
  cat: {
    abs: "#22d3ee",
    back: "#22c55e",
    biceps: "#ef4444",
    cardio: "#facc15",
    chest: "#ec4899",
    legs: "#3b82f6",
    shoulders: "#f97316",
    triceps: "#8b5cf6",
  } as Record<string, string>,
}

// Light tokens mirror frontend/app/globals.css :root (dark stripped).
// Many StyleSheets in the app still hardcode `rgba(255,255,255,0.x)`
// for borders/dim text — those will look off in light mode until
// migrated, which is acceptable for the first pass.
export const lightColors: typeof darkColors = {
  background: "#fafafa",
  foreground: "#262626",
  primary: "#0077BC",
  primaryForeground: "#ffffff",
  navAccent: "#0a0a0a",
  navAccentForeground: "#ffffff",
  secondary: "#0d9488",
  card: "#ffffff",
  cardElevated: "#f5f5f5",
  border: "rgba(0,0,0,0.12)",
  borderStrong: "rgba(0,0,0,0.30)",
  destructive: "#dc2626",
  muted: "#666666",
  accent: "#0d9488",
  inputBg: "#f5f5f5",
  cat: {
    abs: "#0e7490",
    back: "#15803d",
    biceps: "#b91c1c",
    cardio: "#a16207",
    chest: "#be185d",
    legs: "#1d4ed8",
    shoulders: "#c2410c",
    triceps: "#6d28d9",
  } as Record<string, string>,
}

export type ThemeColors = typeof darkColors
