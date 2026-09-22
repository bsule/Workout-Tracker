// IMPORTANT: theme.colors is mutable so the boot sequence in App.tsx can
// swap dark→light before any screen StyleSheet is created. After that
// initial swap, `theme.colors` is captured by `StyleSheet.create` calls
// at module load time — runtime mutations to it will NOT propagate to
// already-rendered styles. That's why the toggle in Settings prompts
// the user to fully restart the app.
//
// Never hardcode `"rgba(255,255,255,0.x)"` for a fill or a hairline: it
// disappears on the light palette. Use tint() / line() below, or a token
// such as `theme.colors.border`.

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

/** True when the light palette is active. */
export function isLight(): boolean {
  return theme.colors.overlayRgb !== "255,255,255"
}

/** A subtle translucent fill: white on dark, black on light. */
export function tint(alpha: number): string {
  return `rgba(${theme.colors.overlayRgb},${alpha})`
}

/** A translucent hairline or outline. Black lines on a white card read
 *  fainter than white lines on a dark one at the same alpha, so the light
 *  palette gets a stronger line with a floor. */
export function line(alpha: number): string {
  const a = isLight() ? Math.max(0.1, Math.min(1, alpha * 1.4)) : alpha
  return `rgba(${theme.colors.overlayRgb},${Number(a.toFixed(3))})`
}

export function categoryColor(slug: string): string {
  return theme.colors.cat[slug] ?? theme.colors.muted
}
