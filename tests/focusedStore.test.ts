import { describe, expect, it, vi } from "vitest"
import { createFocusedStore } from "../mobile/src/store/focusedStore"
import { getState, subscribe } from "@lift/core/store/store"
import * as M from "@lift/core/store/mutations"
import { resetStore } from "./helpers/store"

function focusSource(initial = true) {
  let focused = initial
  const listeners = new Set<() => void>()
  return {
    isFocused: () => focused,
    addListener(_event: "focus", listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    setFocused(value: boolean) {
      focused = value
      if (value) for (const listener of listeners) listener()
    },
  }
}

const source = { getSnapshot: () => getState().snapshot, subscribe }

describe("screen store subscriptions", () => {
  it("updates the logger while covered lists stay idle, then catches up on return", () => {
    resetStore()
    const workout = M.createWorkout("2026-09-24").row
    const we = M.addExerciseToWorkout(workout.id, 1)
    const a = M.addSet(we.id, { weight: 50, reps: 5 })
    const b = M.addSet(we.id, { weight: 60, reps: 5 })
    const backgroundFocus = focusSource()
    const background = createFocusedStore(backgroundFocus, source)
    const logger = createFocusedStore(focusSource(), source)
    const previous = background.getSnapshot()
    const renderBackground = vi.fn(() => background.getSnapshot())
    const renderLogger = vi.fn(() => logger.getSnapshot())
    const stopBackground = background.subscribe(renderBackground)
    const stopLogger = logger.subscribe(renderLogger)
    try {
      // Navigation blurs synchronously; no intervening render/effect needed.
      backgroundFocus.setFocused(false)
      M.deleteSet(a.id)
      M.deleteSet(b.id)
      expect(renderLogger).toHaveBeenCalledTimes(2)
      expect(logger.getSnapshot().sets).toHaveLength(0)
      expect(renderBackground).not.toHaveBeenCalled()
      // Incidental parent renders must not wake stale screen queries either.
      expect(background.getSnapshot()).toBe(previous)
      expect(previous.sets).toHaveLength(2)

      backgroundFocus.setFocused(true)
      expect(renderBackground).toHaveBeenCalledTimes(1)
      expect(background.getSnapshot()).toBe(getState().snapshot)
      expect(background.getSnapshot().sets).toHaveLength(0)
    } finally {
      stopBackground()
      stopLogger()
    }
  })

  it("catches changes between initial render and subscribing", () => {
    resetStore()
    const screen = createFocusedStore(focusSource(), source)
    const before = screen.getSnapshot()
    M.createWorkout("2026-09-24")
    const stop = screen.subscribe(() => {})
    try {
      // React's post-subscribe consistency check sees the latest snapshot.
      expect(screen.getSnapshot()).not.toBe(before)
      expect(screen.getSnapshot()).toBe(getState().snapshot)
    } finally {
      stop()
    }
  })

  it("supports eagerly mounted inactive tabs and repeated focus cycles", () => {
    resetStore()
    const navigation = focusSource(false)
    const screen = createFocusedStore(navigation, source)
    const render = vi.fn(() => screen.getSnapshot())
    const stop = screen.subscribe(render)
    try {
      for (let day = 1; day <= 3; day++) {
        const before = screen.getSnapshot()
        M.createWorkout(`2026-09-0${day}`)
        expect(screen.getSnapshot()).toBe(before)
        expect(render).toHaveBeenCalledTimes(day - 1)
        navigation.setFocused(true)
        expect(screen.getSnapshot().workouts).toHaveLength(day)
        navigation.setFocused(false)
      }
      expect(render).toHaveBeenCalledTimes(3)
    } finally {
      stop()
    }
  })

  it("cleans up both listeners and can subscribe again after StrictMode cleanup", () => {
    resetStore()
    const navigation = focusSource()
    const screen = createFocusedStore(navigation, source)
    const oldRender = vi.fn()
    screen.subscribe(oldRender)()
    M.createWorkout("2026-09-24")
    navigation.setFocused(true)
    expect(oldRender).not.toHaveBeenCalled()

    const render = vi.fn()
    const stop = screen.subscribe(render)
    try {
      M.createWorkout("2026-09-25")
      expect(render).toHaveBeenCalledTimes(1)
      expect(screen.getSnapshot().workouts).toHaveLength(2)
    } finally {
      stop()
    }
  })
})
