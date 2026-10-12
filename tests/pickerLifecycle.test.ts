import { describe, expect, it, vi } from "vitest"
import { CommonActions, StackRouter } from "@react-navigation/routers"
import { bindPickerInteraction, bindPickerPreload } from "../mobile/src/navigation/pickerLifecycle"
import { createPickerSelectionGuard } from "../mobile/src/navigation/workoutPickerGuard"

function events() {
  const listeners = new Map<string, Set<(event: { data?: { closing: boolean } }) => void>>()
  return {
    addListener(name: string, callback: (event: { data?: { closing: boolean } }) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name)!.add(callback)
      return () => { listeners.get(name)!.delete(callback) }
    },
    emit(name: string, closing = false) {
      const event = name.startsWith("transition") ? { data: { closing } } : {}
      for (const callback of listeners.get(name) ?? []) callback(event)
    },
    count() { return [...listeners.values()].reduce((n, callbacks) => n + callbacks.size, 0) },
  }
}

function scheduler() {
  let next = 0
  const pending = new Map<number, () => void>()
  return {
    request(callback: () => void) { pending.set(++next, callback); return next },
    cancel(id: number) { pending.delete(id) },
    flush() {
      const callbacks = [...pending.values()]
      pending.clear()
      for (const callback of callbacks) callback()
    },
    callbacks() { return [...pending.values()] },
  }
}

describe("picker native navigation events", () => {
  it("restores selection after gestureCancel without requiring transitionEnd", () => {
    const navigation = events()
    const frames = scheduler()
    let now = 100
    const guard = createPickerSelectionGuard()
    const interactive = vi.fn()
    const controller = bindPickerInteraction(navigation, guard, interactive, { ...frames, now: () => now })
    controller.rearm() // A preloaded screen must remain blocked.
    frames.flush()
    const navigate = vi.fn()
    guard.select(110, navigate)
    expect(navigate).not.toHaveBeenCalled()

    navigation.emit("transitionStart")
    navigation.emit("transitionEnd")
    frames.flush()
    expect(interactive).toHaveBeenLastCalledWith(true)

    navigation.emit("transitionStart", true)
    expect(interactive).toHaveBeenLastCalledWith(false)
    guard.select(200, navigate)
    navigation.emit("gestureCancel") // The actual iOS cancellation sequence.
    now = 300
    frames.flush()
    expect(interactive).toHaveBeenLastCalledWith(true)
    guard.select(250, navigate) // Queued during the swipe: still rejected.
    expect(navigate).not.toHaveBeenCalled()
    guard.select(350, navigate)
    guard.select(360, navigate)
    expect(navigate).toHaveBeenCalledTimes(1)
    controller.dispose()
    expect(navigation.count()).toBe(0)
  })

  it("cannot re-enable a departing or unmounted picker through an old frame callback", () => {
    const navigation = events()
    const frames = scheduler()
    const guard = createPickerSelectionGuard()
    const interactive = vi.fn()
    const controller = bindPickerInteraction(navigation, guard, interactive, { ...frames, now: () => 100 })
    navigation.emit("transitionEnd")
    const [oldFrame] = frames.callbacks()
    navigation.emit("transitionStart", true)
    oldFrame()
    expect(interactive).toHaveBeenLastCalledWith(false)
    navigation.emit("transitionEnd", true)
    frames.flush()
    expect(interactive).toHaveBeenLastCalledWith(false)
    controller.dispose()
    oldFrame()
    expect(interactive).toHaveBeenLastCalledWith(false)
  })

  it("rearms after switching between the picker and new-exercise form", () => {
    const navigation = events()
    const frames = scheduler()
    const guard = createPickerSelectionGuard()
    const controller = bindPickerInteraction(navigation, guard, vi.fn(), { ...frames, now: () => 100 })
    navigation.emit("transitionEnd")
    frames.flush()
    controller.rearm()
    const navigate = vi.fn()
    guard.select(undefined, navigate)
    expect(navigate).not.toHaveBeenCalled()
    frames.flush()
    guard.select(undefined, navigate)
    expect(navigate).toHaveBeenCalledTimes(1)
    controller.dispose()
  })
})

describe("picker preloading", () => {
  it("preloads while Main is idle, reuses the prepared route, and prepares a fresh one after returning", () => {
    const router = StackRouter({ initialRouteName: "Main" })
    const config = { routeNames: ["Main", "ExercisePicker"], routeParamList: {}, routeGetIdList: {} }
    let state = router.getInitialState(config)
    const idle = scheduler()
    const navigation = {
      ...events(),
      isFocused: () => state.routes[state.index].name === "Main",
      getState: () => state,
      preload: vi.fn((name: string) => {
        state = router.getStateForAction(state, CommonActions.preload(name), config)!
      }),
    }
    const stop = bindPickerPreload(navigation, idle)
    expect(state.preloadedRoutes).toHaveLength(0)
    idle.flush()
    const preparedKey = state.preloadedRoutes[0].key
    navigation.emit("transitionEnd")
    idle.flush()
    expect(navigation.preload).toHaveBeenCalledTimes(1)

    state = router.getStateForAction(state, CommonActions.navigate("ExercisePicker"), config)!
    expect(state.routes[state.index].key).toBe(preparedKey)
    expect(state.preloadedRoutes).toHaveLength(0)
    state = router.getStateForAction(state, CommonActions.goBack(), config)!
    navigation.emit("transitionEnd")
    idle.flush()
    expect(state.preloadedRoutes).toHaveLength(1)
    expect(state.preloadedRoutes[0].key).not.toBe(preparedKey)
    stop()
    expect(navigation.count()).toBe(0)
  })

  it("cancels idle preparation when the user leaves Main or it unmounts", () => {
    const idle = scheduler()
    let focused = true
    const navigation = { ...events(), isFocused: () => focused, getState: () => ({}), preload: vi.fn() }
    const stop = bindPickerPreload(navigation, idle)
    focused = false
    navigation.emit("blur")
    idle.flush()
    expect(navigation.preload).not.toHaveBeenCalled()
    focused = true
    navigation.emit("transitionEnd")
    const [oldCallback] = idle.callbacks()
    stop()
    oldCallback()
    expect(navigation.preload).not.toHaveBeenCalled()
  })
})
