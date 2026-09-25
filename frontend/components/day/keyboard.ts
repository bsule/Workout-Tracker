/**
 * True when a page-level shortcut (arrow keys, "t", PageUp) should leave this
 * key alone: the user is typing, holding a modifier, or a dialog or menu is
 * open and owns the keyboard.
 */
export function ignorePageShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true
  const t = e.target
  if (t instanceof HTMLElement) {
    if (t.isContentEditable) return true
    const tag = t.tagName
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true
  }
  return !!document.querySelector('[aria-modal="true"], [role="menu"]')
}
