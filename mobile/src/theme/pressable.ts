export function pressedStyle(pressed: boolean) {
  return pressed
    ? {
        backgroundColor: "rgba(255,255,255,0.08)",
        opacity: 0.92,
      }
    : null
}
