import { describe, expect, it, vi } from "vitest"
import { createPickerOpeningGuard, createPickerSelectionGuard } from "../mobile/src/navigation/workoutPickerGuard"

describe("opening the workout picker", () => {
  it("coalesces rapid taps from both add buttons and allows reopening after leaving", () => {
    const guard = createPickerOpeningGuard()
    const tabNavigation = vi.fn()
    const dayNavigation = vi.fn()
    guard.open(tabNavigation)
    guard.open(dayNavigation)
    guard.open(tabNavigation)
    expect(tabNavigation).toHaveBeenCalledTimes(1)
    expect(dayNavigation).not.toHaveBeenCalled()

    guard.reset()
    guard.open(dayNavigation)
    expect(dayNavigation).toHaveBeenCalledTimes(1)
  })

  it("does not leave the add button locked if navigation throws", () => {
    const guard = createPickerOpeningGuard()
    expect(() => guard.open(() => { throw new Error("unmounted navigator") })).toThrow()
    const navigate = vi.fn()
    guard.open(navigate)
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})

describe("selecting an exercise", () => {
  it("rejects an opening tap even when it is delivered after the list becomes ready", () => {
    const guard = createPickerSelectionGuard()
    const replace = vi.fn()
    guard.select(100, replace)
    guard.ready(300)
    guard.select(200, replace)
    expect(replace).not.toHaveBeenCalled()

    // A deliberate new touch opens the logger once; queued repeat taps cannot.
    guard.select(350, replace)
    guard.select(370, replace)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it("blocks departure taps and requires a fresh touch after a cancelled back swipe", () => {
    const guard = createPickerSelectionGuard()
    const replace = vi.fn()
    guard.ready(300)
    guard.block()
    guard.select(350, replace)
    guard.ready(600)
    guard.select(450, replace)
    expect(replace).not.toHaveBeenCalled()
    guard.select(650, replace)
    expect(replace).toHaveBeenCalledTimes(1)
  })

  it("allows accessibility activation only once the picker is ready", () => {
    const guard = createPickerSelectionGuard()
    const replace = vi.fn()
    guard.select(undefined, replace)
    expect(replace).not.toHaveBeenCalled()
    guard.ready(300)
    guard.select(undefined, replace)
    guard.select(undefined, replace)
    expect(replace).toHaveBeenCalledTimes(1)
  })
})
