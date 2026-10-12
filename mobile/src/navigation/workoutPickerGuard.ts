/** Shared by the tab + and the empty-day add button. */
export function createPickerOpeningGuard() {
  let opening = false
  return {
    open(navigate: () => void) {
      if (opening) return
      opening = true
      try {
        navigate()
      } catch (error) {
        opening = false
        throw error
      }
    },
    reset() {
      opening = false
    },
  }
}

export const pickerOpeningGuard = createPickerOpeningGuard()

/** Native touch timestamps and performance.now share RN's monotonic clock. */
export function createPickerSelectionGuard() {
  let readyAt: number | null = null
  return {
    ready(now: number) {
      readyAt = now
    },
    block() {
      readyAt = null
    },
    select(touchStartedAt: number | undefined, navigate: () => void) {
      if (readyAt == null) return
      // An event queued during a busy JS frame must not become a new tap.
      // Accessibility activation has no touch timestamp and is allowed once ready.
      if (touchStartedAt != null && touchStartedAt < readyAt) return
      readyAt = null
      navigate()
    },
  }
}
