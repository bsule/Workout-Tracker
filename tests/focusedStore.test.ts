import { describe, expect, it, vi } from "vitest"
import { createFocusedStore, getReturnRouteKey, prepareScreenReturn, subscribeScreenReturn } from "../mobile/src/store/focusedStore"
import { getState, subscribe } from "@lift/core/store/store"
import * as M from "@lift/core/store/mutations"
import { resetStore } from "./helpers/store"
import { getWorkoutByDateQ, listExercisesQ } from "@lift/core/store/queries"

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
  it("refreshes the originating Calendar even when the parent stack has missing or stale tab state", () => {
    resetStore()
    const calendar = createFocusedStore(focusSource(false), source,
      (listener) => subscribeScreenReturn("calendar-origin", listener))
    const today = createFocusedStore(focusSource(false), source,
      (listener) => subscribeScreenReturn("today", listener))
    const renderCalendar = vi.fn(() => getWorkoutByDateQ("2026-09-25"))
    const renderToday = vi.fn()
    const stopCalendar = calendar.subscribe(renderCalendar)
    const stopToday = today.subscribe(renderToday)
    try {
      const workout = M.createWorkout("2026-09-25").row
      const we = M.addExerciseToWorkout(workout.id, 1)
      const set = M.addSet(we.id, { weight: 50, reps: 5 })
      expect(renderCalendar).not.toHaveBeenCalled()
      const beforePop = { index: 1, routes: [{ key: "main" }, { key: "logger" }] }
      prepareScreenReturn(getReturnRouteKey(beforePop, "logger", "calendar-origin"))
      expect(renderCalendar.mock.results[0].value?.exercises[0].sets[0].id).toBe(set.id)
      // An interactive pop may already have removed the logger. Even if the
      // stack's nested state still names Today, refresh the originating tab.
      M.deleteSet(set.id)
      expect(renderCalendar).toHaveBeenCalledTimes(1)
      const afterPop = { index: 0, routes: [{ key: "main", state: { index: 0, routes: [{ key: "today" }] } }] }
      prepareScreenReturn(getReturnRouteKey(afterPop, "logger", "calendar-origin"))
      expect(renderCalendar.mock.results[1].value?.exercises[0].sets).toHaveLength(0)
      expect(renderToday).not.toHaveBeenCalled()
      expect(getReturnRouteKey(beforePop, "logger", "calendar-pushed")).toBe("calendar-pushed")
    } finally {
      stopCalendar()
      stopToday()
    }
  })

  it("targets the selected tab or exact pushed calendar instance before and after a pop", () => {
    const main = { key: "main", state: { index: 1, routes: [{ key: "today" }, { key: "calendar-tab" }, { key: "exercises" }] } }
    expect(getReturnRouteKey({ index: 1, routes: [main, { key: "logger" }] }, "logger")).toBe("calendar-tab")
    expect(getReturnRouteKey({ index: 0, routes: [main] }, "logger")).toBe("calendar-tab")
    expect(getReturnRouteKey({ index: 2, routes: [main, { key: "calendar-pushed" }, { key: "logger" }] }, "logger")).toBe("calendar-pushed")
    expect(getReturnRouteKey({ index: 1, routes: [main, { key: "calendar-pushed" }] }, "logger")).toBe("calendar-pushed")
    expect(getReturnRouteKey({ index: 0, routes: [main] }, "main")).toBeUndefined()
    expect(getReturnRouteKey(undefined, "logger")).toBeUndefined()
    expect(getReturnRouteKey({ routes: [{ state: { routes: [{}] } }, { key: "logger" }] }, "logger")).toBeUndefined()
  })

  it("refreshes calendar details after deleting sets without waking Today, Exercises or another calendar", () => {
    resetStore()
    const workout = M.createWorkout("2026-09-25").row
    const we = M.addExerciseToWorkout(workout.id, 1)
    const set = M.addSet(we.id, { weight: 50, reps: 5 })
    const keys = ["today", "calendar-tab", "calendar-pushed", "exercises"]
    const screens = keys.map((key) => createFocusedStore(focusSource(false), source,
      (listener) => subscribeScreenReturn(key, listener)))
    const renders = screens.map((screen) => vi.fn(() => screen.getSnapshot()))
    const stops = screens.map((screen, i) => screen.subscribe(renders[i]))
    const renderDetails = vi.fn(() => getWorkoutByDateQ("2026-09-25"))
    const details = createFocusedStore(focusSource(false), source,
      (listener) => subscribeScreenReturn("calendar-pushed", listener))
    stops.push(details.subscribe(renderDetails))
    try {
      M.deleteSet(set.id)
      for (const render of renders) expect(render).not.toHaveBeenCalled()
      expect(renderDetails).not.toHaveBeenCalled()
      prepareScreenReturn("calendar-pushed")
      expect(renders.map((render) => render.mock.calls.length)).toEqual([0, 0, 1, 0])
      expect(renderDetails).toHaveBeenCalledTimes(1)
      expect(renderDetails.mock.results[0].value?.exercises[0].sets).toHaveLength(0)
      prepareScreenReturn("calendar-pushed")
      expect(renderDetails).toHaveBeenCalledTimes(1)
    } finally {
      for (const stop of stops) stop()
    }
  })

  it("shows a created or renamed exercise before returning, and removes its return listener on cleanup", () => {
    resetStore()
    const screen = createFocusedStore(focusSource(false), source,
      (listener) => subscribeScreenReturn("exercises", listener))
    const render = vi.fn(() => listExercisesQ({ sort: "name" }))
    const stop = screen.subscribe(render)
    try {
      const ex = M.createExercise({ name: "New custom lift", category: "chest" })
      expect(render).not.toHaveBeenCalled()
      prepareScreenReturn("exercises")
      expect(render.mock.results[0].value.find((row) => row.id === ex.id)?.name).toBe("New custom lift")
      M.patchExercise(ex.id, { name: "Renamed custom lift" })
      expect(render).toHaveBeenCalledTimes(1)
      prepareScreenReturn("exercises")
      expect(render.mock.results[1].value.find((row) => row.id === ex.id)?.name).toBe("Renamed custom lift")
    } finally {
      stop()
    }
    M.createWorkout("2026-09-25")
    prepareScreenReturn("exercises")
    expect(render).toHaveBeenCalledTimes(2)
  })

  it("prepares the visible day before focus without waking other covered lists", () => {
    resetStore()
    const navigation = focusSource(false)
    const day = createFocusedStore(navigation, source, (listener) => subscribeScreenReturn("today", listener))
    const otherList = createFocusedStore(navigation, source)
    const renderDay = vi.fn(() => day.getSnapshot())
    const renderList = vi.fn()
    const stopDay = day.subscribe(renderDay)
    const stopList = otherList.subscribe(renderList)
    try {
      const workout = M.createWorkout("2026-09-25").row
      const we = M.addExerciseToWorkout(workout.id, 1)
      const set = M.addSet(we.id, { weight: 50, reps: 5 })
      expect(renderDay).not.toHaveBeenCalled()
      expect(day.getSnapshot().workouts).toHaveLength(0)

      prepareScreenReturn("today")
      expect(navigation.isFocused()).toBe(false)
      expect(renderDay).toHaveBeenCalledTimes(1)
      expect(day.getSnapshot().sets[0].id).toBe(set.id)
      expect(renderList).not.toHaveBeenCalled()

      // beforeRemove and transitionStart may both fire for the same pop.
      prepareScreenReturn("today")
      expect(renderDay).toHaveBeenCalledTimes(1)

      // Cancelling a back gesture must not enable background set updates.
      M.deleteSet(set.id)
      expect(renderDay).toHaveBeenCalledTimes(1)
      prepareScreenReturn("today")
      expect(renderDay).toHaveBeenCalledTimes(2)
      expect(day.getSnapshot().sets).toHaveLength(0)
      expect(renderList).not.toHaveBeenCalled()
    } finally {
      stopDay()
      stopList()
    }
    M.createWorkout("2026-09-26")
    prepareScreenReturn("today")
    expect(renderDay).toHaveBeenCalledTimes(2)
  })

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
