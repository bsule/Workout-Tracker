import { describe, expect, it } from "vitest"
import { CommonActions, StackActions, StackRouter } from "@react-navigation/routers"
import { createOpeningBackGuard, removeOriginatingPicker } from "../mobile/src/navigation/openingBackGuard"

describe("Back during the picker handoff", () => {
  it("holds the original targeted action until opening completes, and replays it once", () => {
    const guard = createOpeningBackGuard<object>(true)
    const action = { type: "POP", source: "logger", target: "root", payload: { count: 1 } }
    guard.defer(action)
    guard.defer({ type: "POP" }) // Rapid repeated presses must not pop Main too.
    expect(guard.take()).toBeUndefined()
    expect(guard.finish(true)).toBe(false) // A cancelled native dismissal isn't opening completion.
    expect(guard.take()).toBeUndefined()
    expect(guard.finish(false)).toBe(true)
    expect(guard.take()).toBe(action)
    expect(guard.take()).toBeUndefined()
    expect(guard.finish(false)).toBe(false)
  })

  it("does not defer normal logger navigation or later Back presses", () => {
    const normal = createOpeningBackGuard<string>(false)
    normal.defer("back")
    expect(normal.take()).toBeUndefined()
    const picker = createOpeningBackGuard<string>(true)
    picker.finish(false)
    picker.defer("back")
    expect(picker.take()).toBeUndefined()
  })

  it("allows opening to complete without an early Back request", () => {
    const guard = createOpeningBackGuard<string>(true)
    expect(guard.finish(false)).toBe(true)
    expect(guard.take()).toBeUndefined()
  })
})

describe("picker removal after the logger push", () => {
  const config = { routeNames: ["Main", "ExercisePicker", "SetLogger"], routeParamList: {}, routeGetIdList: {} }
  it("removes the picker before a queued Back button action, returning directly to Main", () => {
    const router = StackRouter({ initialRouteName: "Main" })
    let state = router.getInitialState(config)
    const main = state.routes[0]
    state = router.getStateForAction(state, CommonActions.navigate("ExercisePicker"), config)!
    const picker = state.routes[1]
    state = router.getStateForAction(state, StackActions.push("SetLogger", { pickerRouteKey: picker.key }), config)!
    const logger = state.routes[2]
    const guard = createOpeningBackGuard<ReturnType<typeof StackActions.pop>>(true)
    guard.defer({ ...StackActions.pop(), source: logger.key, target: state.key })
    expect(guard.take()).toBeUndefined()
    guard.finish(false)
    state = router.getStateForAction(state, CommonActions.reset(removeOriginatingPicker(state, picker.key)), config)!
    expect(state.routes).toEqual([main, logger])
    state = router.getStateForAction(state, guard.take()!, config)!
    expect(state.routes).toEqual([main])
    expect(state.index).toBe(0)
  })

  it("leaves unrelated or active routes alone", () => {
    const router = StackRouter({ initialRouteName: "Main" })
    let state = router.getInitialState(config)
    state = router.getStateForAction(state, CommonActions.navigate("ExercisePicker"), config)!
    expect(removeOriginatingPicker(state, state.routes[1].key)).toBe(state)
    state = router.getStateForAction(state, StackActions.push("SetLogger"), config)!
    expect(removeOriginatingPicker(state, "missing")).toBe(state)
    expect(removeOriginatingPicker(state, state.routes[0].key)).toBe(state)
    expect(removeOriginatingPicker(state, state.routes[2].key)).toBe(state)
  })
})
