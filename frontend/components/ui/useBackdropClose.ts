import { useRef, type MouseEvent } from "react"

/**
 * Props for a modal backdrop that closes on a click outside the card. The
 * press has to start on the backdrop too: a text selection dragged out of a
 * textarea ends with a click on the backdrop, and closing then would throw
 * away the draft.
 */
export function useBackdropClose(onClose: () => void) {
  const downOnBackdrop = useRef(false)
  return {
    onMouseDown(e: MouseEvent<HTMLElement>) {
      downOnBackdrop.current = e.target === e.currentTarget
    },
    onClick(e: MouseEvent<HTMLElement>) {
      const close = downOnBackdrop.current && e.target === e.currentTarget
      downOnBackdrop.current = false
      if (close) onClose()
    },
  }
}
