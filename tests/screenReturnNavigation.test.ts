import { expect, it, vi } from "vitest"

const navigation = vi.hoisted(() => ({ getState: vi.fn(), getRootState: vi.fn() }))

// Exercise the actual hook's navigation wiring without a native renderer.
// The store/return registry remains real; only React hooks and navigation
// context are supplied here. The lifecycle is covered in focusedStore.test.
vi.mock("../mobile/node_modules/react/index.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useContext: () => ({ getRootState: navigation.getRootState }),
  useCallback: (callback: unknown) => callback,
}))
vi.mock("@react-navigation/native", () => ({
  NavigationContainerRefContext: {},
  useNavigation: () => ({ getState: navigation.getState }),
  useRoute: () => ({ key: "logger" }),
}))

import { usePrepareScreenReturn } from "../mobile/src/store/useScreenSnapshot"
import { subscribeScreenReturn } from "../mobile/src/store/focusedStore"

it("uses the live nested navigator state instead of sending a return refresh to Main", () => {
  const today = vi.fn()
  const calendar = vi.fn()
  const main = vi.fn()
  const stops = [
    subscribeScreenReturn("today", today),
    subscribeScreenReturn("calendar", calendar),
    subscribeScreenReturn("main", main),
  ]
  navigation.getState.mockReturnValue({ index: 1, routes: [{ key: "main" }, { key: "logger" }] })
  const mainRoute = {
    key: "main",
    state: { index: 0, routes: [{ key: "today" }, { key: "calendar" }] },
  }
  navigation.getRootState.mockReturnValue({ index: 1, routes: [mainRoute, { key: "logger" }] })
  try {
    const prepare = usePrepareScreenReturn()
    prepare()
    expect(today).toHaveBeenCalledTimes(1)
    expect(main).not.toHaveBeenCalled()
    expect(calendar).not.toHaveBeenCalled()

    // Native back can already have removed the logger. Read current child
    // state at event time rather than reusing a tab remembered at mount.
    navigation.getRootState.mockReturnValue({
      index: 0,
      routes: [{ ...mainRoute, state: { ...mainRoute.state, index: 1 } }],
    })
    prepare()
    expect(calendar).toHaveBeenCalledTimes(1)
    expect(today).toHaveBeenCalledTimes(1)
    expect(main).not.toHaveBeenCalled()
    expect(navigation.getState).not.toHaveBeenCalled()

    // Calendar's explicit origin remains authoritative.
    usePrepareScreenReturn("today")()
    expect(today).toHaveBeenCalledTimes(2)
    expect(calendar).toHaveBeenCalledTimes(1)
  } finally {
    for (const stop of stops) stop()
  }
})
