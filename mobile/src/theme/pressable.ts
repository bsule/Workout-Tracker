import { tint } from "./theme"

export function pressedStyle(pressed: boolean) {
  return pressed
    ? {
        backgroundColor: tint(0.08),
        opacity: 0.92,
      }
    : null
}
