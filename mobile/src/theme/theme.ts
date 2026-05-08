// IMPORTANT: theme.colors is mutable so the boot sequence in App.tsx can
// swap dark→light before any screen StyleSheet is created. After that
// initial swap, `theme.colors` is captured by `StyleSheet.create` calls
// at module load time — runtime mutations to it will NOT propagate to
// already-rendered styles. That's why the toggle in Settings prompts
// the user to fully restart the app.
//
// To preserve light-mode parity, prefer reading `theme.colors.border`
// or `theme.colors.muted` over hardcoded `"rgba(255,255,255,0.x)"`
// literals when adding new styles.

import { darkColors } from "./themeColors"

export const theme = {
  // Spread so this is a fresh mutable object, not a shared reference
  // with the darkColors export. `init()` in themeMode.ts uses
  // Object.assign(theme.colors, …) to swap modes in place.
  colors: { ...darkColors, cat: { ...darkColors.cat } },
  radius: { sm: 6, md: 10, lg: 12 },
  spacing: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 },
  font: {
    body: "System",
    bodyBold: "System",
    display: "System",
    mono: "Menlo",
  },
  fontSize: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    "2xl": 30,
    "3xl": 38,
  },
}

export type Theme = typeof theme

export function categoryColor(slug: string): string {
  return theme.colors.cat[slug] ?? theme.colors.muted
}
